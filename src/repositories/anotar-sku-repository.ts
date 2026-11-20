import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient, type BuscaSkuJob } from "@prisma/client";
import { criarBuscaSkuSchema, ErroAnotarSku, FalhaConsultaSku, ESTADOS_ABERTOS_SKU, type EntradaBuscaSku, type ItemSku, type PedidoEncontradoSku } from "@/lib/anotar-sku/contrato";
import { dataIsoSku, periodoPadraoSku } from "@/lib/anotar-sku/periodo";
import { aplicativoTemJob, CHAVES_JOB, CHAVE_CONFIG_JOB_ANOTAR_SKU } from "@/lib/aplicativo-jobs";
import { LIMITE_PEDIDOS_SKU, type PaginaPedidosSku, type PaginaForaPeriodoSku } from "@/lib/anotar-sku/pedidos";

type Tx = Prisma.TransactionClient;
export type EscopoSku = { id: string; aplicativoId: string; podeVisualizar: boolean };
export type ReservaSku = BuscaSkuJob & { reservaId: string };
export const RESERVA_SKU_MS = 180_000;

export async function travarAplicativoSku(tx: Tx, aplicativoId: string) {
  await tx.$queryRaw`SELECT id FROM aplicativo WHERE id = ${aplicativoId}::uuid FOR UPDATE`;
}
const aberto = { status: { in: ESTADOS_ABERTOS_SKU } };
const liberar = { reservaId: null, reservaAte: null };

// O mesmo critério vale para a primeira reserva e para a recuperação após queda.
// Comparação por chave inteira, ignorando espaços e caixa, como aplicativoTemJob.
const processamentoPermitido = Prisma.sql`
  EXISTS (SELECT 1 FROM configuracoes_jobs c WHERE c.chave = ${CHAVE_CONFIG_JOB_ANOTAR_SKU} AND NOT c.pausado)
  AND EXISTS (
    SELECT 1 FROM aplicativo a, regexp_split_to_table(coalesce(a.jobs, ''), ',') AS permissao(chave)
    WHERE a.id = j.aplicativo_id AND upper(btrim(permissao.chave)) = ${CHAVES_JOB.ANOTAR_SKU}
  )
`;

async function disponibilidade(db: Pick<Tx, "configuracaoJob" | "aplicativo">, aplicativoId: string) {
  const [configuracao, aplicativo] = await Promise.all([
    db.configuracaoJob.findUnique({ where: { chave: CHAVE_CONFIG_JOB_ANOTAR_SKU }, select: { pausado: true } }),
    db.aplicativo.findUnique({ where: { id: aplicativoId }, select: { jobs: true } }),
  ]);
  const permitido = aplicativoTemJob(aplicativo?.jobs, CHAVES_JOB.ANOTAR_SKU);
  const motivoPausa = !permitido
    ? "O processamento automático de SKUs não está habilitado para este aplicativo. Solicite a liberação ao administrador."
    : !configuracao || configuracao.pausado
      ? "Novas buscas e retomadas estão temporariamente pausadas na configuração do processamento. O histórico continua disponível."
      : null;
  return { habilitado: !motivoPausa, motivoPausa, permitido };
}

