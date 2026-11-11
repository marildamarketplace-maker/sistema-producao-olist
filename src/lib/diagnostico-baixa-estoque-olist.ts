export type OperacaoConfirmacaoBaixa =
  | "validar_itens" | "consultar_composicoes" | "expandir_kits"
  | "consultar_produtos" | "cadastrar_produtos" | "reconsultar_produtos"
  | "verificar_duplicidade" | "abrir_transacao" | "obter_lock"
  | "revalidar_composicoes" | "revalidar_duplicidade" | "criar_baixa"
  | "criar_movimentacao" | "registrar_item_baixa" | "confirmar_transacao"
  | "atualizar_cursor";

const operacoes = new WeakMap<object, OperacaoConfirmacaoBaixa>();

/** Mantém o erro original e seus contratos, sem anexar payloads ao diagnóstico. */
export function registrarOperacaoErroBaixa(error: unknown, operacao: OperacaoConfirmacaoBaixa) {
  if (error !== null && typeof error === "object") operacoes.set(error, operacao);
}

/** Diagnóstico por lista permitida: nunca inclui payloads, SQL ou credenciais. */
export function diagnosticarErroBaixaEstoqueOlist(error: unknown) {
  const mensagem = error instanceof Error ? error.message : "";
  const regras: Array<[RegExp, string]> = [
    [/Nao foi possivel identificar.*(?:componentes|variante)|quantidade de componente invalida/i, "SKU do kit não permite inferir a composição. Cadastre em Produtos → Associação de kits."],
    [/Nao foi encontrado produto ativo para a variante/i, "Componente inferido do kit sem produto ativo neste aplicativo."],
    [/corresponde a mais de um SKU/i, "Componente do kit ambíguo. Cadastre a composição explicitamente."],
    [/^Kit .+ sem associação de componentes\./, "Kit sem composição cadastrada. Cadastre em Produtos → Associação de kits."],
    [/transaction.*(?:timed out|expired)|timeout.*transaction/i, "Tempo limite da transação de baixa excedido."],
    [/Token inválido|OAuth|integração.*não está conectada|Nenhuma integração Olist conectada/i, "Falha de autenticação ou integração Olist desconectada."],
    [/Erro (?:Olist|Tiny) 429|limite de requisições/i, "Limite de requisições da Olist atingido."],
    [/Baixa duplicada/i, "Baixa duplicada bloqueada."],
    [/Composição do kit alterada/i, "Composição do kit alterada durante a baixa."],
    [/sem itens/i, "Pedido retornou sem itens para baixa."],
    [/item invalido|quantidade inválida|quantidade invalida|SKU\/referência/i, "Item sem SKU ou com quantidade inválida."],
    [/Período final inválido/i, "Período final inválido para concluir a busca."],
  ];
  const codigo = error && typeof error === "object" && "code" in error
    ? error.code : null;
  const codigoBanco = typeof codigo === "string" && /^P\d{4}$/.test(codigo)
    ? codigo : null;
  const statusHttp = mensagem.match(/^Erro (?:Olist|Tiny) (\d{3})(?:\b)/)?.[1];
  const operacao = error !== null && typeof error === "object" ? operacoes.get(error) : undefined;
  return {
    tipoErro: error instanceof Error ? "Error" : "Erro desconhecido",
    motivo: regras.find(([padrao]) => padrao.test(mensagem))?.[1]
      ?? (codigoBanco ? "Falha na operação de banco de dados."
        : statusHttp ? `Falha HTTP ${statusHttp} na API Olist.`
          : "Falha não classificada; investigar a etapa indicada."),
    ...(codigoBanco ? { codigoBanco } : {}),
    ...(operacao ? { operacao } : {}),
  };
}
