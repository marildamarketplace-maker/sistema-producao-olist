import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { prisma } from "@/lib/prisma";
import { getUsuarioAutenticado } from "@/lib/usuario-autenticado";
import { lerUploadVisual } from "@/lib/estampas-visuais/upload";
import { ErroBuscaVisual } from "@/lib/estampas-visuais/imagem";
import { cadastrarEstampaManual, cadastroEstampaSchema, EstampaDuplicadaError } from "@/services/cadastrarEstampaManualService";
import { obterConfiguracaoJobEstampas } from "@/repositories/configuracao-jobs-repository";
import { varianteEstampaPermitida } from "@/domain/filtro-variante-estampa";
import { nomeArquivoEstampaDeveSerIgnorado } from "@/domain/filtro-nome-arquivo-estampa";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: Request) {
  let usuario;
  try { usuario = await getUsuarioAutenticado(request); }
  catch { return NextResponse.json({ error: "Autenticação necessária." }, { status: 401 }); }
  try {
    const permissao = await prisma.usuario.findUnique({ where: { id: usuario.id }, select: { podeEditarEstampas: true } });
    if (!permissao?.podeEditarEstampas) return NextResponse.json({ error: "Sem permissão para cadastrar estampas." }, { status: 403 });
    const recentes = await prisma.estampaJob.count({ where: { manualRequestedBy: usuario.id, manualRequestedAt: { gte: new Date(Date.now() - 60_000) } } });
    if (recentes >= 10) return NextResponse.json({ error: "Aguarde um minuto antes de enviar mais imagens." }, { status: 429 });
    // Mantém margem abaixo do limite de corpo das Functions da hospedagem.
    if (Number(request.headers.get("content-length")) > 4 * 1024 * 1024 + 65536) throw new ErroBuscaVisual("Envie uma imagem de até 4 MB.", 413);
    const form = await lerUploadVisual(request, 4 * 1024 * 1024);
    const campos = cadastroEstampaSchema.parse({ codigo: form.get("codigo"), variante: form.get("variante") });
    const arquivo = form.get("imagem");
    if (arquivo instanceof File && arquivo.size > 4 * 1024 * 1024) throw new ErroBuscaVisual("Envie uma imagem de até 4 MB.", 413);
    if (!(arquivo instanceof File)) throw new ErroBuscaVisual("Selecione uma imagem.");
    const configuracao = await obterConfiguracaoJobEstampas();
    const resultado = await cadastrarEstampaManual({ ...campos, bytes: Buffer.from(await arquivo.arrayBuffer()), usuarioId: usuario.id });
    const motivos = [
      configuracao.pausado ? "processamento global pausado" : null,
      !varianteEstampaPermitida(campos.variante, configuracao.variantesPermitidas) ? "variante fora dos filtros permitidos" : null,
      nomeArquivoEstampaDeveSerIgnorado(`${campos.codigo}-${campos.variante}.jpg`, configuracao.termosIgnoradosNomeArquivo) ? "nome bloqueado pelos filtros" : null,
    ].filter(Boolean);
    return NextResponse.json({ ...resultado, statusUrl: `/api/estampas/jobs?codigo=${encodeURIComponent(campos.codigo)}&variante=${encodeURIComponent(campos.variante)}`, mensagem: motivos.length ? `Imagem cadastrada e enfileirada. Aguardando: ${motivos.join("; ")}.` : "Imagem cadastrada e enfileirada para processamento pela IA." }, { status: 202 });
  } catch (error) {
    if (error instanceof EstampaDuplicadaError) return NextResponse.json({ error: error.message, existente: error.existente }, { status: 409 });
    if (error instanceof ZodError) return NextResponse.json({ error: "Informe código e variante válidos (até 100 caracteres, sem barras)." }, { status: 400 });
    if (error instanceof ErroBuscaVisual) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "Não foi possível cadastrar a imagem. Consulte o catálogo antes de tentar novamente." }, { status: 503 });
  }
}
