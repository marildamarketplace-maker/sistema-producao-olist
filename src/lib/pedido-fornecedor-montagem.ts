import {
  criarInfoAdicionalOlist,
  criarObservacoesPedidoOlist,
  type LinhaObservacaoPedidoOlist,
} from "@/lib/olist-pedido";

export class ErroMontagemFornecedor extends Error {}
export type LinhaFornecedor = { referencia: string; nome: string; preco: number; quantidade: number; quantidadeSolicitada: number; sku: string; estampa: string; variante: string; laser: boolean; tamanho: string; tipo: string };
export type ConfigPedidoFornecedor = { clienteId: number; vendedorId: number; formaId: number; plano: string; tipoVenda?: string | null; observacao?: string | null };
function formatarQuantidadeDivisao(quantidade: number) {
  return quantidade.toFixed(2).replace(".", ",");
}

function criarPagamentoPedido(formaPagamentoId: number, nomePlano: string, valorTotal: number) {
  if (!nomePlano.trim()) throw new ErroMontagemFornecedor("Plano de pagamento vazio.");
  const dias = nomePlano.toLocaleLowerCase("pt-BR") === "a vista"
    ? [0]
    : nomePlano.split("/").map(Number);
  if (dias.some((dia) => !Number.isInteger(dia) || dia < 0)) {
    throw new ErroMontagemFornecedor("O plano de pagamento do fornecedor possui parcelas inválidas.");
  }
  const totalCentavos = Math.round(valorTotal * 100);
  if (!Number.isSafeInteger(totalCentavos)) throw new ErroMontagemFornecedor("Valor total excede a precisão permitida.");
  const baseCentavos = Math.floor(totalCentavos / dias.length);
  const resto = totalCentavos - baseCentavos * dias.length;
  return {
    formaRecebimento: { id: formaPagamentoId },
    parcelas: dias.map((dia, indice) => ({
      dias: dia,
      valor: (baseCentavos + (indice < resto ? 1 : 0)) / 100,
      formaRecebimento: { id: formaPagamentoId },
    })),
  };
}

export function montarPedidoFornecedor(linhas: LinhaFornecedor[], config: ConfigPedidoFornecedor, servicoCorteLaser?: { referencia: string | null; preco: number } | null) {
    if (!linhas.length) throw new ErroMontagemFornecedor("Pedido sem itens.");
    let quantidadeCorteLaser = 0;
    const grupos = new Map<string, {
      referencia: string;
      nome: string;
      preco: number;
      quantidade: number;
      divisoes: Map<string, {
        estampa: string; variante: string; quantidade: number; laser: boolean; tamanho: string; tipo: string;
      }>;
    }>();

    for (const item of linhas) {
      const { referencia, nome, preco, quantidade, quantidadeSolicitada, sku, estampa, variante, laser, tamanho, tipo } = item;
      if (!Number.isFinite(quantidade) || quantidade <= 0 || !Number.isFinite(quantidadeSolicitada) || quantidadeSolicitada <= 0) throw new ErroMontagemFornecedor("Quantidade inválida.");
      if (!Number.isFinite(preco) || preco < 0) throw new ErroMontagemFornecedor("Preço inválido.");
      if (laser) quantidadeCorteLaser += quantidade;
      const chaveGrupo = `${referencia}\u0000${laser}`;
      const grupo = grupos.get(chaveGrupo) ?? {
        referencia,
        nome: nome,
        preco,
        quantidade: 0,
        divisoes: new Map(),
      };
      if (grupo.preco !== preco) throw new ErroMontagemFornecedor("O mesmo produto Olist foi associado com preços diferentes. Revise os tecidos.");
      grupo.quantidade += quantidade;
      const chave = `${sku}\u0000${estampa}\u0000${variante}\u0000${laser}\u0000${tamanho}\u0000${tipo}`;
      const divisao = grupo.divisoes.get(chave) ?? { estampa, variante, quantidade: 0, laser, tamanho, tipo };
      divisao.quantidade += quantidadeSolicitada;
      grupo.divisoes.set(chave, divisao);
      grupos.set(chaveGrupo, grupo);
    }

    const itens = [];
    const observacoes: LinhaObservacaoPedidoOlist[] = [];
    for (const grupo of grupos.values()) {
      const produtoId = Number(grupo.referencia);
      if (!Number.isSafeInteger(produtoId) || produtoId <= 0) throw new ErroMontagemFornecedor(`ID inválido para a referência ${grupo.referencia}.`);
      const divisoes = Array.from(grupo.divisoes.values());
      const infoAdicional = criarInfoAdicionalOlist(
        divisoes.map((divisao) => ({
          ...divisao,
          quantidade: formatarQuantidadeDivisao(divisao.quantidade),
          unidade: divisao.laser ? "UN" : "MT",
        })),
        "MT",
        { incluirTagsVazias: true },
      );
      for (const divisao of divisoes) {
        observacoes.push({
          descricao: grupo.nome,
          quantidade: formatarQuantidadeDivisao(divisao.quantidade),
          unidade: divisao.laser ? "UN" : "MT",
          estampa: divisao.estampa,
          variante: divisao.variante,
          laser: divisao.laser,
          tamanho: divisao.tamanho,
          tipo: divisao.tipo,
        });
      }
      if (Number(grupo.quantidade.toFixed(2)) <= 0) throw new ErroMontagemFornecedor("Quantidade de tecido inferior à precisão permitida pela Olist.");
      itens.push({
        produto: { id: produtoId, tipo: "P" },
        quantidade: Number(grupo.quantidade.toFixed(2)),
        valorUnitario: grupo.preco,
        infoAdicional,
      });
    }

    if (quantidadeCorteLaser > 0) {
      if (!servicoCorteLaser) {
        throw new ErroMontagemFornecedor("Fornecedor sem produto de serviço Corte a laser cadastrado.");
      }

      const servicoId = Number(servicoCorteLaser.referencia?.trim());
      if (!Number.isSafeInteger(servicoId) || servicoId <= 0) {
        throw new ErroMontagemFornecedor("O serviço Corte a laser deve possuir uma referência com o ID numérico da Olist.");
      }

      const precoServico = Number(servicoCorteLaser.preco);
      if (!Number.isFinite(precoServico) || precoServico < 0) {
        throw new ErroMontagemFornecedor("Preço inválido no serviço Corte a laser.");
      }

      itens.push({
        produto: { id: servicoId, tipo: "S" },
        quantidade: Number(quantidadeCorteLaser.toFixed(2)),
        valorUnitario: precoServico,
        infoAdicional: "",
      });
    }

    const observacoesComuns = [
      config.tipoVenda ? `Tipo de venda: ${config.tipoVenda}` : "",
      config.observacao ? `Observação do pedido: ${config.observacao.trim()}` : "",
    ].filter(Boolean).join("\n\n");

    return {
      idContato: config.clienteId,
      vendedor: { id: config.vendedorId },
      situacao: 0,
      data: new Date().toISOString().slice(0, 10),
      observacoes: observacoesComuns,
      observacoesInternas: criarObservacoesPedidoOlist(observacoes),
      pagamento: criarPagamentoPedido(
        config.formaId,
        config.plano,
        itens.reduce((total, item) => total + item.quantidade * item.valorUnitario, 0),
      ),
      itens,
    };

}
