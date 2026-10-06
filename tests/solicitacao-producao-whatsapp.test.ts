import assert from "node:assert/strict";
import test from "node:test";
import { montarSolicitacaoProducaoWhatsapp } from "../src/lib/solicitacao-producao-whatsapp";

test("compartilha itens e soma tecidos preservando referências e observações", () => {
  const texto = montarSolicitacaoProducaoWhatsapp([
    { sku: "FMR-6329-250x145-Q", quantidade_solicitada: 3, tipo_corte: "LASER", observacao: "<!--produto-fornecido:start-->7,5 m de OXFORDINE 1065 (3 x 2,5 m).<!--produto-fornecido:end-->" },
    { sku: "TECIDO-SEDINHA-ESTAMPADO-143-100-6666-A", quantidade_solicitada: 1, tipo_corte: null, observacao: "1 m de FOURWAY 988 (1 × 1 m)" },
    { sku: "TP/LENCO-CONSCIENTIZACAO-C/LASER-TA/70X70-EST/6238-A", quantidade_solicitada: 6, tipo_corte: "LASER", observacao: "Corte com papel\n2,1 m de FOURWAY 988 (6 × 0,35 m)" },
  ]);
  assert.match(texto, /^SOLICITAÇÃO DE PRODUÇÃO/);
  assert.match(texto, /Quantidade: 1 unidade\nCorte a laser: Não/);
  assert.match(texto, /Corte a laser: Sim com papel/);
  assert.match(texto, /7,5 m de OXFORDINE 1065 \(3 × 2,5 m\)/);
  assert.match(texto, /TOTAL DE TECIDO\nOXFORDINE: 7,5 m\nFOURWAY: 3,1 m\nTotal geral: 10,6 m$/);
  assert.doesNotMatch(texto, /<!--/);
});

test("não inventa consumo quando falta observação e rejeita solicitação vazia", () => {
  const texto = montarSolicitacaoProducaoWhatsapp([
    { sku: "ITEM", quantidade_solicitada: 2, tipo_corte: "LASER", observacao: null },
  ]);
  assert.match(texto, /Total parcial informado: 0 m/);
  assert.match(texto, /1 item\(ns\) sem metragem informada/);
  assert.throws(() => montarSolicitacaoProducaoWhatsapp([]), /não possui itens/);
});
