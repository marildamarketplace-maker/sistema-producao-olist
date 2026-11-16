import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient, type BuscaSkuJob } from "@prisma/client";
import { ErroAnotarSku, ESTADOS_ABERTOS_SKU, type ItemSku } from "@/lib/anotar-sku/contrato";

type Tx = Prisma.TransactionClient;
export type EscopoSku = { id: string; aplicativoId: string; podeVisualizar: boolean };
export type ReservaSku = BuscaSkuJob & { reservaId: string };
export const RESERVA_SKU_MS = 180_000;

export async function travarAplicativoSku(tx: Tx, aplicativoId: string) {
  await tx.$queryRaw`SELECT id FROM aplicativo WHERE id = ${aplicativoId}::uuid FOR UPDATE`;
}
const aberto = { status: { in: ESTADOS_ABERTOS_SKU } };
const liberar = { reservaId: null, reservaAte: null };

export function criarRepositorioAnotarSku(db: PrismaClient) {
  async function comReserva<T>(r: ReservaSku, executar: (tx: Tx, atual: BuscaSkuJob) => Promise<T>, travarApp = false) {
    return db.$transaction(async tx => {
      if (travarApp) await travarAplicativoSku(tx, r.aplicativoId);
      const valido = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM busca_sku_jobs WHERE id = ${r.id}::uuid AND aplicativo_id = ${r.aplicativoId}::uuid
        AND reserva_id = ${r.reservaId}::uuid AND status = 'PROCESSANDO' AND reserva_ate > now() FOR UPDATE
      `;
      if (!valido.length) return null;
      return executar(tx, await tx.buscaSkuJob.findUniqueOrThrow({ where: { id: r.id } }));
    }, { timeout: 25_000, maxWait: 5_000 });
  }
  async function avancar(tx: Tx, id: string, data: Prisma.BuscaSkuJobUpdateInput = {}) {
    await tx.buscaSkuJob.update({ where: { id }, data: {
      ...liberar, status: "PENDENTE", tentativas: 0, erro: null, erroCodigo: null,
      proximaTentativaEm: new Date(Date.now() + 1100), updatedAt: new Date(), ...data,
    } });
  }
  return {
    async criar(escopo: EscopoSku, entrada: { chave: string; situacoes: string[] }) {
      return db.$transaction(async tx => {
        await travarAplicativoSku(tx, escopo.aplicativoId);
        const anterior = await tx.buscaSkuJob.findUnique({ where: { aplicativoId_solicitadoPor_chave: {
          aplicativoId: escopo.aplicativoId, solicitadoPor: escopo.id, chave: entrada.chave,
        } } });
        if (anterior) {
          if (JSON.stringify(anterior.situacoes) !== JSON.stringify(entrada.situacoes)) throw new ErroAnotarSku("Esta solicitação já foi utilizada com outras situações. Atualize a página.");
          return anterior;
        }
        if (await tx.buscaSkuJob.findFirst({ where: { aplicativoId: escopo.aplicativoId, ...aberto } })) {
          throw new ErroAnotarSku("Já existe uma busca em aberto neste aplicativo. Aguarde, retome ou cancele essa busca.");
        }
        return tx.buscaSkuJob.create({ data: { aplicativoId: escopo.aplicativoId, solicitadoPor: escopo.id, ...entrada } });
      });
    },
    async listar(escopo: EscopoSku) {
      const where = { aplicativoId: escopo.aplicativoId, ...(escopo.podeVisualizar ? {} : { solicitadoPor: escopo.id }) };
      const [jobs, emAberto] = await Promise.all([
        db.buscaSkuJob.findMany({ where, orderBy: { createdAt: "desc" }, take: 20 }),
        db.buscaSkuJob.count({ where: { aplicativoId: escopo.aplicativoId, ...aberto } }),
      ]);
      return { jobs, emAberto: emAberto > 0 };
    },
    async agir(escopo: EscopoSku, id: string, acao: "retomar" | "cancelar") {
      return db.$transaction(async tx => {
        await travarAplicativoSku(tx, escopo.aplicativoId);
        const job = await tx.buscaSkuJob.findFirst({ where: { id, aplicativoId: escopo.aplicativoId,
          ...(escopo.podeVisualizar ? {} : { solicitadoPor: escopo.id }) } });
        if (!job) throw new ErroAnotarSku("Busca não encontrada.", 404);
        if (acao === "cancelar" && job.status === "CANCELADO") return job;
        if (acao === "retomar" && job.status !== "FALHOU") throw new ErroAnotarSku("Somente buscas com falha podem ser retomadas.");
        if (!ESTADOS_ABERTOS_SKU.includes(job.status)) throw new ErroAnotarSku("Esta busca já foi encerrada.");
        // O UPDATE condicional também protege contra conclusão concorrente pelo worker.
        const atualizado = await tx.buscaSkuJob.updateMany({ where: { id, status: job.status }, data: {
          ...liberar, status: acao === "retomar" ? "PENDENTE" : "CANCELADO", updatedAt: new Date(),
          ...(acao === "retomar" ? { tentativas: 0, retomadas: { increment: 1 }, erro: null, erroCodigo: null, proximaTentativaEm: new Date() }
            : { finalizadoEm: new Date() }),
        } });
        if (!atualizado.count) throw new ErroAnotarSku("A busca mudou durante a operação. Atualize e tente novamente.");
        return tx.buscaSkuJob.findUniqueOrThrow({ where: { id } });
      });
    },
    async excluir(escopo: EscopoSku, id: string) {
      return db.$transaction(async tx => {
        await travarAplicativoSku(tx, escopo.aplicativoId);
        if (await tx.buscaSkuJob.findFirst({ where: { aplicativoId: escopo.aplicativoId, ...aberto } })) {
          throw new ErroAnotarSku("Conclua ou cancele a busca em aberto antes de excluir um resultado.");
        }
        const resultado = await tx.buscaSku.deleteMany({ where: { id, aplicativoId: escopo.aplicativoId } });
        if (!resultado.count) throw new ErroAnotarSku("Busca não encontrada.", 404);
      });
    },
    async reservar(): Promise<ReservaSku | null> {
      const reservaId = randomUUID();
      // Esgotamento após crash conta como falha de operação, não como uma rodada normal do cron.
      await db.$executeRaw`UPDATE busca_sku_jobs SET status = 'FALHOU', reserva_id = NULL, reserva_ate = NULL,
        erro = 'O processamento foi interrompido repetidamente. Retome a busca para tentar novamente.',
        erro_codigo = 'RESERVA_EXPIRADA', updated_at = now()
        WHERE status = 'PROCESSANDO' AND reserva_ate <= now() AND tentativas >= 5`;
      const rows = await db.$queryRaw<{ id: string }[]>`
        WITH candidato AS (
          SELECT id FROM busca_sku_jobs
          WHERE ((status IN ('PENDENTE', 'AGUARDANDO_RETRY') AND proxima_tentativa_em <= now())
            OR (status = 'PROCESSANDO' AND reserva_ate <= now())) AND tentativas < 5
          ORDER BY proxima_tentativa_em, created_at, id LIMIT 1 FOR UPDATE SKIP LOCKED
        ) UPDATE busca_sku_jobs j SET status = 'PROCESSANDO', reserva_id = ${reservaId}::uuid,
          reserva_ate = now() + interval '180 seconds', tentativas = tentativas + 1, updated_at = now()
          FROM candidato c WHERE j.id = c.id RETURNING j.id
      `;
      if (!rows[0]) return null;
      const job = await db.buscaSkuJob.findUniqueOrThrow({ where: { id: rows[0].id } });
      return job.status === "PROCESSANDO" && job.reservaId === reservaId ? { ...job, reservaId } : null;
    },
    async autorizado(r: ReservaSku) {
      return Boolean(await db.usuario.findFirst({ where: { id: r.solicitadoPor, aplicativoId: r.aplicativoId,
        ativo: true, podeEscreverAnotarSku: true }, select: { id: true } }));
    },
    async pagina(r: ReservaSku, ids: string[]) {
      return comReserva(r, async (tx, j) => {
        if (ids.length) await tx.buscaSkuJobPedido.createMany({ skipDuplicates: true,
          data: [...new Set(ids)].map(pedidoOlistId => ({ jobId: j.id, aplicativoId: j.aplicativoId, pedidoOlistId })) });
        const fim = ids.length < 100;
        const indice = fim ? j.situacaoIndice + 1 : j.situacaoIndice;
        const fimPassagem = indice >= j.situacoes.length;
        await avancar(tx, j.id, {
          encontrados: await tx.buscaSkuJobPedido.count({ where: { jobId: j.id } }),
          paginaOffset: fim ? 0 : j.paginaOffset + 100,
          situacaoIndice: fimPassagem ? 0 : indice,
          passagem: fimPassagem ? 1 : j.passagem,
          etapa: fimPassagem && j.passagem === 1 ? "DETALHAMENTO" : "LISTAGEM",
        });
        return true;
      });
    },
    async proximoPedido(r: ReservaSku) {
      const pedido = await db.buscaSkuJobPedido.findFirst({ where: { jobId: r.id, aplicativoId: r.aplicativoId, processado: false }, orderBy: { pedidoOlistId: "asc" } });
      if (!pedido) return null;
      const salvo = await db.itemBuscaSku.findFirst({ where: { aplicativoId: r.aplicativoId, pedidoOlistId: pedido.pedidoOlistId }, select: { id: true } });
      return { id: pedido.pedidoOlistId, ignorado: Boolean(salvo) };
    },
    async pedido(r: ReservaSku, pedidoId: string, itens: ItemSku[], ignorado: boolean) {
      return comReserva(r, async (tx, j) => {
        const atualizado = await tx.buscaSkuJobPedido.updateMany({ where: { jobId: j.id, aplicativoId: j.aplicativoId, pedidoOlistId: pedidoId, processado: false },
          data: { itens, processado: true, ignorado } });
        if (!atualizado.count) throw new Error("Checkpoint de pedido inválido.");
        await avancar(tx, j.id, { processados: { increment: 1 }, ignorados: { increment: ignorado ? 1 : 0 } });
        return true;
      });
    },
    async prepararConclusao(r: ReservaSku) {
      return comReserva(r, async (tx, j) => { await avancar(tx, j.id, { etapa: "CONSOLIDACAO" }); return true; });
    },
    async concluir(r: ReservaSku) {
      return comReserva(r, async (tx, j) => {
        if (await tx.buscaSkuJobPedido.count({ where: { jobId: j.id, processado: false } })) throw new Error("Pedidos pendentes.");
        const [totais] = await tx.$queryRaw<{ pedidos: number; itens: number }[]>`
          SELECT count(*)::int AS pedidos, coalesce(sum(jsonb_array_length(p.itens)), 0)::int AS itens
          FROM busca_sku_job_pedidos p WHERE p.job_id = ${j.id}::uuid AND NOT p.ignorado
          AND NOT EXISTS (SELECT 1 FROM itens_busca_sku i WHERE i.aplicativo_id = ${j.aplicativoId}::uuid AND i.pedido_olist_id = p.pedido_olist_id)
        `;
        let buscaId: string | null = null;
        if (totais.itens > 0) {
          const busca = await tx.buscaSku.create({ data: { aplicativoId: j.aplicativoId, situacoes: j.situacoes, quantidadePedidos: totais.pedidos } });
          buscaId = busca.id;
          await tx.$executeRaw`
            INSERT INTO itens_busca_sku (id, busca_id, aplicativo_id, pedido_olist_id, sku, quantidade, titulo_produto)
            SELECT gen_random_uuid(), ${busca.id}::uuid, ${j.aplicativoId}::uuid, p.pedido_olist_id,
              item->>'sku', (item->>'quantidade')::int, coalesce(po.titulo_final, tp.titulo)
            FROM busca_sku_job_pedidos p CROSS JOIN LATERAL jsonb_array_elements(p.itens) item
            LEFT JOIN produto_olist po ON po.sku_final = item->>'sku'
            LEFT JOIN tipo_produto tp ON tp.sku = item->>'sku'
            WHERE p.job_id = ${j.id}::uuid AND NOT p.ignorado
              AND NOT EXISTS (SELECT 1 FROM itens_busca_sku i WHERE i.aplicativo_id = ${j.aplicativoId}::uuid AND i.pedido_olist_id = p.pedido_olist_id)
          `;
          const [contagem] = await tx.$queryRaw<{ total: number }[]>`SELECT count(DISTINCT sku)::int AS total FROM itens_busca_sku WHERE busca_id = ${busca.id}::uuid`;
          await tx.buscaSku.update({ where: { id: busca.id }, data: { quantidadeSkus: contagem.total } });
        }
        await tx.buscaSkuJob.update({ where: { id: j.id }, data: { ...liberar, status: "CONCLUIDO", buscaId,
          teveResultado: Boolean(buscaId), erro: null, erroCodigo: null, tentativas: 0, updatedAt: new Date(), finalizadoEm: new Date() } });
        return true;
      }, true);
    },
    async falhar(r: ReservaSku, erro: string, codigo: string, atrasoMs: number | null) {
      return comReserva(r, async (tx, j) => {
        await tx.buscaSkuJob.update({ where: { id: j.id }, data: { ...liberar, erro, erroCodigo: codigo,
          status: atrasoMs === null ? "FALHOU" : "AGUARDANDO_RETRY", updatedAt: new Date(),
          proximaTentativaEm: new Date(Date.now() + (atrasoMs ?? 0)) } });
        return true;
      });
    },
  };
}
export type RepositorioAnotarSku = ReturnType<typeof criarRepositorioAnotarSku>;
