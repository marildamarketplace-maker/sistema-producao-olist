export function CriarPedidoManual({ solicitacaoId }: { solicitacaoId?: string }) {
  return <p role="status" data-testid="formulario">{solicitacaoId ? `Produção: ${solicitacaoId}` : "Pedido manual"}</p>;
}
