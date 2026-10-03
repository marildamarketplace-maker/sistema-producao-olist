export class NenhumItemElegivelOlistError extends Error {
  constructor() {
    super("Nenhum item elegível encontrado nos pedidos da Olist.");
    this.name = "NenhumItemElegivelOlistError";
  }
}
