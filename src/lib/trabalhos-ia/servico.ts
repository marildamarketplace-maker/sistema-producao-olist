import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import type { BancoIa, SqlIa } from "./banco";
import { comporPromptIa, type RegistroIa } from "./registro";
import { ErroTrabalhoIa, type EscopoIa, type FaseIa, type OperacaoIa, type TrabalhoIaResumo, type WorkerIa } from "./contrato";

type Trabalho = {
  id: string; aplicativoId: string; solicitadoPor: string; tipo: string; origemId: string;
  status: string; fase: FaseIa; promptGeracao: string; promptRevisao: string; promptPersonalizado: string;
  revisaoConfig: number; cursor: string | null; total: number; processados: number;
  totalLotes: number; loteAtual: number; tentativas: number; erro: string | null;
  reserva: string | null; reservaAte: Date | null; worker: string | null; criadoEm: Date; finalizadoEm: Date | null;
};
const camposResumo = Prisma.sql`id,tipo,origem_id AS "origemId",status,fase,total,processados,erro,criado_em AS "criadoEm",finalizado_em AS "finalizadoEm",revisao_config AS "revisaoConfig"`;
const campos = Prisma.sql`${camposResumo},aplicativo_id AS "aplicativoId",solicitado_por AS "solicitadoPor",
  prompt_geracao AS "promptGeracao",prompt_revisao AS "promptRevisao",prompt_personalizado AS "promptPersonalizado",
  cursor,total_lotes AS "totalLotes",lote_atual AS "loteAtual",tentativas,reserva,reserva_ate AS "reservaAte",worker`;
