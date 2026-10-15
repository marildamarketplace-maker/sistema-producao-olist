export type ContextoErroAuditoria = {
  etapa: "LISTAGEM" | "CONSULTA_ESTOQUE" | "VALIDACAO_ESTOQUE";
  offset?: number;
  produtoId?: string;
};

/** Nunca inclui mensagem arbitrária, corpo HTTP, headers ou stack do provedor. */
export function diagnosticarErroAuditoria(error: unknown) {
  const objeto = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const response = objeto.response && typeof objeto.response === "object"
    ? objeto.response as Record<string, unknown> : {};
  const statusMensagem = error instanceof Error ? /^Erro Olist (\d{3})\b/.exec(error.message)?.[1] : undefined;
  const status = response.status ?? (statusMensagem ? Number(statusMensagem) : undefined);
  if (typeof status === "number" && Number.isInteger(status) && status >= 400 && status <= 599) {
    return { codigo: `HTTP_${status}`, statusHttp: status };
  }
  if (objeto.code === "ECONNABORTED" || objeto.code === "ETIMEDOUT") return { codigo: "TIMEOUT" };
  if (objeto.code === "P2002") return { codigo: "CONFLITO_PERSISTENCIA" };
  if (error instanceof Error) {
    const validacoes: Record<string, string> = {
      "Resposta de estoque inválida.": "PAYLOAD_ESTOQUE_INVALIDO",
      "Identificação ou unidade de estoque inválida.": "ID_OU_UNIDADE_INVALIDA",
      "Saldo físico ausente ou inválido.": "SALDO_FISICO_INVALIDO",
      "Resposta de listagem de produtos inválida.": "PAYLOAD_LISTAGEM_INVALIDO",
      "Produto Olist sem identificação ou nome.": "PRODUTO_INVALIDO",
      "Produto repetido na paginação; auditoria incompleta.": "PAGINACAO_REPETIDA",
      "Prazo da auditoria excedido; resultado incompleto.": "PRAZO_EXCEDIDO",
    };
    if (validacoes[error.message]) return { codigo: validacoes[error.message] };
  }
  return { codigo: "ERRO_NAO_CLASSIFICADO" };
}

export class ErroEtapaAuditoria extends Error {
  readonly diagnostico: ReturnType<typeof diagnosticarErroAuditoria>;
  constructor(readonly contexto: ContextoErroAuditoria, error: unknown) {
    const diagnostico = diagnosticarErroAuditoria(error);
    super(`Falha na auditoria: ${contexto.etapa} (${diagnostico.codigo}).`);
    this.name = "ErroEtapaAuditoria";
    this.diagnostico = diagnostico;
  }
}
