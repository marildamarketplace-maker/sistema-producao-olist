import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { gerarDatasRecorrencia } from "@/lib/recorrencia-tarefas-midia";
import { getUsuarioAutenticado } from "@/lib/usuario-autenticado";

async function usuarioComAcesso(request: Request) {
  const autenticado = await getUsuarioAutenticado(request);
  const usuario = await prisma.usuario.findUnique({ where: { id: autenticado.id }, select: { id: true, aplicativoId: true, podeVisualizarTarefasMidia: true } });
  if (!usuario?.podeVisualizarTarefasMidia) throw new Error("Sem permissão para acessar a gestão de tarefas.");
  return usuario;
}

function limiteData(valor: string | null, fallback: Date) {
  return valor && /^\d{4}-\d{2}-\d{2}$/.test(valor) ? new Date(`${valor}T12:00:00Z`) : fallback;
}

export async function GET(request: Request) {
  try {
    const usuario = await usuarioComAcesso(request);
    const params = new URL(request.url).searchParams;
    const hoje = new Date();
    const inicio = limiteData(params.get("inicio"), new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate() - 7)));
    const fim = limiteData(params.get("fim"), new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate() + 30)));
    if (fim < inicio || fim.getTime() - inicio.getTime() > 370 * 86_400_000) throw new Error("O período deve ter no máximo 370 dias.");

    const tarefasAtivas = await prisma.tarefaMidia.findMany({ where: { aplicativoId: usuario.aplicativoId, ativa: true, dataInicio: { lte: fim }, OR: [{ dataEncerramento: null }, { dataEncerramento: { gte: inicio } }] } });
    const novas = tarefasAtivas.flatMap((tarefa) => gerarDatasRecorrencia(tarefa, inicio, fim).map((dataPrevista) => ({ aplicativoId: usuario.aplicativoId, tarefaId: tarefa.id, dataPrevista })));
    if (novas.length) await prisma.ocorrenciaTarefaMidia.createMany({ data: novas, skipDuplicates: true });

    const inicioConsulta = new Date(`${inicio.toISOString().slice(0, 10)}T00:00:00-03:00`);
    const fimConsulta = new Date(`${fim.toISOString().slice(0, 10)}T23:59:59-03:00`);
    const ocorrencias = await prisma.ocorrenciaTarefaMidia.findMany({
      where: {
        aplicativoId: usuario.aplicativoId,
        dataPrevista: { gte: inicioConsulta, lte: fimConsulta },
        ...((params.get("periodicidade") || params.get("responsavelId")) ? { tarefa: {
          ...(params.get("periodicidade") ? { periodicidade: params.get("periodicidade") as "DIARIA" | "SEMANAL" | "QUINZENAL" | "MENSAL" } : {}),
          ...(params.get("responsavelId") ? { responsavelId: params.get("responsavelId") } : {}),
        } } : {}),
        ...(params.get("tarefaId") ? { tarefaId: params.get("tarefaId")! } : {}),
      },
      include: { tarefa: { include: { responsavel: { select: { id: true, nome: true } } } }, usuarioConclusao: { select: { id: true, nome: true } } },
      orderBy: { dataPrevista: "asc" },
    });
    const agora = Date.now();
    const resultado = ocorrencias.map((item) => ({ ...item, statusExibicao: item.status === "PENDENTE" && item.dataPrevista.getTime() < agora ? "ATRASADA" : item.status }));
    const status = params.get("status");
    return NextResponse.json({ ocorrencias: status ? resultado.filter((item) => item.statusExibicao === status) : resultado });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Erro ao listar ocorrências." }, { status: 400 }); }
}

export async function PATCH(request: Request) {
  try {
    const usuario = await usuarioComAcesso(request);
    const body = await request.json() as Record<string, unknown>;
    const ids = Array.isArray(body.ids)
      ? [...new Set(body.ids.map((valor) => String(valor).trim()).filter(Boolean))]
      : [];
    if (ids.length > 0) {
      if (ids.length > 500) throw new Error("Selecione no máximo 500 ocorrências por vez.");
      if (body.status !== "CONCLUIDA") throw new Error("A ação em lote disponível é concluir ocorrências.");

      const resultado = await prisma.ocorrenciaTarefaMidia.updateMany({
        where: {
          id: { in: ids },
          aplicativoId: usuario.aplicativoId,
          status: { not: "CONCLUIDA" },
        },
        data: {
          status: "CONCLUIDA",
          dataConclusao: new Date(),
          usuarioConclusaoId: usuario.id,
        },
      });

      return NextResponse.json({ atualizadas: resultado.count });
    }

    const id = String(body.id ?? "");
    const existente = await prisma.ocorrenciaTarefaMidia.findFirst({ where: { id, aplicativoId: usuario.aplicativoId } });
    if (!existente) throw new Error("Ocorrência não encontrada.");
    const status = String(body.status ?? "");
    if (!["PENDENTE", "EM_ANDAMENTO", "CONCLUIDA", "IGNORADA"].includes(status)) throw new Error("Status inválido.");
    const observacao = String(body.observacao ?? "").trim() || null;
    const linksRelacionados = (Array.isArray(body.linksRelacionados) ? body.linksRelacionados : [body.linkRelacionado]).map((valor) => String(valor ?? "").trim()).filter(Boolean);
    for (const link of linksRelacionados) { try { new URL(link); } catch { throw new Error("Todos os links relacionados devem ser URLs válidas."); } }
    const concluida = status === "CONCLUIDA";
    const ocorrencia = await prisma.ocorrenciaTarefaMidia.update({
      where: { id },
      data: { status: status as "PENDENTE" | "EM_ANDAMENTO" | "CONCLUIDA" | "IGNORADA", observacao, linksRelacionados, dataConclusao: concluida ? new Date() : null, usuarioConclusaoId: concluida ? usuario.id : null },
      include: { tarefa: { include: { responsavel: { select: { id: true, nome: true } } } }, usuarioConclusao: { select: { id: true, nome: true } } },
    });
    return NextResponse.json({ ocorrencia: { ...ocorrencia, statusExibicao: ocorrencia.status } });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Erro ao atualizar ocorrência." }, { status: 400 }); }
}
