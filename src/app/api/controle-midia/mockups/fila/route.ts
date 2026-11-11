import { lerCorpoLimitado } from "@/lib/ler-corpo-limitado";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { MAX_SAIDAS_MOCKUPS } from "@/lib/fila-mockups-contrato";
import { pedidoFilaMockups, trabalhoFilaMockups } from "@/lib/fila-mockups";
import { mockupPorId } from "@/lib/mockups-imagem";
import { prisma } from "@/lib/prisma";
import { getUsuarioAutenticado } from "@/lib/usuario-autenticado";
import { existemGoogleStorageObjetos, lerGoogleStorageImagemPrivada, GoogleStorageServiceError } from "@/services/googleStorageService";

const headersPrivados = { "Cache-Control": "private, no-store" };
const MAX_CORPO = 512 * 1024;
const pedidoRecriacao = z.object({
  loteId: z.uuid(),
  origemLoteId: z.uuid(),
  saida: z.number().int().min(1).max(MAX_SAIDAS_MOCKUPS).optional(),
}).refine(({ loteId, origemLoteId }) => loteId.toLowerCase() !== origemLoteId.toLowerCase());

function erro(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: headersPrivados });
}

async function autorizarFila(request: Request) {
  let autenticado;
  try {
    autenticado = await getUsuarioAutenticado(request);
  } catch {
    return erro("Sessão inválida ou expirada.", 401);
  }

  const usuario = await prisma.usuario.findUnique({
    where: { id: autenticado.id },
    select: { ativo: true, aplicativoId: true, podeCriarMockups: true },
  });
  if (!usuario?.ativo || !usuario.podeCriarMockups) return erro("Sem permissão para acessar a fila de mockups.", 403);
  return { aplicativoId: usuario.aplicativoId, solicitadoPor: autenticado.id };
}

function objeto(valor: Prisma.JsonValue | undefined): Prisma.JsonObject {
  return valor && typeof valor === "object" && !Array.isArray(valor) ? valor : {};
}

export async function GET(request: Request) {
  try {
    const escopo = await autorizarFila(request);
    if (escopo instanceof Response) return escopo;
    const params = new URL(request.url).searchParams;
    const id = z.uuid().safeParse(params.get("loteId"));
    const saida = params.get("saida");
    if (!id.success || (saida !== null && !/^[1-9]\d{0,2}$/.test(saida))) {
      return erro("Identificador do lote ou da saída inválido.", 400);
    }
    const lote = await prisma.filaMockup.findUnique({
      where: { aplicativoId_solicitadoPor_id: { ...escopo, id: id.data } },
      select: { status: true, trabalhos: true, resultados: true },
    });
    if (!lote) return erro("Lote não encontrado.", 404);
    const trabalhos = Array.isArray(lote.trabalhos) ? lote.trabalhos : [];
    const resultados = Array.isArray(lote.resultados) ? lote.resultados : [];
    if (saida !== null) {
      const numero = Number(saida);
      const resultado = objeto(resultados[numero - 1]);
      const caminho = `mockups-gerados/${escopo.aplicativoId}/${escopo.solicitadoPor}/${id.data}/${numero}.webp`;
      if (numero > trabalhos.length || resultado.status !== "COMPLETED" || resultado.path !== caminho
        || typeof resultado.bucket !== "string" || !resultado.bucket) {
        return erro("Imagem indisponível.", 404);
      }
      const imagem = await lerGoogleStorageImagemPrivada(resultado.bucket, caminho, "image/webp", AbortSignal.timeout(30_000));
      return new Response(imagem, { headers: { ...headersPrivados, "Content-Type": "image/webp", "X-Content-Type-Options": "nosniff" } });
    }
    const combinacoes = trabalhos.map((valor) => {
      const trabalho = objeto(valor);
      const ids = Array.isArray(trabalho.estampaIds)
        ? trabalho.estampaIds.filter((id): id is string => typeof id === "string" && /^[1-9]\d{0,18}$/.test(id))
        : [];
      return { trabalho, ids };
    });
    const ids = [...new Set(combinacoes.flatMap(({ ids }) => ids))];
    const estampas = ids.length ? await prisma.estampaCatalogoIa.findMany({
      where: { id: { in: ids.map(BigInt) } },
      select: { id: true, codigo: true, variante: true },
    }) : [];
    const codigos = new Map(estampas.map(({ id, codigo, variante }) =>
      [String(id), variante ? `${codigo}-${variante}` : codigo]));
    return NextResponse.json({
      status: lote.status,
      saidas: combinacoes.map(({ trabalho, ids }, indice) => {
        const resultado = objeto(resultados[indice]);
        const modelo = typeof trabalho.mockupId === "string" ? mockupPorId(trabalho.mockupId) : null;
        return {
          numero: indice + 1,
          nome: modelo?.nome ?? "Mockup",
          estampas: ids.map((id) => codigos.get(id) ?? `Estampa #${id}`),
          status: resultado.status === "COMPLETED" || resultado.status === "FAILED" ? resultado.status : "PENDING",
          erro: typeof resultado.erro === "string" ? resultado.erro : undefined,
        };
      }),
    }, { headers: headersPrivados });
  } catch (error) {
    if (error instanceof GoogleStorageServiceError && error.status === 404) return erro("Imagem indisponível.", 404);
    return erro("Não foi possível consultar o lote. Tente novamente.", 503);
  }
}

