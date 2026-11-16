import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsuarioAutenticado } from "@/lib/usuario-autenticado";
import { ErroAnotarSku, type JobSkuResumo } from "./contrato";
import { criarRepositorioAnotarSku, type EscopoSku } from "@/repositories/anotar-sku-repository";
import type { BuscaSkuJob } from "@prisma/client";

export const repoSku = criarRepositorioAnotarSku(prisma);
export const filaSkuHabilitada = () => process.env.ANOTAR_SKU_ASYNC_ENABLED === "true";
export async function autenticarSku(request: Request, permissao: "read" | "write" | "jobs") {
  let autenticado: Awaited<ReturnType<typeof getUsuarioAutenticado>>;
  try { autenticado = await getUsuarioAutenticado(request); }
  catch { throw new ErroAnotarSku("Sua sessão expirou. Entre novamente para continuar.", 401); }
  const usuario = await prisma.usuario.findUnique({ where: { id: autenticado.id }, select: {
    id: true, ativo: true, aplicativoId: true, podeEscreverAnotarSku: true, podeVisualizarAnotarSku: true,
  } });
  const permitido = usuario?.ativo && (permissao === "write" ? usuario.podeEscreverAnotarSku
    : permissao === "read" ? usuario.podeVisualizarAnotarSku : usuario.podeEscreverAnotarSku || usuario.podeVisualizarAnotarSku);
  if (!usuario || !permitido) throw new ErroAnotarSku("Você não tem permissão para esta operação.", 403);
  return { id: usuario.id, aplicativoId: usuario.aplicativoId, podeVisualizar: usuario.podeVisualizarAnotarSku, podeEscrever: usuario.podeEscreverAnotarSku };
}
export function resumoJobSku(job: BuscaSkuJob, escopo: EscopoSku & { podeEscrever: boolean }): JobSkuResumo {
  return {
    id: job.id, situacoes: job.situacoes, status: job.status, etapa: job.etapa, passagem: job.passagem,
    encontrados: job.encontrados, processados: job.processados, ignorados: job.ignorados, tentativas: job.tentativas,
    proximaTentativaEm: job.proximaTentativaEm.toISOString(), createdAt: job.createdAt.toISOString(), updatedAt: job.updatedAt.toISOString(),
    finalizadoEm: job.finalizadoEm?.toISOString() ?? null, erro: job.erro, buscaId: job.buscaId,
    resultadoRemovido: job.teveResultado && !job.buscaId,
    podeGerenciar: escopo.podeEscrever && (job.solicitadoPor === escopo.id || escopo.podeVisualizar),
  };
}
export function erroRespostaSku(erro: unknown) {
  if (erro instanceof ErroAnotarSku) return NextResponse.json({ error: erro.message }, { status: erro.status });
  console.error("[anotar-sku] Falha interna.", { tipo: erro instanceof Error ? erro.name : "UnknownError" });
  return NextResponse.json({ error: "Não foi possível concluir a operação. Tente novamente em instantes." }, { status: 503 });
}
