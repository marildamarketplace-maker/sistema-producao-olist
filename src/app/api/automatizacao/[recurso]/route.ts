import { revisaoRotina } from "@/lib/automatizacao/revisao-rotina";
import { lerCorpoLimitado } from "@/lib/ler-corpo-limitado";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { habilidadeSchema, rotinaSchema, statusExecucao } from "@/lib/automatizacao/contrato";
import { aplicativoTemJob, CHAVES_JOB } from "@/lib/aplicativo-jobs";
import { normalizarDestinatariosWhatsapp } from "@/lib/notification";

type Contexto = { params: Promise<{ recurso: string }> };
class ErroHttp extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

async function autorizar(request: Request) {
  const token = request.headers.get("authorization");
  if (!token?.startsWith("Bearer ")) throw new ErroHttp(401, "Não autenticado.");
  const { data, error } = await supabaseAdmin.auth.getUser(token.slice(7));
  if (error || !data.user) throw new ErroHttp(401, "Sessão inválida.");
  const select = {
    ativo: true, aplicativoId: true, podeVisualizarAutomatizacao: true,
    podeEditarHabilidades: true, podeGerenciarRotinas: true, podeIntervirAutomatizacao: true,
  } as const;
  let usuario = await prisma.usuario.findUnique({ where: { id: data.user.id }, select });
  const email = data.user.email?.trim();
  if (!usuario && email && data.user.email_confirmed_at) {
    // Cadastros legados podem ter um UUID diferente do Supabase Auth.
    // Um e-mail compartilhado por mais de um cadastro exige vínculo explícito.
    const cadastros = await prisma.usuario.findMany({
      where: { email: { equals: email, mode: "insensitive" } },
      select,
      take: 2,
    });
    if (cadastros.length === 1) usuario = cadastros[0];
  }
  if (!usuario?.ativo || !usuario.podeVisualizarAutomatizacao) throw new ErroHttp(403, "Acesso restrito.");
  return usuario;
}

function erro(error: unknown) {
  if (error instanceof ErroHttp) return Response.json({ error: error.message }, { status: error.status });
  if (error instanceof z.ZodError || error instanceof SyntaxError) {
    return Response.json({ error: "Revise os campos informados." }, { status: 400 });
  }
  return Response.json({ error: "Falha na operação de automatização." }, { status: 500 });
}

