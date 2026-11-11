/** Diagnóstico por lista permitida: nunca inclui payloads, SQL ou credenciais. */
export function diagnosticarErroBaixaEstoqueOlist(error: unknown) {
  const mensagem = error instanceof Error ? error.message : "";
  const regras: Array<[RegExp, string]> = [
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
  return {
    tipoErro: error instanceof Error ? "Error" : "Erro desconhecido",
    motivo: regras.find(([padrao]) => padrao.test(mensagem))?.[1]
      ?? (codigoBanco ? "Falha na operação de banco de dados."
        : statusHttp ? `Falha HTTP ${statusHttp} na API Olist.`
          : "Falha não classificada; investigar a etapa indicada."),
    ...(codigoBanco ? { codigoBanco } : {}),
  };
}
