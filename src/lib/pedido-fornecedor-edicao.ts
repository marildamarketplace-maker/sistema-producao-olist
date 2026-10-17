import { z } from "zod";
import type { DadosPedidoFila } from "@/lib/fila-fornecedor-contrato";

const texto = z.string().trim().max(500);
export const pedidoFornecedorEditavelSchema = z.object({
  observacao: z.string().trim().max(5000).nullable(),
  itens: z.array(z.object({
    produtoId: z.string().min(1).max(100),
    tecidoId: z.string().min(1).max(100),
    tecidoNome: texto.min(1).optional(),
    quantidade: z.number().int().positive().max(2147483647),
    quantidadeTecido: z.number().min(0.000001).max(1000000000),
    estampa: texto,
    variante: texto.nullable(),
    corteLaser: z.boolean(),
    tamanho: texto,
    tipoProduto: texto,
  }).strict()).min(1).max(1000),
}).strict();
export type PedidoFornecedorEditavel = z.infer<typeof pedidoFornecedorEditavelSchema>;
export type TecidoFilaOpcao = { id: string; nome: string; referencia: string | null };

export function montarEdicaoPedidoFila(dados: DadosPedidoFila): PedidoFornecedorEditavel {
  return {
    observacao: dados.observacao ?? null,
    itens: dados.itens.map((item) => ({
      produtoId: item.produtoId, tecidoId: item.tecido.id, quantidade: item.quantidade,
      quantidadeTecido: item.quantidadeTecido, estampa: item.estampa, variante: item.variante,
      ...(!item.tecido.nome ? { tecidoNome: "" } : {}),
      corteLaser: item.corteLaser, tamanho: item.tamanho, tipoProduto: item.tipoProduto,
    })),
  };
}

export function aplicarEdicaoPedidoFila(original: DadosPedidoFila, edicao: PedidoFornecedorEditavel, tecidos: TecidoFilaOpcao[]): DadosPedidoFila {
  if (original.itens.length !== edicao.itens.length) throw new Error("Os itens da solicitação foram alterados. Revise o pedido novamente.");
  const tecidosPorId = new Map(tecidos.map((tecido) => [tecido.id, tecido]));
  return {
    versao: 1, observacao: edicao.observacao,
    itens: original.itens.map((item, index) => {
      const editado = edicao.itens[index];
      if (editado.produtoId !== item.produtoId) throw new Error("Os produtos do pedido não correspondem à solicitação.");
      const semVinculo = !item.tecido.nome && item.tecido.id === item.produtoId && editado.tecidoId === item.tecido.id;
      const tecido = semVinculo && editado.tecidoNome?.trim()
        ? { id: item.tecido.id, nome: editado.tecidoNome.trim(), referencia: null }
        : tecidosPorId.get(editado.tecidoId);
      if (!tecido) throw new Error("Selecione um tecido cadastrado para este fornecedor.");
      return {
        ...item, tecido, quantidade: editado.quantidade,
        quantidadeTecido: Number(editado.quantidadeTecido.toFixed(6)),
        estampa: editado.estampa, variante: editado.variante || null,
        corteLaser: editado.corteLaser, tamanho: editado.tamanho, tipoProduto: editado.tipoProduto,
      };
    }),
  };
}
