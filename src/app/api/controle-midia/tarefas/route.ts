import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsuarioAutenticado } from "@/lib/usuario-autenticado";

const periodicidades = ["DIARIA", "SEMANAL", "QUINZENAL", "MENSAL"] as const;
const prioridades = ["ALTA", "MEDIA", "BAIXA"] as const;

async function usuarioComAcesso(request: Request) {
  const autenticado = await getUsuarioAutenticado(request);
  const usuario = await prisma.usuario.findUnique({
    where: { id: autenticado.id },
    select: { id: true, aplicativoId: true, podeVisualizarTarefasMidia: true },
  });
  if (!usuario?.podeVisualizarTarefasMidia) throw new Error("Sem permissão para acessar a gestão de tarefas.");
  return usuario;
}

function textoOpcional(valor: unknown) {
  const texto = String(valor ?? "").trim();
  return texto || null;
}

function dataLocal(valor: unknown, campo: string) {
  const texto = String(valor ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(texto)) throw new Error(`Informe ${campo}.`);
  return new Date(`${texto}T12:00:00Z`);
}

function validarUrl(valor: string | null, campo: string) {
  if (!valor) return;
  try { new URL(valor); } catch { throw new Error(`${campo} deve ser uma URL válida.`); }
}

async function dadosTarefa(body: Record<string, unknown>, aplicativoId: string) {
  const nome = String(body.nome ?? "").trim();
  const descricao = String(body.descricao ?? "").trim();
  const periodicidade = String(body.periodicidade ?? "") as (typeof periodicidades)[number];
  const prioridade = String(body.prioridade ?? "") as (typeof prioridades)[number];
  const dataInicio = dataLocal(body.dataInicio, "a data de início");
  const dataEncerramento = body.dataEncerramento ? dataLocal(body.dataEncerramento, "a data de encerramento") : null;
  const linksApoio = (Array.isArray(body.linksApoio) ? body.linksApoio : [body.linkApoio]).map(textoOpcional).filter((link): link is string => Boolean(link));
  const responsavelId = textoOpcional(body.responsavelId);
  const horaPrevista = textoOpcional(body.horaPrevista);
  const diasSemana = Array.isArray(body.diasSemana) ? [...new Set(body.diasSemana.map(Number))].filter((dia) => Number.isInteger(dia) && dia >= 0 && dia <= 6) : [];
  const diaMes = body.diaMes ? Number(body.diaMes) : null;
  const ordinalSemanaMes = body.ordinalSemanaMes ? Number(body.ordinalSemanaMes) : null;
  const diaSemanaMensal = body.diaSemanaMensal === "" || body.diaSemanaMensal === null || body.diaSemanaMensal === undefined ? null : Number(body.diaSemanaMensal);
  if (nome.length < 2) throw new Error("Informe o nome da tarefa.");
  if (!descricao) throw new Error("Informe a descrição da tarefa.");
  if (!periodicidades.includes(periodicidade)) throw new Error("Periodicidade inválida.");
  if (!prioridades.includes(prioridade)) throw new Error("Prioridade inválida.");
  if (dataEncerramento && dataEncerramento < dataInicio) throw new Error("A data de encerramento deve ser posterior à data de início.");
  linksApoio.forEach((link) => validarUrl(link, "O link de apoio"));
  if (horaPrevista && !/^([01]\d|2[0-3]):[0-5]\d$/.test(horaPrevista)) throw new Error("Hora prevista inválida.");
  if ((periodicidade === "DIARIA" || periodicidade === "SEMANAL") && !diasSemana.length) throw new Error("Selecione ao menos um dia da semana.");
  if (periodicidade === "SEMANAL" && diasSemana.length !== 1) throw new Error("Selecione um dia para a tarefa semanal.");
  if (periodicidade === "MENSAL" && !(diaMes && diaMes >= 1 && diaMes <= 31) && !(ordinalSemanaMes && ordinalSemanaMes >= 1 && ordinalSemanaMes <= 5 && diaSemanaMensal !== null && diaSemanaMensal >= 0 && diaSemanaMensal <= 6)) throw new Error("Defina o dia do mês ou a regra mensal.");
  if (responsavelId) {
    const responsavel = await prisma.usuario.findFirst({ where: { id: responsavelId, aplicativoId, ativo: true }, select: { id: true } });
    if (!responsavel) throw new Error("Responsável inválido.");
  }
  return { nome, descricao, linksApoio, periodicidade, prioridade, ativa: body.ativa !== false, dataInicio, dataEncerramento, horaPrevista, diasSemana, diaMes: periodicidade === "MENSAL" ? diaMes : null, ordinalSemanaMes: periodicidade === "MENSAL" && !diaMes ? ordinalSemanaMes : null, diaSemanaMensal: periodicidade === "MENSAL" && !diaMes ? diaSemanaMensal : null, responsavelId };
}

