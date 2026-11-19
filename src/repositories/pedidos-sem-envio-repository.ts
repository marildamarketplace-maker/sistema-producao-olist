import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { CHAVES_JOB } from "@/lib/aplicativo-jobs";
import { normalizarDestinatariosWhatsapp, prepararDadosNotification } from "@/lib/notification";
import {
  CHAVE_PEDIDOS_SEM_ENVIO, mensagensPedidosSemEnvio, selecionarPedidosSemEnvio,
  type PaginaSemEnvio, type ReservaSemEnvio,
} from "@/lib/pedidos-sem-envio";

// O alias a sempre aponta para o aplicativo dono do trabalho.
const permitido = Prisma.sql`
  EXISTS (SELECT 1 FROM configuracoes_jobs c WHERE c.chave = ${CHAVE_PEDIDOS_SEM_ENVIO} AND NOT c.pausado)
  AND ARRAY[${CHAVES_JOB.ALERTAR_PEDIDOS_SEM_ENVIO}, ${CHAVES_JOB.NOTIFICAR}]::text[] <@
    ARRAY(SELECT upper(btrim(chave)) FROM regexp_split_to_table(a.jobs, ',') chave)
  AND EXISTS (SELECT 1 FROM integracao_olist_tokens t WHERE t.aplicativo_id = a.id AND t.provider = 'olist' AND t.status = 'conectado')
`;

