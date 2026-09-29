import assert from "node:assert/strict";
import test from "node:test";
import {
  ComponenteKitOlistError,
  expandirDemandasKitsOlist,
  extrairComponentesSkuKitOlist,
  selecionarSkuComponenteKitOlist,
} from "../src/lib/componentes-kit-olist";

const SKU_KIT = "KIT2-AFRO-1/70X70-6921-H-1/150X150-6921-D";
const SKU_LENCO = "TP/LENCO-MODA-AFRO-C/LASER-TA/70X70-EST/6921-H";
const SKU_PAREO = "TP/PAREO-AFRO-C/LASER-TA/150X150-EST/6921-D";

test("extrai variantes e quantidades do SKU legado do kit", () => {
  assert.deepEqual(extrairComponentesSkuKitOlist(SKU_KIT), [
    { variante: "6921-H", quantidade: 1 },
    { variante: "6921-D", quantidade: 1 },
  ]);
});

test("extrai quantidade maior que um sem usar o tamanho como filtro", () => {
  assert.deepEqual(
    extrairComponentesSkuKitOlist("KIT2-AFRO-2/70X70-6921-H-3/150X150-6921-D"),
    [
      { variante: "6921-H", quantidade: 2 },
      { variante: "6921-D", quantidade: 3 },
    ],
  );
});

test("suporta o formato de kit separado por dois sublinhados", () => {
  assert.deepEqual(extrairComponentesSkuKitOlist(`KIT__${SKU_LENCO}__${SKU_PAREO}`), [
    { variante: "6921-H", quantidade: 1 },
    { variante: "6921-D", quantidade: 1 },
  ]);
});

test("seleciona pelo conteudo da variante e ignora candidatos KIT", () => {
  const resultado = selecionarSkuComponenteKitOlist({
    skuKit: SKU_KIT,
    variante: "6921-H",
    skusCandidatos: [SKU_KIT, SKU_LENCO, SKU_PAREO],
  });

  assert.equal(resultado, SKU_LENCO);
});

test("nao exige que o tamanho do SKU do produto corresponda ao tamanho escrito no kit", () => {
  const skuMesmoCodigoOutroTamanho = "TP/PRODUTO/LASER-TA/OUTRO-TAMANHO-EST/6921-H";
  const resultado = selecionarSkuComponenteKitOlist({
    skuKit: SKU_KIT,
    variante: "6921-H",
    skusCandidatos: [skuMesmoCodigoOutroTamanho],
  });

  assert.equal(resultado, skuMesmoCodigoOutroTamanho);
});

test("bloqueia variante sem produto ativo correspondente", () => {
  assert.throws(
    () =>
      selecionarSkuComponenteKitOlist({
        skuKit: SKU_KIT,
        variante: "6921-H",
        skusCandidatos: [SKU_PAREO],
      }),
    (error: unknown) =>
      error instanceof ComponenteKitOlistError &&
      error.message.includes("Nao foi encontrado produto ativo"),
  );
});

test("bloqueia variante ambigua", () => {
  assert.throws(
    () =>
      selecionarSkuComponenteKitOlist({
        skuKit: SKU_KIT,
        variante: "6921-H",
        skusCandidatos: [SKU_LENCO, `OUTRO-PRODUTO/6921-H`],
      }),
    (error: unknown) =>
      error instanceof ComponenteKitOlistError &&
      error.message.includes("corresponde a mais de um SKU"),
  );
});

test("expande kits, multiplica pedidos e agrega venda individual do componente", () => {
  const demandas = new Map([
    [
      SKU_KIT,
      {
        sku: SKU_KIT,
        imagem_url: null,
        quantidade_pedidos: 3,
      },
    ],
    [
      SKU_LENCO,
      {
        sku: SKU_LENCO,
        imagem_url: "https://example.com/lenco.jpg",
        quantidade_pedidos: 2,
      },
    ],
  ]);

  const resultado = expandirDemandasKitsOlist({
    demandas,
    skusCandidatos: [SKU_LENCO, SKU_PAREO],
  });

  assert.deepEqual([...resultado.values()], [
    {
      sku: SKU_LENCO,
      imagem_url: "https://example.com/lenco.jpg",
      quantidade_pedidos: 5,
    },
    {
      sku: SKU_PAREO,
      imagem_url: null,
      quantidade_pedidos: 3,
    },
  ]);
});

test("rejeita SKU KIT em formato desconhecido", () => {
  assert.throws(
    () => extrairComponentesSkuKitOlist("KIT-SEM-COMPONENTES"),
    ComponenteKitOlistError,
  );
});
