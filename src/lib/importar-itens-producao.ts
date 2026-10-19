export type LinhaImportacaoProducao = {
  chave: string; id: string | null; produtoId: string; sku: string;
  solicitada: string; produzida: string; tipoCorte?: string | null; observacao?: string | null;
};

/** Prepara a edição inteira antes de aplicar qualquer alteração ao formulário. */
export function importarItensProducao(
  texto: string,
  produtos: readonly { id: string; sku: string }[],
  atuais: readonly LinhaImportacaoProducao[],
): { linhas: LinhaImportacaoProducao[]; quantidade: number } {
  if (texto.length > 100_000) throw new Error("O texto excede o limite de 100000 caracteres.");
  const entradas = texto.replace(/^\uFEFF/, "").split(/\r?\n/)
    .map((valor, indice) => ({ valor: valor.replace(/^ +|[ \r]+$/g, ""), numero: indice + 1 })).filter(({ valor }) => valor.trim());
  if (entradas[0] && /^sku[\t;, ]+(qtd|quantidade)([\t;,].*)?$/i.test(entradas[0].valor)) entradas.shift();
  if (!entradas.length || entradas.length > 500) throw new Error("Informe entre 1 e 500 linhas com SKU e quantidade.");

  const porSku = new Map<string, { id: string; sku: string }[]>();
  for (const produto of produtos) porSku.set(produto.sku, [...(porSku.get(produto.sku) ?? []), produto]);
  const vistos = new Set<string>();
  const importados = entradas.map(({ valor, numero }) => {
    const separador = valor.includes("\t") ? "\t" : valor.includes(";") ? ";" : valor.includes(",") ? "," : null;
    const campos = separador ? separarCampos(valor, separador, numero) : valor.split(/ +/);
    const corte = campos[2]?.trim().toLocaleLowerCase("pt-BR");
    if (corte && !["sim", "não", "nao", "1", "0", "laser"].includes(corte)) {
      throw new Error(`Linha ${numero}: corte laser deve ser sim ou não.`);
    }
    if ((campos[3]?.length ?? 0) > 5000) throw new Error(`Linha ${numero}: observação deve ter até 5000 caracteres.`);
    if ((campos.length < 2 || campos.length > 4) || !campos[0] || !/^\d+$/.test(campos[1]) || Number(campos[1]) > 2_147_483_647) {
      throw new Error(`Linha ${numero}: informe SKU e quantidade inteira entre 0 e 2147483647, separados por ponto e vírgula, vírgula, tabulação ou espaço.`);
    }
    const [sku, quantidade] = campos;
    if (vistos.has(sku)) throw new Error(`Linha ${numero}: SKU ${sku} repetido na importação.`);
    vistos.add(sku);
    const correspondencias = porSku.get(sku) ?? [];
    if (!correspondencias.length) throw new Error(`Linha ${numero}: SKU ${sku} não encontrado entre os produtos ativos.`);
    if (correspondencias.length > 1) throw new Error(`Linha ${numero}: SKU ${sku} corresponde a mais de um produto.`);
    const produto = correspondencias[0];
    if (atuais.filter((linha) => linha.produtoId === produto.id).length > 1) {
      throw new Error(`Linha ${numero}: SKU ${sku} aparece em mais de um item da produção. Ajuste os itens antes de importar.`);
    }
    return { produto, solicitada: String(Number(quantidade)),
      tipoCorte: corte ? (["sim", "1", "laser"].includes(corte) ? "LASER" : null) : undefined,
      observacao: campos.length === 4 ? campos[3] || null : undefined,
    };
  });
  const linhas = atuais.map((linha) => ({ ...linha }));
  for (const { produto, solicitada, tipoCorte, observacao } of importados) {
    const existente = linhas.find((linha) => linha.produtoId === produto.id);
    if (existente) {
      existente.solicitada = solicitada;
      if (tipoCorte !== undefined) existente.tipoCorte = tipoCorte;
      if (observacao !== undefined) existente.observacao = observacao;
    }
    else linhas.push({ chave: `importado:${produto.id}`, id: null, produtoId: produto.id, sku: produto.sku, solicitada, produzida: "0", tipoCorte: tipoCorte ?? null, observacao: observacao ?? null });
  }
  if (linhas.length > 500) throw new Error("A produção pode ter no máximo 500 itens. Nenhum item foi importado.");
  return { linhas, quantidade: importados.length };
}

// Aceita campos entre aspas e aspas escapadas, sem dividir pontuação da observação.
function separarCampos(valor: string, separador: string, numero: number): string[] {
  const campos: string[] = [];
  let campo = "";
  let aspas = false;
  for (let i = 0; i < valor.length; i++) {
    const caractere = valor[i];
    if (caractere === '"') {
      if (aspas && valor[i + 1] === '"') { campo += '"'; i++; }
      else aspas = !aspas;
    } else if (caractere === separador && !aspas) { campos.push(campo.trim()); campo = ""; }
    else campo += caractere;
  }
  if (aspas) throw new Error(`Linha ${numero}: feche as aspas do campo.`);
  campos.push(campo.trim());
  return campos;
}
