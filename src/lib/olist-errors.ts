/** Erro seguro: mantém apenas o tempo de espera, sem resposta HTTP ou credenciais. */
export class LimiteRequisicoesOlistError extends Error {
  constructor(readonly retryAfterMs: number | null) {
    super("Erro Olist 429: limite de requisições atingido.");
    this.name = "LimiteRequisicoesOlistError";
  }
}

export class NenhumItemElegivelOlistError extends Error {
  constructor() {
    super("Nenhum item elegível encontrado nos pedidos da Olist.");
    this.name = "NenhumItemElegivelOlistError";
  }
}

export type RecursoCadastroOlist = "produtos" | "contatos" | "formas-recebimento" | "servicos";

/** Diagnóstico permitido: não retém URL, token, cadastro ou resposta do provedor. */
export class ErroCadastroOlist extends Error {
  constructor(readonly recurso: RecursoCadastroOlist, readonly httpStatus: number | null, motivo: "HTTP" | "RESPOSTA" | "REDE") {
    const rotulo = { produtos: "Produto", contatos: "Cliente", "formas-recebimento": "Forma de recebimento", servicos: "Serviço de corte a laser" }[recurso];
    const detalhe = motivo === "REDE" ? "A consulta à Olist não terminou. Tente revisar novamente."
      : motivo === "RESPOSTA" ? "A Olist retornou um cadastro diferente ou uma resposta inválida. Selecione novamente na conta destinatária."
      : httpStatus === 404 ? "Cadastro não encontrado na conta destinatária. Selecione novamente."
      : httpStatus === 401 ? "A Olist recusou a autenticação. Reconecte a conta destinatária."
      : httpStatus === 403 ? "A integração não tem permissão para consultar este cadastro."
      : httpStatus === 429 ? "Limite de consultas da Olist atingido. Aguarde antes de tentar novamente."
      : `A consulta foi recusada pela Olist (HTTP ${httpStatus}). Revise a seleção na conta destinatária.`;
    super(`${rotulo}: ${detalhe}`);
    this.name = "ErroCadastroOlist";
  }
}

/** O ErrorDTO pode conter documentos/valores. Expõe somente campos e motivos conhecidos. */
export function resumirRejeicaoPedidoOlist(valor: unknown): string {
  if (!valor || typeof valor !== "object" || !("detalhes" in valor) || !Array.isArray(valor.detalhes)) return "";
  const mensagens: string[] = [];
  for (const item of valor.detalhes.slice(0, 20)) {
    if (!item || typeof item !== "object" || typeof item.campo !== "string") continue;
    const campo = item.campo.replace(/^\$\./, "").replace(/\.(\d{1,3})(?=\.|$)/g, "[$1]");
    const nomes: Record<string, string> = { idContato: "Cliente", vendedor: "Vendedor", "vendedor.id": "Vendedor", naturezaOperacao: "Natureza de operação",
      "naturezaOperacao.id": "Natureza de operação", pagamento: "Pagamento", "pagamento.formaRecebimento.id": "Forma de recebimento", "pagamento.formaRecebimento": "Forma de recebimento",
      "pagamento.meioPagamento": "Meio de pagamento", itens: "Itens", data: "Data do pedido", situacao: "Situação do pedido" };
    const indiceItem = /^itens\[(\d{1,3})\]\.(produto(?:\.(?:id|tipo))?|quantidade|valorUnitario|infoAdicional)$/.exec(campo);
    const parcela = /^pagamento\.parcelas\[(\d{1,3})\](?:\.(dias|valor|dataVencimento|formaRecebimento(?:\.id)?|meioPagamento))?$/.exec(campo);
    const rotulo = (Object.hasOwn(nomes, campo) ? nomes[campo] : undefined) ?? (indiceItem ? `Item ${Number(indiceItem[1]) + 1}: ${{ produto: "cadastro", quantidade: "quantidade", valorUnitario: "preço", infoAdicional: "informações adicionais" }[indiceItem[2].split(".")[0]]}` : parcela ? `Parcela ${Number(parcela[1]) + 1}` : null);
    if (!rotulo) continue;
    const texto = typeof item.mensagem === "string" ? item.mensagem.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase() : "";
    const motivo = /obrigatori|nao informad/.test(texto) ? "preenchimento obrigatório" : /nao encontrad|inexistent|nao cadastrad/.test(texto) ? "não encontrado na conta destinatária" : /inativ|bloquead/.test(texto) ? "inativo ou bloqueado" : "valor ou configuração recusados";
    mensagens.push(`${rotulo}: ${motivo}.`);
  }
  return [...new Set(mensagens)].join(" ");
}
