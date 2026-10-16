export class DetalheProducaoError extends Error {
  constructor(message: string, public readonly status: number) { super(message); }
}

export type DetalheProducao = {
  id: string;
  revisao: string;
  dataEntrega: string;
  createdAt: string;
  status: string;
  observacaoGeral: string | null;
  prioridadeProducao: boolean;
  periodoInicio: string | null;
  periodoFim: string | null;
  evidenciaDisponivel: boolean;
  pedidosOlist: Array<{ id: string; fornecedor: string }>;
  itens: Array<{
    id: string;
    produtoId: string;
    sku: string;
    imagemUrl: string | null;
    quantidadeSolicitada: number;
    quantidadeProduzida: number;
    tipoCorte: string | null;
    observacao: string | null;
  }>;
};
