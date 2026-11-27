type ProdutoOlistDatado = {
  ativo: boolean;
  dataCriacao?: string | null;
  dataAlteracao?: string | null;
};

export function tituloProdutoImportado(produto: { descricao?: unknown; nome?: unknown }) {
  for (const valor of [produto.descricao, produto.nome]) {
    if (typeof valor === "string" && valor.trim()) return valor.trim();
  }
  // Ausência na resposta não deve apagar um título já importado.
  return undefined;
}

function timestampValido(valor: string | null | undefined) {
  if (!valor) return null;

  const timestamp = Date.parse(valor);
  return Number.isNaN(timestamp) ? null : timestamp;
}

function timestampCadastro(produto: ProdutoOlistDatado) {
  return timestampValido(produto.dataCriacao) ?? timestampValido(produto.dataAlteracao);
}

export function selecionarProdutoOlistPrioritario<T extends ProdutoOlistDatado>(
  atual: T,
  candidato: T,
) {
  if (atual.ativo !== candidato.ativo) {
    return candidato.ativo ? candidato : atual;
  }

  const timestampAtual = timestampCadastro(atual);
  const timestampCandidato = timestampCadastro(candidato);

  if (timestampCandidato === null) return atual;
  if (timestampAtual === null || timestampCandidato > timestampAtual) return candidato;

  return atual;
}
