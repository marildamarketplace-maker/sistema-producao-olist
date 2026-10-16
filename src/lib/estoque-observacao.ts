type MovimentoComObservacao = {
  tipoMovimento: string;
  origem: string;
  referenciaId: string | null;
  observacao: string | null;
};

export function observacaoMovimentacaoEstoque(
  movimento: MovimentoComObservacao,
  observacoesProducao: ReadonlyMap<string, string | null>,
): string | null {
  if (movimento.tipoMovimento !== "entrada" || movimento.origem !== "PRODUCAO" || !movimento.referenciaId) {
    return movimento.observacao;
  }
  const observacao = observacoesProducao.get(movimento.referenciaId);
  if (!observacao?.trim()) return movimento.observacao;
  return movimento.observacao?.trim()
    ? `${movimento.observacao} - ${observacao}`
    : observacao;
}
