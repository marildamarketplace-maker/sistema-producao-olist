import { FalhaPedidosSemEnvio, SITUACOES_SEM_ENVIO, type PaginaSemEnvio, type ReservaSemEnvio } from "@/lib/pedidos-sem-envio";
import type { RepositorioPedidosSemEnvio } from "@/repositories/pedidos-sem-envio-repository";

type Cliente = { listar(app: string, situacao: number, offset: number, dataFinal: string): Promise<PaginaSemEnvio> };
type Repositorio = Pick<RepositorioPedidosSemEnvio, "reservar" | "salvarPagina" | "falhar">;

export async function processarPaginaSemEnvio(repo: Repositorio, cliente: Cliente, reserva: ReservaSemEnvio) {
  try {
    const dataFinal = new Date(reserva.referencia.getTime() - 6 * 86_400_000).toISOString().slice(0, 10);
    const pagina = await cliente.listar(reserva.aplicativoId, SITUACOES_SEM_ENVIO[reserva.situacaoIndice], reserva.paginaOffset, dataFinal);
    return await repo.salvarPagina(reserva, pagina);
  } catch (erro) {
    const falha = erro instanceof FalhaPedidosSemEnvio ? erro : new FalhaPedidosSemEnvio("PROCESSAMENTO", true);
    const atraso = falha.temporaria && reserva.tentativas < 5
      ? Math.max(falha.retryAfterMs, 60_000 * 2 ** (reserva.tentativas - 1)) : null;
    await repo.falhar(reserva, falha.codigo, atraso);
    return { falha: true } as const;
  }
}

export async function executarPedidosSemEnvio(repo: Repositorio, cliente: Cliente, opcoes: {
  prazo: number; agora?: () => number; esperar?: () => Promise<void>;
}) {
  const agora = opcoes.agora ?? Date.now;
  const esperar = opcoes.esperar ?? (() => new Promise<void>(resolve => setTimeout(resolve, 1_100)));
  const resultado = { paginas: 0, pedidos: 0, notificacoesEnfileiradas: 0, concluidos: 0, falhas: 0 };
  // Reserva margem para OAuth, HTTP e checkpoint. Uma rodada nunca faz varredura ilimitada.
  while (resultado.paginas < 100 && agora() + 70_000 < opcoes.prazo) {
    const reserva = await repo.reservar();
    if (!reserva) break;
    const salvo = await processarPaginaSemEnvio(repo, cliente, reserva);
    resultado.paginas++;
    if (salvo && "falha" in salvo) resultado.falhas++;
    else if (salvo) {
      resultado.pedidos += salvo.pedidos;
      resultado.notificacoesEnfileiradas += salvo.notificacoes;
      resultado.concluidos += Number(salvo.concluido);
    }
    await esperar();
  }
  return resultado;
}