const incluir = { responsavel: { select: { id: true, nome: true } }, _count: { select: { ocorrencias: true } } } as const;

export async function GET(request: Request) {
  try {
    const usuario = await usuarioComAcesso(request);
    const [tarefas, responsaveis] = await Promise.all([
      prisma.tarefaMidia.findMany({ where: { aplicativoId: usuario.aplicativoId }, include: incluir, orderBy: [{ ativa: "desc" }, { nome: "asc" }] }),
      prisma.usuario.findMany({ where: { aplicativoId: usuario.aplicativoId, ativo: true }, select: { id: true, nome: true }, orderBy: { nome: "asc" } }),
    ]);
    return NextResponse.json({ tarefas, responsaveis });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Erro ao listar tarefas." }, { status: 403 }); }
}

export async function POST(request: Request) {
  try {
    const usuario = await usuarioComAcesso(request);
    const body = await request.json() as Record<string, unknown>;
    const data = await dadosTarefa(body, usuario.aplicativoId);
    const tarefa = await prisma.tarefaMidia.create({ data: { aplicativoId: usuario.aplicativoId, ...data }, include: incluir });
    return NextResponse.json({ tarefa }, { status: 201 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Erro ao criar tarefa." }, { status: 400 }); }
}

export async function PATCH(request: Request) {
  try {
    const usuario = await usuarioComAcesso(request);
    const body = await request.json() as Record<string, unknown>;
    const id = String(body.id ?? "");
    const existente = await prisma.tarefaMidia.findFirst({ where: { id, aplicativoId: usuario.aplicativoId } });
    if (!existente) throw new Error("Tarefa não encontrada.");
    if (body.somenteStatus === true) {
      const tarefa = await prisma.tarefaMidia.update({ where: { id }, data: { ativa: Boolean(body.ativa) }, include: incluir });
      if (!tarefa.ativa) await prisma.ocorrenciaTarefaMidia.deleteMany({ where: { tarefaId: id, dataPrevista: { gte: new Date() }, status: { in: ["PENDENTE", "EM_ANDAMENTO"] } } });
      return NextResponse.json({ tarefa });
    }
    const data = await dadosTarefa(body, usuario.aplicativoId);
    const tarefa = await prisma.tarefaMidia.update({ where: { id }, data, include: incluir });
    await prisma.ocorrenciaTarefaMidia.deleteMany({ where: { tarefaId: id, dataPrevista: { gte: new Date() }, status: { in: ["PENDENTE", "EM_ANDAMENTO"] } } });
    return NextResponse.json({ tarefa });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Erro ao atualizar tarefa." }, { status: 400 }); }
}

export async function DELETE(request: Request) {
  try {
    const usuario = await usuarioComAcesso(request);
    const id = new URL(request.url).searchParams.get("id") ?? "";
    const tarefa = await prisma.tarefaMidia.findFirst({ where: { id, aplicativoId: usuario.aplicativoId }, select: { id: true } });
    if (!tarefa) throw new Error("Tarefa não encontrada.");
    await prisma.tarefaMidia.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Erro ao excluir tarefa." }, { status: 400 }); }
}