export async function POST(request: Request) {
  try {
    const escopo = await autorizarFila(request);
    if (escopo instanceof Response) return escopo;

    const texto = await lerCorpoLimitado(request, MAX_CORPO);
    if (texto === null) return erro("O lote excede o tamanho máximo.", 413);
    let corpo: unknown;
    try { corpo = JSON.parse(texto); }
    catch { return erro("Envie um lote válido.", 400); }

    if (corpo && typeof corpo === "object" && "origemLoteId" in corpo) {
      const recriacao = pedidoRecriacao.safeParse(corpo);
      if (!recriacao.success) return erro("Informe uma solicitação e uma saída válidas para recriar.", 400);
      const { loteId, origemLoteId, saida } = recriacao.data;
      const origem = await prisma.filaMockup.findUnique({
        where: { aplicativoId_solicitadoPor_id: { ...escopo, id: origemLoteId } },
        select: { status: true, trabalhos: true, resultados: true, observacao: true },
      });
      if (!origem) return erro("Solicitação original não encontrada.", 404);
      const trabalhosOriginais = Array.isArray(origem.trabalhos) ? origem.trabalhos : [];
      const resultados = Array.isArray(origem.resultados) ? origem.resultados : [];
      if (saida !== undefined && saida > trabalhosOriginais.length) return erro("Saída não encontrada.", 404);
      const status = saida === undefined ? origem.status : objeto(resultados[saida - 1]).status;
      if (status !== "COMPLETED" && status !== "FAILED") {
        return erro("Aguarde o processamento terminar antes de recriar.", 409);
      }
      const trabalhos = z.array(trabalhoFilaMockups).safeParse(
        saida === undefined ? trabalhosOriginais : [trabalhosOriginais[saida - 1]],
      );
      if (!trabalhos.success) return erro("A configuração original não é mais compatível.", 422);
      corpo = {
        loteId, observacao: origem.observacao, trabalhos: trabalhos.data,
        estampas: [...new Set(trabalhos.data.flatMap(({ estampaIds }) => estampaIds))],
      };
    }

    const pedido = pedidoFilaMockups.safeParse(corpo);
    if (!pedido.success) return erro("Revise os vínculos e os limites do lote antes de salvar.", 400);

    const { loteId, estampas, trabalhos, observacao = "" } = pedido.data;
    const chave = { ...escopo, id: loteId };
    const where = { aplicativoId_solicitadoPor_id: chave };
    const verificarLote = async () => {
      const salvo = await prisma.filaMockup.findUnique({ where, select: { trabalhos: true, observacao: true } });
      if (!salvo) return null;
      const anteriores = salvo.trabalhos;
      const equivalentes = salvo.observacao === observacao && Array.isArray(anteriores) && anteriores.length === trabalhos.length
        && trabalhos.every((trabalho, indice) => {
          const anterior = anteriores[indice];
          return anterior && typeof anterior === "object" && !Array.isArray(anterior)
            && anterior.mockupId === trabalho.mockupId
            && JSON.stringify(anterior.estampaIds) === JSON.stringify(trabalho.estampaIds);
        });
      return equivalentes
        ? NextResponse.json({ loteId, quantidade: trabalhos.length })
        : erro("Este lote já foi salvo com outra configuração.", 409);
    };

    const existente = await verificarLote();
    if (existente) return existente;

    const idsMockups = [...new Set(trabalhos.map(({ mockupId }) => mockupId))];
    if (idsMockups.some((id) => !mockupPorId(id))) return erro("Selecione mockups válidos.", 400);
    const bucket = process.env.GOOGLE_CLOUD_MOCKUPS_BUCKET?.trim();
    if (!bucket) return erro("O armazenamento de mockups ainda não foi configurado.", 503);

    const [estampasAtivas, mockupsExistem] = await Promise.all([
      prisma.estampaCatalogoIa.count({ where: { id: { in: estampas.map(BigInt) }, isActive: true } }),
      existemGoogleStorageObjetos(bucket, idsMockups.map((id) => `mockups/${escopo.aplicativoId}/${id}.webp`)),
    ]);
    if (estampasAtivas !== estampas.length || !mockupsExistem) {
      return erro("Uma estampa ou um mockup ficou indisponível. Revise a seleção.", 422);
    }

    try {
      await prisma.filaMockup.create({ data: { ...chave, trabalhos, observacao } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const concorrente = await verificarLote();
        if (concorrente) return concorrente;
      }
      throw error;
    }

    return NextResponse.json({ loteId, quantidade: trabalhos.length }, { status: 201 });
  } catch {
    return erro("Não foi possível salvar o lote na fila. Tente novamente.", 503);
  }
}