type ResumoDb = Omit<TrabalhoIaResumo, "criadoEm" | "finalizadoEm"> & { criadoEm: Date; finalizadoEm: Date | null };
const resumo = (t: ResumoDb): TrabalhoIaResumo => ({ ...t, criadoEm: t.criadoEm.toISOString(), finalizadoEm: t.finalizadoEm?.toISOString() ?? null });
const ativo = (status: string) => ["PENDENTE", "PROCESSANDO", "AGUARDANDO_RETRY"].includes(status);
async function travarApp(tx: SqlIa, app: string) {
  await tx.consultar(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${'ia:'+app},0))::text`);
}
const contexto = (t: Trabalho) => ({ aplicativoId: t.aplicativoId, solicitadoPor: t.solicitadoPor, origemId: t.origemId, trabalhoId: t.id });

export function criarServicoTrabalhosIa(db: BancoIa, registro: RegistroIa) {
  async function config(tx: SqlIa, app: string, tipo: string) {
    const [salva] = await tx.consultar<{ prompt: string; revisao: number }>(Prisma.sql`SELECT prompt,revisao FROM ia_configuracao WHERE aplicativo_id=${app}::uuid AND tipo=${tipo}`);
    return salva ?? { prompt: registro.obter(tipo).promptPadrao, revisao: 0 };
  }
  async function mudar(tx: SqlIa, t: Trabalho, fase: FaseIa, status = "PENDENTE") {
    await tx.executar(Prisma.sql`UPDATE ia_trabalho SET fase=${fase},status=${status},reserva=NULL,reserva_ate=NULL,worker=NULL,grupo=NULL,
      tentativas=0,erro=NULL,disponivel_em=now(),atualizado_em=now(),finalizado_em=CASE WHEN ${status} IN ('CONCLUIDO','CANCELADO') THEN now() ELSE NULL END WHERE id=${t.id}::uuid`);
  }
  async function falhar(tx: SqlIa, t: Trabalho, codigo: string) {
    const definitiva = ["AUTENTICACAO", "CONFIGURACAO", "PERMISSAO"].includes(codigo) || t.tentativas >= 3;
    const mensagem = codigo === "PERMISSAO" ? "A permissão do solicitante foi revogada."
      : codigo === "AUTENTICACAO" ? "O Codex precisa de novo login na VM."
      : codigo === "CONFIGURACAO" ? "Revise a configuração e a versão do worker."
      : codigo === "RESPOSTA_INVALIDA" ? "A resposta da IA não passou pela validação."
      : "A execução foi interrompida. O progresso confirmado foi preservado.";
    await tx.executar(Prisma.sql`UPDATE ia_tentativa SET status='FALHOU',codigo=${codigo},finalizada_em=now() WHERE id=${t.reserva}::uuid AND finalizada_em IS NULL`);
    await tx.executar(Prisma.sql`UPDATE ia_trabalho SET status=${definitiva ? "FALHOU" : "AGUARDANDO_RETRY"},erro=${mensagem},reserva=NULL,reserva_ate=NULL,worker=NULL,grupo=NULL,
      finalizado_em=CASE WHEN ${definitiva} THEN now() ELSE NULL END,disponivel_em=now()+${60 * 2 ** Math.min(2, Math.max(0,t.tentativas-1))}*interval '1 second',atualizado_em=now() WHERE id=${t.id}::uuid`);
    return { status: definitiva ? "FALHOU" : "AGUARDANDO_RETRY" };
  }
  async function verificarCapacidade(tx: SqlIa, app: string) {
    const [fila] = await tx.consultar<{ total: number }>(Prisma.sql`SELECT count(*)::int AS total FROM ia_trabalho WHERE aplicativo_id=${app}::uuid AND status IN ('PENDENTE','PROCESSANDO','AGUARDANDO_RETRY')`);
    if (fila.total >= 20) throw new ErroTrabalhoIa("Há 20 trabalhos aguardando neste aplicativo. Aguarde uma conclusão.", 429);
  }
  async function autorizarTrabalho(tx: SqlIa, t: Trabalho) {
    await registro.obter(t.tipo).autorizar(tx, { id: t.solicitadoPor, aplicativoId: t.aplicativoId }, "executar");
  }
  return {
    async configuracao(escopo: EscopoIa, tipo: string) {
      const definicao = registro.obter(tipo);
      await definicao.autorizar(db, escopo, "configurar");
      return { ...await config(db, escopo.aplicativoId, tipo), geracao: definicao.promptGeracao, revisaoFixa: definicao.promptRevisao };
    },
    async configurar(escopo: EscopoIa, tipo: string, prompt: string, revisao: number) {
      return db.transacao(async tx => {
        await travarApp(tx, escopo.aplicativoId);
        await registro.obter(tipo).autorizar(tx, escopo, "configurar");
        if ((await config(tx, escopo.aplicativoId, tipo)).revisao !== revisao) throw new ErroTrabalhoIa("A configuração mudou. Reabra para conferir a versão atual.", 409);
        await tx.executar(Prisma.sql`INSERT INTO ia_configuracao(aplicativo_id,tipo,prompt,revisao,atualizado_por) VALUES (${escopo.aplicativoId}::uuid,${tipo},${prompt},${revisao+1},${escopo.id}::uuid)
          ON CONFLICT(aplicativo_id,tipo) DO UPDATE SET prompt=excluded.prompt,revisao=excluded.revisao,atualizado_por=excluded.atualizado_por,atualizado_em=now()`);
        return { prompt, revisao: revisao+1 };
      });
    },
    async solicitar(escopo: EscopoIa, tipo: string, origemId: string, chave: string) {
      return db.transacao(async tx => {
        await travarApp(tx, escopo.aplicativoId);
        const definicao = registro.obter(tipo);
        await definicao.autorizar(tx, escopo, "executar");
        const [anterior] = await tx.consultar<ResumoDb>(Prisma.sql`SELECT ${camposResumo} FROM ia_trabalho WHERE aplicativo_id=${escopo.aplicativoId}::uuid AND solicitado_por=${escopo.id}::uuid AND chave=${chave}::uuid`);
        if (anterior) {
          if (anterior.tipo !== tipo || anterior.origemId !== origemId) throw new ErroTrabalhoIa("Chave já utilizada para outra solicitação.", 409);
          return resumo(anterior);
        }
        await definicao.verificarOrigem(tx, escopo.aplicativoId, origemId);
        const [aberto] = await tx.consultar<ResumoDb>(Prisma.sql`SELECT ${camposResumo} FROM ia_trabalho WHERE aplicativo_id=${escopo.aplicativoId}::uuid AND tipo=${tipo} AND origem_id=${origemId}::uuid AND status IN ('PENDENTE','PROCESSANDO','AGUARDANDO_RETRY')`);
        if (aberto) return resumo(aberto);
        const [worker] = await tx.consultar<{ id: string }>(Prisma.sql`SELECT id FROM ia_worker WHERE aplicativo_id=${escopo.aplicativoId}::uuid AND protocolo=1 AND ${tipo}=ANY(tipos) AND contato_em>now()-interval '3 minutes' LIMIT 1`);
        if (!worker) throw new ErroTrabalhoIa("O worker de IA está indisponível ou ainda não foi atualizado. Aguarde sua conexão.", 503);
        await verificarCapacidade(tx, escopo.aplicativoId);
        const cfg = await config(tx, escopo.aplicativoId, tipo);
        const id = randomUUID();
        const [trabalho] = await tx.consultar<ResumoDb>(Prisma.sql`INSERT INTO ia_trabalho(id,aplicativo_id,solicitado_por,tipo,origem_id,chave,prompt_geracao,prompt_revisao,prompt_personalizado,revisao_config)
          VALUES (${id}::uuid,${escopo.aplicativoId}::uuid,${escopo.id}::uuid,${tipo},${origemId}::uuid,${chave}::uuid,${definicao.promptGeracao},${definicao.promptRevisao},${cfg.prompt},${cfg.revisao}) RETURNING ${camposResumo}`);
        await definicao.vincular(tx, { aplicativoId: escopo.aplicativoId, solicitadoPor: escopo.id, origemId, trabalhoId: id });
        return resumo(trabalho);
      });
    },
    async listar(escopo: EscopoIa, tipo: string, origens: string[]) {
      await registro.obter(tipo).autorizar(db, escopo, "ler");
      if (!origens.length) return [];
      if (origens.length > 50) throw new ErroTrabalhoIa("Consulte no máximo 50 origens.");
      // Somente o último trabalho e o último resultado concluído de cada origem.
      const rows = await db.consultar<ResumoDb>(Prisma.sql`SELECT ${camposResumo} FROM ia_trabalho WHERE id IN (
        SELECT DISTINCT ON (origem_id) id FROM ia_trabalho WHERE aplicativo_id=${escopo.aplicativoId}::uuid AND tipo=${tipo} AND origem_id IN (${Prisma.join(origens.map(id => Prisma.sql`${id}::uuid`))}) ORDER BY origem_id,criado_em DESC,id DESC
      ) OR id IN (
        SELECT DISTINCT ON (origem_id) id FROM ia_trabalho WHERE aplicativo_id=${escopo.aplicativoId}::uuid AND tipo=${tipo} AND origem_id IN (${Prisma.join(origens.map(id => Prisma.sql`${id}::uuid`))}) AND status='CONCLUIDO' ORDER BY origem_id,criado_em DESC,id DESC
      ) ORDER BY criado_em DESC,id DESC`);
      return rows.map(resumo);
    },
    async obter(escopo: EscopoIa, id: string) {
      const [t] = await db.consultar<ResumoDb>(Prisma.sql`SELECT ${camposResumo} FROM ia_trabalho WHERE id=${id}::uuid AND aplicativo_id=${escopo.aplicativoId}::uuid`);
      if (!t) throw new ErroTrabalhoIa("Trabalho não encontrado.", 404);
      await registro.obter(t.tipo).autorizar(db, escopo, "ler");
      return resumo(t);
    },
    async agir(escopo: EscopoIa, id: string, acao: "cancelar" | "retomar") {
      return db.transacao(async tx => {
        await travarApp(tx, escopo.aplicativoId);
        const [t] = await tx.consultar<Trabalho>(Prisma.sql`SELECT ${campos} FROM ia_trabalho WHERE id=${id}::uuid AND aplicativo_id=${escopo.aplicativoId}::uuid FOR UPDATE`);
        if (!t) throw new ErroTrabalhoIa("Trabalho não encontrado.", 404);
        const tipo = registro.obter(t.tipo);
        await tipo.autorizar(tx, escopo, "executar");
        if (acao === "retomar") {
          if (t.status !== "FALHOU") throw new ErroTrabalhoIa("Somente trabalhos com falha podem ser retomados.", 409);
          await tipo.verificarOrigem(tx, escopo.aplicativoId, t.origemId);
          const [outro] = await tx.consultar<{ id: string }>(Prisma.sql`SELECT id FROM ia_trabalho WHERE aplicativo_id=${t.aplicativoId}::uuid AND tipo=${t.tipo} AND origem_id=${t.origemId}::uuid AND status IN ('PENDENTE','PROCESSANDO','AGUARDANDO_RETRY') LIMIT 1`);
          if (outro) throw new ErroTrabalhoIa("Já existe uma nova geração em andamento.", 409);
          await autorizarTrabalho(tx,t);
          await verificarCapacidade(tx, escopo.aplicativoId);
          await mudar(tx, t, t.fase);
        } else {
          if (!ativo(t.status) && t.status !== "FALHOU") throw new ErroTrabalhoIa("Este trabalho já foi encerrado.", 409);
          await tx.executar(Prisma.sql`UPDATE ia_tentativa SET status='CANCELADO',finalizada_em=now() WHERE trabalho_id=${id}::uuid AND finalizada_em IS NULL`);
          await mudar(tx, t, t.fase, "CANCELADO");
        }
        return { ok: true };
      });
    },
    async operar(worker: WorkerIa, op: OperacaoIa): Promise<unknown> {
      return db.transacao(async tx => {
        // Serializa admissão por grupo entre VMs e por aplicativo, sempre nesta ordem.
        await tx.consultar(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${'ia-grupo:'+worker.grupo},0))::text`);
        await travarApp(tx, worker.aplicativoId);
        if (op.acao === "reservar") {
          const tipos = op.tipos.filter(tipo => worker.tipos.includes(tipo) && registro.tipos.includes(tipo));
          await tx.executar(Prisma.sql`INSERT INTO ia_worker(id,aplicativo_id,grupo,protocolo,tipos) VALUES (${worker.id},${worker.aplicativoId}::uuid,${worker.grupo},1,${tipos}::text[])
            ON CONFLICT(id) DO UPDATE SET aplicativo_id=excluded.aplicativo_id,grupo=excluded.grupo,protocolo=1,tipos=excluded.tipos,contato_em=now()`);
          if (!tipos.length) return { trabalho: null, aguardarMs: 60_000 };
          const [ocupado] = await tx.consultar<{ id: string }>(Prisma.sql`SELECT id FROM ia_trabalho WHERE status='PROCESSANDO' AND reserva_ate>now() AND (aplicativo_id=${worker.aplicativoId}::uuid OR grupo=${worker.grupo}) LIMIT 1`);
          if (ocupado) return { trabalho: null, aguardarMs: 10_000 };
          const [t] = await tx.consultar<Trabalho>(Prisma.sql`SELECT ${campos} FROM ia_trabalho WHERE aplicativo_id=${worker.aplicativoId}::uuid AND tipo IN (${Prisma.join(tipos)})
            AND ((status IN ('PENDENTE','AGUARDANDO_RETRY') AND disponivel_em<=now()) OR (status='PROCESSANDO' AND reserva_ate<=now()))
            ORDER BY disponivel_em,criado_em,id LIMIT 1 FOR UPDATE SKIP LOCKED`);
          if (!t) return { trabalho: null, aguardarMs: 60_000 };
          if (t.reserva) {
            await tx.executar(Prisma.sql`UPDATE ia_tentativa SET status='EXPIRADA',codigo='RESERVA_EXPIRADA',finalizada_em=now() WHERE id=${t.reserva}::uuid AND finalizada_em IS NULL`);
            if (t.tentativas >= 3) { await falhar(tx,t,"TEMPO_LIMITE"); return { trabalho: null, aguardarMs: 0 }; }
          }
          t.reserva = randomUUID(); t.tentativas++;
          await tx.executar(Prisma.sql`UPDATE ia_trabalho SET status='PROCESSANDO',reserva=${t.reserva}::uuid,reserva_ate=now()+interval '60 seconds',worker=${worker.id},grupo=${worker.grupo},tentativas=${t.tentativas},atualizado_em=now() WHERE id=${t.id}::uuid`);
          await tx.executar(Prisma.sql`INSERT INTO ia_tentativa(id,trabalho_id,worker,fase,lote) VALUES (${t.reserva}::uuid,${t.id}::uuid,${worker.id},${t.fase},${t.loteAtual})`);
          try { await autorizarTrabalho(tx,t); } catch (error) {
            if (!(error instanceof ErroTrabalhoIa) || error.status !== 403) throw error;
            await falhar(tx,t,"PERMISSAO"); return { trabalho:null,aguardarMs:0 };
          }
          const definicao = registro.obter(t.tipo);
          if (t.fase === "PREPARAR" || t.fase === "PUBLICAR") {
            await tx.executar(Prisma.sql`SAVEPOINT etapa_local_ia`);
            try {
              // Etapas locais são limitadas a uma página por chamada, sem chamadas ao Codex.
              if (t.fase === "PREPARAR") {
                const pagina = await definicao.preparar(tx,contexto(t),t.cursor);
                if (pagina.entrada.length > 50 || Buffer.byteLength(JSON.stringify(pagina.entrada)) > 65_536 || (!pagina.fim && (!pagina.entrada.length || pagina.cursor === t.cursor))) {
                  throw new ErroTrabalhoIa("Preparação ultrapassou o contrato de paginação.");
                }
                if (pagina.entrada.length) {
                  await tx.executar(Prisma.sql`INSERT INTO ia_lote(trabalho_id,aplicativo_id,numero,entrada) VALUES (${t.id}::uuid,${t.aplicativoId}::uuid,${t.totalLotes},${JSON.stringify(pagina.entrada)}::jsonb)`);
                  await tx.executar(Prisma.sql`UPDATE ia_trabalho SET total=total+${pagina.entrada.length},total_lotes=total_lotes+1,cursor=${pagina.cursor} WHERE id=${t.id}::uuid`);
                }
                await mudar(tx,t,pagina.fim ? (t.total+pagina.entrada.length ? "GERAR" : "PUBLICAR") : "PREPARAR");
              } else {
                await definicao.publicar(tx,contexto(t));
                await mudar(tx,t,"PUBLICAR","CONCLUIDO");
              }
              await tx.executar(Prisma.sql`UPDATE ia_tentativa SET status='CONCLUIDO',finalizada_em=now() WHERE id=${t.reserva}::uuid`);
            } catch (error) {
              await tx.executar(Prisma.sql`ROLLBACK TO SAVEPOINT etapa_local_ia`);
              await falhar(tx,t,error instanceof z.ZodError || error instanceof ErroTrabalhoIa ? "CONFIGURACAO" : "TEMPORARIA");
            }
            await tx.executar(Prisma.sql`RELEASE SAVEPOINT etapa_local_ia`);
            return { trabalho:null,aguardarMs:0 };
          }
          const [lote] = await tx.consultar<{ entrada: unknown; candidato: unknown }>(Prisma.sql`SELECT entrada,candidato FROM ia_lote WHERE trabalho_id=${t.id}::uuid AND numero=${t.loteAtual}`);
          return { trabalho: { reserva:t.reserva,tipo:t.tipo,fase:t.fase,
            prompt:comporPromptIa(t.fase === "GERAR" ? t.promptGeracao : t.promptRevisao,t.promptPersonalizado,lote.entrada,t.fase === "REVISAR" ? lote.candidato : undefined),
            schema:definicao.schemaSaida,timeoutMs:300_000 },aguardarMs:0 };
        }
        const [tentativa] = await tx.consultar<{ trabalhoId: string; finalizadaEm: Date | null; status: string }>(Prisma.sql`SELECT a.trabalho_id AS "trabalhoId",a.finalizada_em AS "finalizadaEm",a.status
          FROM ia_tentativa a JOIN ia_trabalho t ON t.id=a.trabalho_id WHERE a.id=${op.reserva}::uuid AND a.worker=${worker.id} AND t.aplicativo_id=${worker.aplicativoId}::uuid AND t.tipo=ANY(${worker.tipos}::text[])`);
        if (!tentativa) throw new ErroTrabalhoIa("Reserva inválida.",409);
        if (op.acao !== "renovar" && tentativa.finalizadaEm && ["CONCLUIDO","FALHOU"].includes(tentativa.status)) return { status:tentativa.status };
        const [t] = await tx.consultar<Trabalho>(Prisma.sql`SELECT ${campos} FROM ia_trabalho WHERE id=${tentativa.trabalhoId}::uuid AND status='PROCESSANDO' AND reserva=${op.reserva}::uuid AND reserva_ate>now() FOR UPDATE`);
        if (!t) throw new ErroTrabalhoIa("Reserva perdida ou trabalho cancelado.",409);
        try { await autorizarTrabalho(tx,t); } catch (error) {
          if (!(error instanceof ErroTrabalhoIa) || error.status !== 403) throw error;
          return falhar(tx,t,"PERMISSAO");
        }
        if (op.acao === "renovar") {
          await tx.executar(Prisma.sql`UPDATE ia_trabalho SET reserva_ate=now()+interval '60 seconds',atualizado_em=now() WHERE id=${t.id}::uuid`);
          await tx.executar(Prisma.sql`UPDATE ia_worker SET contato_em=now() WHERE id=${worker.id}`);
          return { ok:true };
        }
        if (op.acao === "falhar") return falhar(tx,t,op.codigo);
        const [lote] = await tx.consultar<{ entrada: unknown }>(Prisma.sql`SELECT entrada FROM ia_lote WHERE trabalho_id=${t.id}::uuid AND numero=${t.loteAtual}`);
        let resultado: unknown;
        try { resultado=registro.obter(t.tipo).validar(lote.entrada,op.resultado); }
        catch (error) {
          if (error instanceof z.ZodError || error instanceof ErroTrabalhoIa) return falhar(tx,t,"RESPOSTA_INVALIDA");
          throw error;
        }
        if (t.fase === "GERAR") {
          await tx.executar(Prisma.sql`UPDATE ia_lote SET candidato=${JSON.stringify(op.resultado)}::jsonb WHERE trabalho_id=${t.id}::uuid AND numero=${t.loteAtual}`);
          await mudar(tx,t,"REVISAR");
        } else if (t.fase === "REVISAR") {
          await tx.executar(Prisma.sql`UPDATE ia_lote SET revisado=${JSON.stringify(op.resultado)}::jsonb,resultado=${JSON.stringify(resultado)}::jsonb WHERE trabalho_id=${t.id}::uuid AND numero=${t.loteAtual}`);
          await tx.executar(Prisma.sql`UPDATE ia_trabalho SET lote_atual=lote_atual+1,processados=processados+jsonb_array_length(${JSON.stringify(lote.entrada)}::jsonb) WHERE id=${t.id}::uuid`);
          await mudar(tx,t,t.loteAtual+1 === t.totalLotes ? "PUBLICAR" : "GERAR");
        } else throw new ErroTrabalhoIa("Etapa incompatível.",409);
        await tx.executar(Prisma.sql`UPDATE ia_tentativa SET status='CONCLUIDO',finalizada_em=now() WHERE id=${op.reserva}::uuid`);
        return { ok:true };
      });
    },
  };
}
