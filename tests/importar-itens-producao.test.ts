import assert from "node:assert/strict";
import test from "node:test";
import { importarItensProducao, type LinhaImportacaoProducao } from "../src/lib/importar-itens-producao";

const produtos = [{ id: "a", sku: "SKU-A" }, { id: "b", sku: "SKU-B" }];
const atual: LinhaImportacaoProducao = { chave: "item-a", id: "item-a", produtoId: "a", sku: "SKU-A", solicitada: "5", produzida: "3" };

test("aceita colagem de planilha, cabeçalho e separadores documentados", () => {
  for (const separador of [";", ",", "\t", " ", "   "]) {
    const resultado = importarItensProducao(`\uFEFFsku${separador}qtd\r\nSKU-A${separador} 10\r\n\nSKU-B${separador}25`, produtos, []);
    assert.equal(resultado.quantidade, 2);
    assert.deepEqual(resultado.linhas.map((linha) => [linha.sku, linha.solicitada, linha.produzida]), [["SKU-A", "10", "0"], ["SKU-B", "25", "0"]]);
  }
});

test("atualiza solicitada, preserva identidade, produzida e itens ausentes sem mutar entrada", () => {
  const outro = { ...atual, chave: "item-b", id: "item-b", produtoId: "b", sku: "SKU-B" };
  const resultado = importarItensProducao("SKU-A;0", produtos, [atual, outro]);
  assert.deepEqual(resultado.linhas, [{ ...atual, solicitada: "0" }, outro]);
  assert.equal(atual.solicitada, "5");
});

test("rejeita quantidades inválidas, campos extras, SKU desconhecido e duplicidade sem alterar originais", () => {
  for (const texto of ["", "sku;qtd", "SKU-A;", "SKU-A;-1", "SKU-A;1.5", "SKU-A;1,5", "SKU-A;2147483648", "SKU-A;Infinity", "SKU-A;1;extra", "sku-a;1", "INEXISTENTE;5", "SKU-A;1\nSKU-A;2", "SKU-A;10\nSKU-B;erro"]) {
    assert.throws(() => importarItensProducao(texto, produtos, [atual]), Error, texto);
    assert.equal(atual.solicitada, "5");
  }
  assert.throws(() => importarItensProducao("SKU-A;2", [...produtos, { id: "c", sku: "SKU-A" }], []), /mais de um produto/);
  assert.throws(() => importarItensProducao("SKU-A;2", produtos, [atual, { ...atual, id: "outro" }]), /mais de um item/);
});

test("valida limites e preserva localização da linha com erro", () => {
  assert.equal(importarItensProducao("SKU-A;2147483647", produtos, []).linhas[0].solicitada, "2147483647");
  assert.throws(() => importarItensProducao("x".repeat(100001), produtos, []), /100000/);
  assert.throws(() => importarItensProducao(Array(501).fill("SKU-A;1").join("\n"), produtos, []), /500/);
  assert.throws(() => importarItensProducao("\nSKU-A;1\nSKU-B;erro", produtos, []), /Linha 3/);
  const quinhentos = Array.from({ length: 500 }, (_, i) => ({ ...atual, produtoId: `produto-${i}` }));
  assert.throws(() => importarItensProducao("SKU-A;1", produtos, quinhentos), /máximo 500/);
});


test("importa laser e observação com pontuação e aspas", () => {
  const resultado = importarItensProducao('sku;qtd;laser;observação\nSKU-A;10;sim;Cortar frente, verso\nSKU-B;2;não;"Usar detalhe; e ""aspas"""', produtos, []);
  assert.deepEqual(resultado.linhas.map(({ tipoCorte, observacao }) => [tipoCorte, observacao]), [["LASER", "Cortar frente, verso"], [null, 'Usar detalhe; e "aspas"']]);
  const planilha = importarItensProducao("SKU-A\t3\tsim\tObservação da planilha", produtos, []);
  assert.equal(planilha.linhas[0].observacao, "Observação da planilha");
});

test("colunas omitidas preservam metadados; não remove laser e quarta coluna vazia limpa observação", () => {
  const linha = { ...atual, tipoCorte: "LASER", observacao: "Manter" };
  assert.deepEqual(importarItensProducao("SKU-A;2", produtos, [linha]).linhas[0], { ...linha, solicitada: "2" });
  const resultado = importarItensProducao("SKU-A;2;não;", produtos, [linha]).linhas[0];
  assert.equal(resultado.tipoCorte, null);
  assert.equal(resultado.observacao, null);
  assert.equal(resultado.produzida, "3");
  assert.equal(importarItensProducao("SKU-A\t2\tnão\t", produtos, [linha]).linhas[0].observacao, null);
  assert.equal(importarItensProducao("SKU-A;2;;Trocar texto", produtos, [linha]).linhas[0].tipoCorte, "LASER");
});

test("rejeita corte desconhecido, aspas abertas e observação acima do limite", () => {
  for (const texto of ["SKU-A;2;talvez;teste", 'SKU-A;2;sim;"aberto', `SKU-A;2;sim;${"x".repeat(5001)}`, "SKU-A;2;sim;texto;extra"]) {
    assert.throws(() => importarItensProducao(texto, produtos, [atual]));
  }
});
