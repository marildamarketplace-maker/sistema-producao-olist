import { prisma } from "./prisma";
import { listarReferenciasPedidoManual } from "./pedido-manual-acesso";
import { ErroFilaOlist } from "./fila-olist-cadastros";

export type ReferenciaProducao = {
  id: string; nome: string; fornecedorId: string; vendedorId: number | null; bloqueio: string | null;
};
type Usuario = { id: string; aplicativoId: string; podeSelecionarFilialFornecedor: boolean };
const SEM_VENDEDOR = "O fornecedor precisa vincular seu usuário a um vendedor nesta conta.";

/** Uma leitura de vínculos atende todas as opções, sem consultar a Olist. */
export async function listarReferenciasProducao(usuario: Usuario): Promise<ReferenciaProducao[]> {
  const referencias = (await listarReferenciasPedidoManual(usuario.aplicativoId))
    .filter((r): r is typeof r & { fornecedorId: string } => Boolean(r.fornecedorId));
  if (!referencias.length) return [];
  const vinculos = await prisma.usuarioVendedorOlist.findMany({
    where: { usuarioId: usuario.id, aplicativoId: { in: referencias.map(r => r.id) },
      origemAplicativoId: usuario.aplicativoId, fornecedorMatrizId: { not: null },
      confirmadoEm: { not: null }, revogadoEm: null },
    select: { aplicativoId: true, vendedorOlistId: true, fornecedorMatrizId: true,
      aplicativo: { select: { id: true, aplicativoPaiId: true } } }, take: 1001,
  });
  if (vinculos.length > 1000) throw new ErroFilaOlist("Limite de vínculos excedido.", 409);
  // O predicado externo e os triggers do cadastro preservam a relação do usuário
  // com a matriz; as opções já foram limitadas às relações fornecedoras ativas.
  const porConta = new Map(vinculos.filter(v => v.fornecedorMatrizId === (v.aplicativo.aplicativoPaiId ?? v.aplicativo.id))
    .map(v => [v.aplicativoId, v.vendedorOlistId]));
  const opcoes = referencias.map(r => ({ ...r, vendedorId: porConta.get(r.id) ?? null,
    bloqueio: porConta.has(r.id) ? null : SEM_VENDEDOR }));
  if (usuario.podeSelecionarFilialFornecedor) return opcoes;
  // Sem escolha livre de filial, usar uma conta elegível por fornecedor. Se não
  // houver vínculo em nenhuma, manter uma opção bloqueada com a razão visível.
  const porFornecedor = new Map<string, ReferenciaProducao>();
  for (const opcao of opcoes) {
    const atual = porFornecedor.get(opcao.fornecedorId);
    if (!atual || (atual.bloqueio && !opcao.bloqueio)) porFornecedor.set(opcao.fornecedorId, opcao);
  }
  return [...porFornecedor.values()];
}
