import assert from "node:assert/strict";
import test from "node:test";
import { pedidoManualSchema, montarDadosPedidoManual } from "../src/lib/pedido-manual-contrato";
import { dadosPedidoFilaSchema } from "../src/lib/fila-fornecedor-contrato";
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12,"0")}`;
const entrada = () => ({ versao: 2, origemManual: { aplicativoId:id(1), vendedor:{id:20,nome:"Vendedor",cpfCnpj:null},cliente:{id:30,nome:"Cliente",cpfCnpj:null,uf:"MG"} },
  decisaoDirecionamento:{tipo:"CONTA_UNICA",regraId:null,regraNome:null,versao:0,aplicativoId:id(1),motivo:"Única conta disponível."},
  aplicativoId: id(1), chaveIdempotencia: id(2), observacao: null,
  selecoes: { vendedorId: 20, clienteId: 30 }, itens: [{ id: id(3), tecidoNome: "Oxford", quantidade: 10,
    quantidadeTecido: 2.5, estampa: "6861", variante: "A", tamanho: "30x30", tipoProduto: "Lenço", corteLaser: true }] });
test("pedido manual admite dados comerciais parciais e mantém peças e metros independentes", () => {
  const parsed = pedidoManualSchema.parse(entrada());
  const snapshot = dadosPedidoFilaSchema.parse(montarDadosPedidoManual(parsed));
  assert.equal(snapshot.itens[0].quantidade,10);
  assert.equal(snapshot.itens[0].quantidadeTecido,2.5);
  assert.equal(snapshot.itens[0].tecido.id,id(3));
  assert.equal(snapshot.olist?.selecoes.vendedorId,20);
  assert.equal(snapshot.olist?.selecoes.formaId,undefined);
});
test("pedido manual rejeita IDs duplicados, tecido alheio, excesso, preços e quantidades inválidas", () => {
  const original = entrada();
  for (const body of [
    {...original, itens: []}, {...original, itens: Array(101).fill(original.itens[0])},
    {...original, itens: [original.itens[0],original.itens[0]]},
    {...original, selecoes: { clienteId: 30 }}, {...original, selecoes: { vendedorId: 20 }},
    {...original, selecoes: { ...original.selecoes, tecidos: [{ tecidoId:id(9), id:40 }] }},
    {...original, selecoes: { ...original.selecoes, tecidos: [{ tecidoId:id(3), id:40,preco:-1 }] }},
    {...original, itens: [{...original.itens[0],quantidade:1.5}]},
    {...original, itens: [{...original.itens[0],quantidadeTecido:0}]},
    {...original, itens: [{...original.itens[0],tecidoNome:" "}]},
    {...original, fornecedorId:id(99)},
  ]) assert.equal(pedidoManualSchema.safeParse(body).success,false);
});
