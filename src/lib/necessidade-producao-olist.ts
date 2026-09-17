export type NecessidadeProducaoOlist =
  | {
      tipo: "COBERTO_POR_PRODUCAO_EXISTENTE";
      estoqueProjetado: number;
      quantidadeDisponivel: number;
      prioridade: false;
    }
  | {
      tipo: "ESTOQUE_SUFICIENTE";
      estoqueProjetado: number;
      quantidadeDisponivel: number;
      prioridade: false;
    }
  | {
      tipo: "NOVA_PRODUCAO";
      estoqueProjetado: number;
      quantidadeDisponivel: number;
      quantidadeSolicitada: number;
      prioridade: boolean;
    };

function arredondarParaPar(valor: number) {
  const inteiro = Math.ceil(valor);
  return inteiro % 2 === 0 ? inteiro : inteiro + 1;
}

export function calcularNecessidadeProducaoOlist(input: {
  estoqueAtual: number;
  quantidadePedidos: number;
  quantidadeEmProducao: number;
  metaEstoque: number;
  minimoEstoque: number;
}): NecessidadeProducaoOlist {
  const quantidadeDisponivel = input.estoqueAtual + input.quantidadeEmProducao;
  const estoqueProjetado = quantidadeDisponivel - input.quantidadePedidos;

  if (input.quantidadeEmProducao > 0 && quantidadeDisponivel >= input.quantidadePedidos) {
    return {
      tipo: "COBERTO_POR_PRODUCAO_EXISTENTE",
      estoqueProjetado,
      quantidadeDisponivel,
      prioridade: false,
    };
  }

  if (estoqueProjetado >= input.minimoEstoque) {
    return {
      tipo: "ESTOQUE_SUFICIENTE",
      estoqueProjetado,
      quantidadeDisponivel,
      prioridade: false,
    };
  }

  const quantidadeMinima = input.quantidadeEmProducao > 0
    ? Math.max(0, input.quantidadePedidos - quantidadeDisponivel)
    : input.quantidadePedidos;
  const quantidadeSolicitada = arredondarParaPar(
    Math.max(0, input.metaEstoque - estoqueProjetado, quantidadeMinima),
  );

  return {
    tipo: "NOVA_PRODUCAO",
    estoqueProjetado,
    quantidadeDisponivel,
    quantidadeSolicitada,
    prioridade: quantidadeDisponivel < input.quantidadePedidos,
  };
}