export async function GET(request: Request, contexto: Contexto) {
  try {
    const { aplicativoId } = await autorizar(request);
    const { recurso } = await contexto.params;
    if (recurso === "habilidades") {
      return Response.json(await prisma.habilidadeAutomatizacao.findMany({
        where: { aplicativoId }, orderBy: [{ arquivada: "asc" }, { nome: "asc" }],
        include: { versoes: { orderBy: { numero: "desc" }, take: 1 } },
      }));
    }
    if (recurso === "rotinas") {
      const rotinas = await prisma.rotinaAutomatizacao.findMany({
        where: { aplicativoId }, orderBy: [{ arquivada: "asc" }, { nome: "asc" }],
      });
      return Response.json(rotinas.map((rotina) => ({ ...rotina, revisao: revisaoRotina(rotina) })));
    }
    if (recurso !== "historico") throw new ErroHttp(404, "Recurso inexistente.");
    const busca = new URL(request.url).searchParams;
    const filtros = z.object({
      rotinaId: z.uuid().optional(), status: z.enum(statusExecucao).optional(), tipo: z.enum(["EXECUTAR_PROMPT", "TESTE_ROTINA"]).optional(),
      whatsapp: z.enum(["PENDENTE", "SUCESSO", "ERRO", "NAO_APLICAVEL"]).optional(),
      desde: z.iso.date().optional(), pagina: z.coerce.number().int().min(0).max(1000).default(0),
    }).parse(Object.fromEntries(busca));
    const periodo = filtros.desde ? { gte: new Date(`${filtros.desde}T03:00:00Z`) } : undefined;
    const whatsapp = filtros.whatsapp;
    const filtroAvisos = whatsapp === "NAO_APLICAVEL"
      ? { none: { avisos: { some: {} } } } as const
      : whatsapp ? { some: { avisos: { some: { notification: { status: whatsapp } } } } } : undefined;
    const [execucoes, disparos] = await Promise.all([
      prisma.execucaoAutomatizacao.findMany({
        where: { aplicativoId, rotinaId: filtros.rotinaId, status: filtros.status, tipo: filtros.tipo, previstoEm: periodo, tentativas: filtroAvisos },
        orderBy: [{ previstoEm: "desc" }, { id: "desc" }], skip: filtros.pagina * 25, take: 26,
        select: {
          id: true, status: true, tipo: true, previstoEm: true, rotina: { select: { nome: true } },
          versao: { select: { numero: true } },
          tentativas: {
            orderBy: { iniciadaEm: "desc" },
            select: { iniciadaEm: true, encerradaEm: true, status: true, resultado: true,
              avisos: { select: { notification: { select: { id: true, status: true } } } } },
          },
        },
      }),
      prisma.disparoAutomatizacao.findMany({
        where: { aplicativoId, rotinaId: filtros.rotinaId, previstoEm: periodo, motivo: { not: "ENFILEIRADO" } },
        orderBy: [{ previstoEm: "desc" }, { rotinaId: "asc" }], skip: filtros.pagina * 25, take: 26,
        select: { rotina: { select: { nome: true } }, previstoEm: true, motivo: true },
      }),
    ]);
    return Response.json({ execucoes: execucoes.slice(0, 25), disparos: disparos.slice(0, 25), temMais: execucoes.length > 25 || disparos.length > 25 });
  } catch (error) { return erro(error); }
}

