export const QUANTIDADE_ESTOQUE_MAXIMA = 2_147_483_647;

export function quantidadeEstoqueValida(valor: unknown) {
  const quantidade = Number(valor);

  return (
    Number.isSafeInteger(quantidade) &&
    quantidade > 0 &&
    quantidade <= QUANTIDADE_ESTOQUE_MAXIMA
  );
}