export function criarRepositorioPedidosSemEnvio(db: PrismaClient) {
  return {
    async estaPausado() {
      return (await db.configuracaoJob.findUnique({ where: { chave: CHAVE_PEDIDOS_SEM_ENVIO }, select: { pausado: true } }))?.pausado ?? true;
    },
    async agendar(referencia: string) {
      // Uma linha por aplicativo. Uma rodada aberta é retomada antes de iniciar outro dia.
      return db.$executeRaw`
        INSERT INTO pedido_sem_envio_jobs (aplicativo_id, referencia)
        SELECT a.id, ${referencia}::date FROM aplicativo a WHERE ${permitido}
        ON CONFLICT (aplicativo_id) DO UPDATE SET referencia = EXCLUDED.referencia,
          status = 'PENDENTE', situacao_indice = 0, pagina_offset = 0, tentativas = 0,
          pedidos_alertados = 0, notificacoes = 0, erro_codigo = NULL,
          reserva_id = NULL, reserva_ate = NULL, proxima_tentativa_em = now(), updated_at = now()
        WHERE pedido_sem_envio_jobs.referencia < EXCLUDED.referencia
          AND pedido_sem_envio_jobs.status IN ('CONCLUIDO', 'FALHOU')
      `;
    },
    async limparAntigos(referencia: string) {
      // Retenção limitada, sem trazer IDs ou histórico ao servidor.
      return db.$executeRaw`
        DELETE FROM pedido_sem_envio_alertas WHERE (aplicativo_id, pedido_olist_id) IN (
          SELECT al.aplicativo_id, al.pedido_olist_id FROM pedido_sem_envio_alertas al
          JOIN pedido_sem_envio_jobs j ON j.aplicativo_id = al.aplicativo_id
          WHERE al.referencia < ${referencia}::date - 30 AND al.referencia < j.referencia
          ORDER BY al.referencia LIMIT 500
        )
      `;
    },
    async reservar(): Promise<ReservaSemEnvio | null> {
      // Quedas na última tentativa também chegam a um estado terminal observável.
      await db.$executeRaw`
        UPDATE pedido_sem_envio_jobs SET status = 'FALHOU', erro_codigo = 'RESERVA_EXPIRADA',
          reserva_id = NULL, reserva_ate = NULL, updated_at = now()
        WHERE status = 'PROCESSANDO' AND reserva_ate <= now() AND tentativas >= 5
      `;
      const reservas = await db.$queryRaw<ReservaSemEnvio[]>`
        WITH candidato AS (
          SELECT j.aplicativo_id FROM pedido_sem_envio_jobs j JOIN aplicativo a ON a.id = j.aplicativo_id
          WHERE ${permitido} AND j.tentativas < 5 AND j.proxima_tentativa_em <= now()
            AND (j.status = 'PENDENTE' OR (j.status = 'PROCESSANDO' AND j.reserva_ate <= now()))
          ORDER BY j.proxima_tentativa_em, j.aplicativo_id FOR UPDATE OF j SKIP LOCKED LIMIT 1
        )
        UPDATE pedido_sem_envio_jobs j SET status = 'PROCESSANDO', reserva_id = ${randomUUID()}::uuid,
          reserva_ate = now() + interval '3 minutes', tentativas = j.tentativas + 1, updated_at = now()
        FROM candidato c WHERE c.aplicativo_id = j.aplicativo_id
        RETURNING j.aplicativo_id AS "aplicativoId", j.referencia, j.situacao_indice AS "situacaoIndice",
          j.pagina_offset AS "paginaOffset", j.reserva_id AS "reservaId", j.tentativas
      `;
      return reservas[0] ?? null;
    },
    async salvarPagina(r: ReservaSemEnvio, pagina: PaginaSemEnvio) {
      return db.$transaction(async tx => {
        const [app] = await tx.$queryRaw<{ nome: string; whatsapp: string }[]>`
          SELECT a.nome, a.whatsapp FROM pedido_sem_envio_jobs j JOIN aplicativo a ON a.id = j.aplicativo_id
          WHERE j.aplicativo_id = ${r.aplicativoId}::uuid AND j.reserva_id = ${r.reservaId}::uuid
            AND j.status = 'PROCESSANDO' AND j.reserva_ate > now() AND ${permitido}
          FOR UPDATE OF j
        `;
        if (!app) return null;
        const candidatos = selecionarPedidosSemEnvio(pagina.pedidos, r.referencia);
        const novos = candidatos.length ? await tx.$queryRaw<{ id: string }[]>`
          INSERT INTO pedido_sem_envio_alertas (aplicativo_id, pedido_olist_id, referencia)
          VALUES ${Prisma.join(candidatos.map(p => Prisma.sql`(${r.aplicativoId}::uuid, ${p.id}, ${r.referencia}::date)`))}
          ON CONFLICT (aplicativo_id, pedido_olist_id) DO UPDATE SET referencia = EXCLUDED.referencia
          WHERE pedido_sem_envio_alertas.referencia < EXCLUDED.referencia
          RETURNING pedido_olist_id AS id
        ` : [];
        const ids = new Set(novos.map(p => p.id));
        const mensagens = mensagensPedidosSemEnvio(candidatos.filter(p => ids.has(p.id)), r.referencia, app.nome);
        let notificacoes = 0;
        if (mensagens.length) {
          const destinatarios = normalizarDestinatariosWhatsapp(app.whatsapp);
          const dados = mensagens.flatMap(mensagem => destinatarios.map(to => prepararDadosNotification({
            to, mensagem, titulo: "Pedidos Olist com possível atraso no envio",
          })));
          notificacoes = (await tx.notification.createMany({ data: dados })).count;
        }
        // O total da API determina o fim, inclusive quando ela retorna páginas menores que o limite.
        const fim = pagina.pedidos.length === 0 || r.paginaOffset + pagina.pedidos.length >= pagina.total;
        const concluido = fim && r.situacaoIndice === 1;
        await tx.pedidoSemEnvioJob.update({ where: { aplicativoId: r.aplicativoId }, data: {
          status: concluido ? "CONCLUIDO" : "PENDENTE", reservaId: null, reservaAte: null,
          situacaoIndice: fim && !concluido ? 1 : r.situacaoIndice,
          paginaOffset: fim ? 0 : r.paginaOffset + pagina.pedidos.length,
          pedidosAlertados: { increment: novos.length }, notificacoes: { increment: notificacoes },
          tentativas: 0, erroCodigo: null, proximaTentativaEm: new Date(Date.now() + 1_100),
        } });
        return { pedidos: novos.length, notificacoes, concluido };
      }, { timeout: 15_000, maxWait: 5_000 });
    },
    async falhar(r: ReservaSemEnvio, codigo: string, atrasoMs: number | null) {
      const resultado = await db.pedidoSemEnvioJob.updateMany({
        where: { aplicativoId: r.aplicativoId, reservaId: r.reservaId, status: "PROCESSANDO", reservaAte: { gt: new Date() } },
        data: { status: atrasoMs === null ? "FALHOU" : "PENDENTE", erroCodigo: codigo.slice(0, 80),
          reservaId: null, reservaAte: null, proximaTentativaEm: new Date(Date.now() + (atrasoMs ?? 0)) },
      });
      return resultado.count === 1;
    },
  };
}
export type RepositorioPedidosSemEnvio = ReturnType<typeof criarRepositorioPedidosSemEnvio>;