async function alterar(request: Request, contexto: Contexto) {
  try {
    const usuario = await autorizar(request);
    const { aplicativoId } = usuario;
    const { recurso } = await contexto.params;
    const id = request.method === "POST" && recurso !== "historico" ? undefined
      : z.uuid().parse(new URL(request.url).searchParams.get("id"));
    const arquivar = request.method === "DELETE";
    let corpo: unknown;
    if (!arquivar && recurso !== "historico" && recurso !== "testar-rotina") {
      const texto = await lerCorpoLimitado(request, 200_000);
      if (texto === null) throw new ErroHttp(413, "O conteúdo excede o tamanho permitido.");
      corpo = JSON.parse(texto);
    }

    if (recurso === "habilidades") {
      if (!usuario.podeEditarHabilidades) throw new ErroHttp(403, "Acesso restrito.");
      const dados = arquivar ? null : habilidadeSchema.parse(corpo);
      await prisma.$transaction(async (tx) => {
        if (!id && dados) {
          await tx.habilidadeAutomatizacao.create({
            data: { aplicativoId, nome: dados.nome, versoes: { create: { numero: 1, markdown: dados.markdown } } },
          });
          return;
        }
        const [habilidade] = await tx.$queryRaw<{ id: string; arquivada: boolean }[]>`
          SELECT id, arquivada FROM automatizacao_habilidade WHERE id = ${id}::uuid
          AND "aplicativoId" = ${aplicativoId}::uuid FOR UPDATE
        `;
        if (!habilidade || habilidade.arquivada) throw new ErroHttp(404, "Habilidade indisponível.");
        if (arquivar) {
          const emUso = await tx.rotinaAutomatizacao.count({ where: { aplicativoId, habilidadeId: id, ativa: true } });
          if (emUso) throw new ErroHttp(409, "Pause as rotinas vinculadas antes de arquivar.");
          await tx.habilidadeAutomatizacao.update({ where: { id }, data: { arquivada: true } });
        } else if (dados) {
          const anterior = await tx.versaoHabilidadeAutomatizacao.findFirstOrThrow({
            where: { habilidadeId: id, aplicativoId }, orderBy: { numero: "desc" },
          });
          await tx.habilidadeAutomatizacao.update({ where: { id }, data: { nome: dados.nome } });
          await tx.versaoHabilidadeAutomatizacao.create({
            data: { aplicativoId, habilidadeId: habilidade.id, numero: anterior.numero + 1, markdown: dados.markdown },
          });
        }
      });
    } else if (recurso === "testar-rotina" && request.method === "POST") {
      if (!usuario.podeIntervirAutomatizacao) throw new ErroHttp(403, "Acesso restrito.");
      const rotinaId = z.uuid().parse(new URL(request.url).searchParams.get("id"));
      const execucao = await prisma.$transaction(async (tx) => {
        const [rotina] = await tx.$queryRaw<{ habilidadeId: string }[]>`
          SELECT "habilidadeId" FROM automatizacao_rotina
          WHERE id = ${rotinaId}::uuid AND "aplicativoId" = ${aplicativoId}::uuid AND NOT arquivada
          FOR UPDATE
        `;
        if (!rotina) throw new ErroHttp(404, "Rotina indisponível.");
        const existente = await tx.execucaoAutomatizacao.findFirst({
          where: { aplicativoId, rotinaId, tipo: { not: "TESTE_ROTINA" }, status: { not: "CONCLUIDA" } },
          select: { id: true, status: true },
        });
        if (existente?.status === "FALHA_FINAL") {
          await tx.execucaoAutomatizacao.updateMany({
            where: { id: existente.id, aplicativoId, status: "FALHA_FINAL" },
            data: { status: "PENDENTE", disponivelEm: new Date(), tentativa: 0, rodada: { increment: 1 } },
          });
          return { id: existente.id, situacao: "REENFILEIRADA" };
        }
        if (existente?.status === "EM_EXECUCAO") return { id: existente.id, situacao: "EM_EXECUCAO" };
        if (existente) {
          await tx.execucaoAutomatizacao.updateMany({
            where: { id: existente.id, aplicativoId, status: { in: ["PENDENTE", "AGUARDANDO_RETRY"] } },
            data: { disponivelEm: new Date() },
          });
          return { id: existente.id, situacao: "NA_FILA" };
        }
        const versao = await tx.versaoHabilidadeAutomatizacao.findFirst({
          where: { aplicativoId, habilidadeId: rotina.habilidadeId, habilidade: { arquivada: false } },
          orderBy: { numero: "desc" }, select: { id: true },
        });
        if (!versao) throw new ErroHttp(409, "A habilidade da rotina está indisponível.");
        const agora = Date.now();
        return tx.execucaoAutomatizacao.create({
          data: {
            aplicativoId, rotinaId, tipo: "EXECUTAR_PROMPT", versaoId: versao.id,
            previstoEm: new Date(agora % 60_000 === 0 ? agora + 1 : agora),
          },
          select: { id: true },
        });
      });
      return Response.json({ situacao: "CRIADA", ...execucao });
    } else if (recurso === "rotinas") {
      if (!usuario.podeGerenciarRotinas) throw new ErroHttp(403, "Acesso restrito.");
      const revisao = z.string().regex(/^[a-f0-9]{64}$/);
      const pausaOuAtivacao = request.method === "PATCH" && new URL(request.url).searchParams.get("acao") === "status";
      const status = pausaOuAtivacao ? z.object({ ativa: z.boolean(), revisao }).parse(corpo) : null;
      const dados = arquivar || status ? null : rotinaSchema.parse(corpo);
      const esperada = id && !arquivar
        ? status?.revisao ?? z.object({ revisao }).parse(corpo).revisao
        : undefined;

      await prisma.$transaction(async (tx) => {
        // O arquivamento de habilidades e o salvamento de rotinas usam a mesma ordem de locks.
        const habilidadeId = dados?.habilidadeId ?? (status?.ativa && id
          ? (await tx.rotinaAutomatizacao.findFirst({ where: { id, aplicativoId, arquivada: false } }))?.habilidadeId
          : undefined);
        if (habilidadeId) {
          const [habilidade] = await tx.$queryRaw<{ id: string }[]>`
            SELECT id FROM automatizacao_habilidade WHERE id = ${habilidadeId}::uuid
            AND "aplicativoId" = ${aplicativoId}::uuid AND NOT arquivada FOR UPDATE
          `;
          if (!habilidade) throw new ErroHttp(400, "Selecione uma habilidade ativa.");
        }

        const atual = id ? await tx.$queryRaw<{
          nome: string; habilidadeId: string; ativa: boolean; horarios: Parameters<typeof revisaoRotina>[0]["horarios"];
        }[]>`
          SELECT nome, "habilidadeId", ativa, horarios FROM automatizacao_rotina
          WHERE id = ${id}::uuid AND "aplicativoId" = ${aplicativoId}::uuid AND NOT arquivada FOR UPDATE
        ` : [];
        if (id && !atual[0]) throw new ErroHttp(404, "Rotina indisponível.");
        if (esperada && revisaoRotina(atual[0]) !== esperada) {
          throw new ErroHttp(409, "A rotina mudou. Atualize a lista e abra a edição novamente.");
        }
        if (status?.ativa || (!id && dados?.ativa)) {
          const app = await tx.aplicativo.findUniqueOrThrow({ where: { id: aplicativoId }, select: { jobs: true, whatsapp: true } });
          try {
            if (!aplicativoTemJob(app.jobs, CHAVES_JOB.NOTIFICAR)) throw new Error();
            normalizarDestinatariosWhatsapp(app.whatsapp);
          } catch { throw new ErroHttp(409, "Configure o WhatsApp e habilite o job de notificações do aplicativo."); }
        }

        if (!id && dados) {
          await tx.rotinaAutomatizacao.create({ data: { ...dados, aplicativoId } });
          return;
        }
        const alteracao = arquivar ? { ativa: false, arquivada: true }
          : status ? { ativa: status.ativa, ...(status.ativa && !atual[0].ativa ? { cursor: new Date() } : {}) }
          : dados ? { nome: dados.nome, habilidadeId: dados.habilidadeId, horarios: dados.horarios, cursor: new Date() }
          : {};
        await tx.rotinaAutomatizacao.updateMany({ where: { id, aplicativoId, arquivada: false }, data: alteracao });
      });
    } else if (recurso === "historico" && request.method === "POST") {
      if (!usuario.podeIntervirAutomatizacao) throw new ErroHttp(403, "Acesso restrito.");
      if (new URL(request.url).searchParams.get("acao") === "reenviar") {
        const alterada = await prisma.notification.updateMany({
          where: { id, status: "ERRO", avisoAutomatizacao: { tentativa: { execucao: { aplicativoId } } } },
          data: { status: "PENDENTE", tentativas: 0, data: new Date(), ultimoErro: null, workerId: null, processandoEm: null },
        });
        if (!alterada.count) throw new ErroHttp(409, "A notificação não está disponível para reenvio.");
        return Response.json({ ok: true });
      }
      const atualizada = await prisma.execucaoAutomatizacao.updateMany({
        where: { id, aplicativoId, tipo: { not: "TESTE_ROTINA" }, status: "FALHA_FINAL" },
        data: { status: "PENDENTE", disponivelEm: new Date(), tentativa: 0, rodada: { increment: 1 } },
      });
      if (!atualizada.count) throw new ErroHttp(409, "A execução não está disponível para retentativa.");
    } else {
      throw new ErroHttp(404, "Recurso inexistente.");
    }
    return Response.json({ ok: true });
  } catch (error) { return erro(error); }
}

export { alterar as POST, alterar as PATCH, alterar as DELETE };
