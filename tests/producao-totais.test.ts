import assert from "node:assert/strict";
import test from "node:test";
import { calcularTotaisProducao } from "../src/lib/producao-totais";

test("soma quantidades e separa consumo total por corte sem multiplicá-lo novamente", () => {
  assert.deepEqual(calcularTotaisProducao([
    { quantidadeSolicitada: 2, tipoCorte: "LASER", observacao: "4,2 m de OXFORD (2 x 2,1 m)." },
    { quantidadeSolicitada: 3, tipoCorte: null, observacao: "<!--produto-fornecido:start-->Produto fornecido: 7,5 m de OXFORD 123 (3 × 2,5 m).<!--produto-fornecido:end-->" },
    { quantidadeSolicitada: 1, tipoCorte: "LASER", observacao: "Com papel\n1,2 m de FOURWAY (1 x 1,2 m).\n0,5 m de OXFORD (1 x 0,5 m)." },
  ]), { quantidade: 6, comLaser: 5.9, semLaser: 7.5, metragem: 13.4, itensSemMetragem: 0 });
});

test("sinaliza consumo ausente sem inferir metragem do SKU ou de texto livre", () => {
  assert.deepEqual(calcularTotaisProducao([
    { quantidadeSolicitada: 4, tipoCorte: null, observacao: null },
    { quantidadeSolicitada: 2, tipoCorte: "LASER", observacao: "Cortar 2 x 3 m" },
    { quantidadeSolicitada: 1, tipoCorte: "LASER", observacao: "1,2,3 m de OXFORD (1 x 1 m)." },
  ]), { quantidade: 7, comLaser: 0, semLaser: 0, metragem: 0, itensSemMetragem: 3 });
});

test("aceita lista vazia, zero informado e milhares no formato brasileiro", () => {
  assert.deepEqual(calcularTotaisProducao([]), { quantidade: 0, comLaser: 0, semLaser: 0, metragem: 0, itensSemMetragem: 0 });
  const totais = calcularTotaisProducao([
    { quantidadeSolicitada: 1000, tipoCorte: "LASER", observacao: "1.250,5 m de OXFORD (1000 x 1,2505 m)." },
    { quantidadeSolicitada: 0, tipoCorte: null, observacao: "0 m de OXFORD (0 x 1 m)." },
  ]);
  assert.equal(totais.metragem, 1250.5);
  assert.equal(totais.itensSemMetragem, 0);
});
