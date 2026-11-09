import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { pedidoFilaMockups } from "@/lib/fila-mockups";
import { mockupPorId } from "@/lib/mockups-imagem";
import { prisma } from "@/lib/prisma";
import { getUsuarioAutenticado } from "@/lib/usuario-autenticado";
import { existemGoogleStorageObjetos } from "@/services/googleStorageService";

const MAX_CORPO = 512 * 1024;

function erro(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

export async function POST(request: Request) {
  let autenticado;
  try {
    autenticado = await getUsuarioAutenticado(request);
  } catch {
    return erro("Sessão inválida ou expirada.", 401);
  }

  try {
    const usuario = await prisma.usuario.findUnique({
      where: { id: autenticado.id },
      select: { ativo: true, aplicativoId: true, podeEditarEstampas: true },
    });
    if (!usuario?.ativo || !usuario.podeEditarEstampas) {
      return erro("Sem permissão para criar mockups.", 403);
    }

    const texto = await lerCorpo(request);
    if (texto === null) return erro("O lote excede o tamanho máximo.", 413);
    let corpo: unknown;
    try { corpo = JSON.parse(texto); }
    catch { return erro("Envie um lote válido.", 400); }

    const pedido = pedidoFilaMockups.safeParse(corpo);
    if (!pedido.success) return erro("Revise os vínculos e os limites do lote antes de salvar.", 400);

    const { loteId, estampas, trabalhos } = pedido.data;
    const chave = { aplicativoId: usuario.aplicativoId, solicitadoPor: autenticado.id, id: loteId };
    const where = { aplicativoId_solicitadoPor_id: chave };
    const verificarLote = async () => {
      const salvo = await prisma.filaMockup.findUnique({ where, select: { trabalhos: true } });
      if (!salvo) return null;
      const anteriores = salvo.trabalhos;
      const equivalentes = Array.isArray(anteriores) && anteriores.length === trabalhos.length
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
      existemGoogleStorageObjetos(bucket, idsMockups.map((id) => `mockups/${usuario.aplicativoId}/${id}.webp`)),
    ]);
    if (estampasAtivas !== estampas.length || !mockupsExistem) {
      return erro("Uma estampa ou um mockup ficou indisponível. Revise a seleção.", 422);
    }

    try {
      await prisma.filaMockup.create({ data: { ...chave, trabalhos } });
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

async function lerCorpo(request: Request) {
  if (Number(request.headers.get("content-length")) > MAX_CORPO) return null;
  const reader = request.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let bytes = 0;
  let texto = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return texto + decoder.decode();
      bytes += value.byteLength;
      if (bytes > MAX_CORPO) {
        await reader.cancel();
        return null;
      }
      texto += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
}
