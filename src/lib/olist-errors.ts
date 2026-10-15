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