async function exigirProcessamentoPermitido(tx: Tx, aplicativoId: string) {
  const estado = await disponibilidade(tx, aplicativoId);
  if (!estado.habilitado) throw new ErroAnotarSku(estado.motivoPausa!, estado.permitido ? 503 : 403);
}

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
    async pedidosForaPeriodo(escopo: EscopoSku, buscaId: string, cursor?: string): Promise<PaginaForaPeriodoSku> {
      if (!escopo.podeVisualizar) throw new ErroAnotarSku("Você não tem permissão para esta operação.", 403);
      const busca = await db.buscaSku.findFirst({ where: { id: buscaId, aplicativoId: escopo.aplicativoId }, select: { job: { select: { id: true } } } });
      if (!busca) throw new ErroAnotarSku("Busca não encontrada.", 404);
      if (!busca.job) return { pedidos: [], proximoCursor: null };
      const itens = await db.buscaSkuJobPedido.findMany({
        where: { jobId: busca.job.id, aplicativoId: escopo.aplicativoId, foraPeriodo: true, ...(cursor ? { pedidoOlistId: { gt: cursor } } : {}) },
        select: { pedidoOlistId: true, dataCriacao: true }, orderBy: { pedidoOlistId: "asc" }, take: LIMITE_PEDIDOS_SKU + 1,
      });
      const pedidos = itens.slice(0, LIMITE_PEDIDOS_SKU).map(item => ({ id: item.pedidoOlistId, dataCriacao: dataIsoSku(item.dataCriacao) }));
      return { pedidos, proximoCursor: itens.length > LIMITE_PEDIDOS_SKU ? pedidos.at(-1)!.id : null };
    },
    async pedidosPorSku(escopo: EscopoSku, buscaId: string, sku: string, cursor?: string): Promise<PaginaPedidosSku> {
      if (!escopo.podeVisualizar) throw new ErroAnotarSku("Você não tem permissão para esta operação.", 403);
      const busca = await db.buscaSku.findFirst({
        where: { id: buscaId, aplicativoId: escopo.aplicativoId }, select: { id: true },
      });
      if (!busca) throw new ErroAnotarSku("Busca não encontrada.", 404);
      // Um SKU tem no máximo um item por pedido/aplicativo. O histórico é imutável,
      // e o cursor por ID permite continuar sem baixar todos os vínculos da busca.
      const itens = await db.itemBuscaSku.findMany({
        where: { buscaId, aplicativoId: escopo.aplicativoId, sku, ...(cursor ? { pedidoOlistId: { gt: cursor } } : {}) },
        select: { pedidoOlistId: true, quantidade: true },
        orderBy: { pedidoOlistId: "asc" }, take: LIMITE_PEDIDOS_SKU + 1,
      });
      const pedidos = itens.slice(0, LIMITE_PEDIDOS_SKU).map(item => ({ id: item.pedidoOlistId, quantidade: item.quantidade }));
      return { pedidos, proximoCursor: itens.length > LIMITE_PEDIDOS_SKU ? pedidos.at(-1)!.id : null };
    },
    async estaPausado() {
      const configuracao = await db.configuracaoJob.findUnique({ where: { chave: CHAVE_CONFIG_JOB_ANOTAR_SKU }, select: { pausado: true } });
      return configuracao?.pausado ?? true;
    },
    async disponibilidade(aplicativoId: string) {
      const { habilitado, motivoPausa } = await disponibilidade(db, aplicativoId);
      return { habilitado, motivoPausa };
    },
    async criar(escopo: EscopoSku, entrada: EntradaBuscaSku) {
      const validada = criarBuscaSkuSchema.safeParse(entrada);
      if (!validada.success) throw new ErroAnotarSku(validada.error.issues[0]?.message ?? "Filtros inválidos.", 400);
      entrada = validada.data;
      return db.$transaction(async tx => {
        await travarAplicativoSku(tx, escopo.aplicativoId);
        const anterior = await tx.buscaSkuJob.findUnique({ where: { aplicativoId_solicitadoPor_chave: {
          aplicativoId: escopo.aplicativoId, solicitadoPor: escopo.id, chave: entrada.chave,
        } } });
        if (anterior) {
          if (JSON.stringify(anterior.situacoes) !== JSON.stringify(entrada.situacoes)) throw new ErroAnotarSku("Esta solicitação já foi utilizada com outras situações. Atualize a página.");
          if (entrada.periodoInicio !== undefined && (entrada.periodoInicio !== dataIsoSku(anterior.periodoInicio) || entrada.periodoFim !== dataIsoSku(anterior.periodoFim))) {
            throw new ErroAnotarSku("Esta solicitação já foi utilizada com outro período. Atualize a página.");
          }
          return anterior;
        }
        await exigirProcessamentoPermitido(tx, escopo.aplicativoId);
        if (await tx.buscaSkuJob.findFirst({ where: { aplicativoId: escopo.aplicativoId, ...aberto } })) {
          throw new ErroAnotarSku("Já existe uma busca em aberto neste aplicativo. Aguarde, retome ou cancele essa busca.");
        }
        const periodo = entrada.periodoInicio && entrada.periodoFim ? entrada : periodoPadraoSku();
        return tx.buscaSkuJob.create({ data: { aplicativoId: escopo.aplicativoId, solicitadoPor: escopo.id,
          chave: entrada.chave, situacoes: entrada.situacoes,
          periodoInicio: new Date(`${periodo.periodoInicio}T00:00:00Z`), periodoFim: new Date(`${periodo.periodoFim}T00:00:00Z`),
        } });
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
        if (acao === "retomar") await exigirProcessamentoPermitido(tx, escopo.aplicativoId);
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
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'ia:'+escopo.aplicativoId},0))::text`;
        await travarAplicativoSku(tx, escopo.aplicativoId);
        if (await tx.buscaSkuJob.findFirst({ where: { aplicativoId: escopo.aplicativoId, ...aberto } })) {
          throw new ErroAnotarSku("Conclua ou cancele a busca em aberto antes de excluir um resultado.");
        }
        const relatorios = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM ia_trabalho WHERE aplicativo_id=${escopo.aplicativoId}::uuid AND origem_id=${id}::uuid AND tipo='anotar_sku.relatorio.v1' AND status IN ('PENDENTE','PROCESSANDO','AGUARDANDO_RETRY') LIMIT 1`;
        if (relatorios.length) throw new ErroAnotarSku("Conclua ou cancele o relatório IA antes de excluir esta busca.");
        const resultado = await tx.buscaSku.deleteMany({ where: { id, aplicativoId: escopo.aplicativoId } });
        if (!resultado.count) throw new ErroAnotarSku("Busca não encontrada.", 404);
      });
    },
    async reservar(): Promise<ReservaSku | null> {
      const reservaId = randomUUID();
      // Esgotamento após crash conta como falha de operação, não como uma rodada normal do cron.
      await db.$executeRaw`UPDATE busca_sku_jobs j SET status = 'FALHOU', reserva_id = NULL, reserva_ate = NULL,
        erro = 'O processamento foi interrompido repetidamente. Retome a busca para tentar novamente.',
        erro_codigo = 'RESERVA_EXPIRADA', updated_at = now()
        WHERE status = 'PROCESSANDO' AND reserva_ate <= now() AND tentativas >= 5 AND ${processamentoPermitido}`;
      const rows = await db.$queryRaw<{ id: string }[]>`
        WITH candidato AS (
          SELECT j.id FROM busca_sku_jobs j
          WHERE ((status IN ('PENDENTE', 'AGUARDANDO_RETRY') AND proxima_tentativa_em <= now())
            OR (status = 'PROCESSANDO' AND reserva_ate <= now())) AND tentativas < 5 AND ${processamentoPermitido}
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
    async pagina(r: ReservaSku, pedidos: PedidoEncontradoSku[]) {
      return comReserva(r, async (tx, j) => {
        const inicio = dataIsoSku(j.periodoInicio), fimPeriodo = dataIsoSku(j.periodoFim);
        const dados = pedidos.map(pedido => {
          if (inicio && !pedido.dataCriacao) throw new FalhaConsultaSku("DATA_CRIACAO", "A Olist retornou um pedido sem data de criação válida. O período não pode ser conferido com segurança.", false);
          const foraPeriodo = Boolean(inicio && fimPeriodo && pedido.dataCriacao && (pedido.dataCriacao < inicio || pedido.dataCriacao > fimPeriodo));
          return { jobId: j.id, aplicativoId: j.aplicativoId, pedidoOlistId: pedido.id,
            dataCriacao: pedido.dataCriacao ? new Date(`${pedido.dataCriacao}T00:00:00Z`) : null, foraPeriodo, processado: foraPeriodo };
        });
        if (dados.length) await tx.buscaSkuJobPedido.createMany({ skipDuplicates: true, data: dados });
        // O fim da página depende da resposta completa, nunca da quantidade dentro do período.
        const fim = pedidos.length < 100;
        const indice = fim ? j.situacaoIndice + 1 : j.situacaoIndice;
        const fimPassagem = indice >= j.situacoes.length;
        const [contagens] = await tx.$queryRaw<{ encontrados: number; foraPeriodo: number }[]>`
          SELECT count(*)::int AS encontrados, count(*) FILTER (WHERE fora_periodo)::int AS "foraPeriodo"
          FROM busca_sku_job_pedidos WHERE job_id = ${j.id}::uuid
        `;
        await avancar(tx, j.id, {
          encontrados: contagens.encontrados, foraPeriodo: contagens.foraPeriodo, processados: contagens.foraPeriodo,
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
          FROM busca_sku_job_pedidos p WHERE p.job_id = ${j.id}::uuid AND NOT p.ignorado AND NOT p.fora_periodo AND jsonb_array_length(p.itens) > 0
          AND NOT EXISTS (SELECT 1 FROM itens_busca_sku i WHERE i.aplicativo_id = ${j.aplicativoId}::uuid AND i.pedido_olist_id = p.pedido_olist_id)
        `;
        let buscaId: string | null = null;
        if (totais.itens > 0 || j.foraPeriodo > 0) {
          const busca = await tx.buscaSku.create({ data: { aplicativoId: j.aplicativoId, situacoes: j.situacoes, quantidadePedidos: totais.pedidos,
            periodoInicio: j.periodoInicio, periodoFim: j.periodoFim, pedidosForaPeriodo: j.foraPeriodo,
          } });
          buscaId = busca.id;
          await tx.$executeRaw`
            INSERT INTO itens_busca_sku (id, busca_id, aplicativo_id, pedido_olist_id, sku, quantidade, titulo_produto)
            SELECT gen_random_uuid(), ${busca.id}::uuid, ${j.aplicativoId}::uuid, p.pedido_olist_id,
              item->>'sku', (item->>'quantidade')::int,
              coalesce(nullif(btrim(po.titulo_final), ''), nullif(btrim(tp.titulo), ''), nullif(btrim(item->>'tituloProduto'), ''))
            FROM busca_sku_job_pedidos p CROSS JOIN LATERAL jsonb_array_elements(p.itens) item
            LEFT JOIN produto_olist po ON po.sku_final = item->>'sku'
            LEFT JOIN tipo_produto tp ON tp.sku = item->>'sku'
            WHERE p.job_id = ${j.id}::uuid AND NOT p.ignorado AND NOT p.fora_periodo
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
