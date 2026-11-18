import { atrasoRetrySku, FalhaConsultaSku, type ItemSku, type PedidoEncontradoSku } from "@/lib/anotar-sku/contrato";
import type { RepositorioAnotarSku, ReservaSku } from "@/repositories/anotar-sku-repository";

export type ClienteAnotarSku = {
  listar(aplicativoId: string, situacao: string, offset: number): Promise<PedidoEncontradoSku[]>;
  detalhar(aplicativoId: string, pedidoId: string): Promise<ItemSku[]>;
};
export async function processarEtapaSku(r: ReservaSku, repo: RepositorioAnotarSku, cliente: ClienteAnotarSku) {
  try {
    if (!await repo.autorizado(r)) throw new FalhaConsultaSku("PERMISSAO", "O solicitante não tem mais acesso a esta operação. Cancele a busca e solicite uma nova com um usuário autorizado.", false);
    let salvo: boolean | null;
    if (r.etapa === "LISTAGEM") {
      salvo = await repo.pagina(r, await cliente.listar(r.aplicativoId, r.situacoes[r.situacaoIndice], r.paginaOffset));
    } else if (r.etapa === "DETALHAMENTO") {
      const pedido = await repo.proximoPedido(r);
      salvo = pedido ? await repo.pedido(r, pedido.id, pedido.ignorado ? [] : await cliente.detalhar(r.aplicativoId, pedido.id), pedido.ignorado)
        : await repo.prepararConclusao(r);
    } else if (r.etapa === "CONSOLIDACAO") {
      salvo = await repo.concluir(r);
    } else throw new FalhaConsultaSku("ETAPA", "A busca está em uma etapa desconhecida. Contate o suporte.", false);
    return salvo ? "progresso" as const : "reserva_perdida" as const;
  } catch (erro) {
    const falha = erro instanceof FalhaConsultaSku ? erro : new FalhaConsultaSku("INTERNO", "Não foi possível concluir esta etapa. O progresso anterior foi preservado.", true);
    const repetir = falha.temporaria && r.tentativas < 5;
    const salvo = await repo.falhar(r, falha.message, falha.codigo, repetir ? atrasoRetrySku(r.tentativas, falha.retryAfterMs) : null);
    return !salvo ? "reserva_perdida" as const : repetir ? "retry" as const : "falha" as const;
  }
}

export async function executarFilaSku(repo: RepositorioAnotarSku, cliente: ClienteAnotarSku, opcoes: {
  prazo: number; agora?: () => number; esperar?: (ms: number) => Promise<void>;
}) {
  const agora = opcoes.agora ?? Date.now;
  const esperar = opcoes.esperar ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const totais = { progresso: 0, retry: 0, falha: 0, reserva_perdida: 0 };
  // Reserva margem para OAuth (incluindo lock), duas chamadas de 20s e gravação.
  while (agora() + 120_000 < opcoes.prazo) {
    const reserva = await repo.reservar();
    if (!reserva) break;
    totais[await processarEtapaSku(reserva, repo, cliente)]++;
    await esperar(1150);
  }
  return totais;
}
