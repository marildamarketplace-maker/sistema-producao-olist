import assert from "node:assert/strict";
import test from "node:test";
import {
  ComponenteKitOlistError,
  expandirDemandasKitsOlist,
  extrairComponentesSkuKitOlist,
  selecionarSkuComponenteKitOlist,
  inferirComposicaoKitEstoque,
} from "../src/lib/componentes-kit-olist";

const SKU_KIT = "KIT2-AFRO-1/70X70-6921-H-1/150X150-6921-D";
const SKU_LENCO = "TP/LENCO-MODA-AFRO-C/LASER-TA/70X70-EST/6921-H";
const SKU_PAREO = "TP/PAREO-AFRO-C/LASER-TA/150X150-EST/6921-D";

test("inferência para baixa resolve componentes e quantidades e agrega repetidos", () => {
  assert.deepEqual(inferirComposicaoKitEstoque(SKU_KIT, [SKU_LENCO, SKU_PAREO]), [
    { kitSku: SKU_KIT, sku: SKU_LENCO, quantidade: 1 },
    { kitSku: SKU_KIT, sku: SKU_PAREO, quantidade: 1 },
  ]);
  const kit = "KIT2-AFRO-2/70X70-6921-H-3/70X70-6921-H";
  assert.deepEqual(inferirComposicaoKitEstoque(kit, [SKU_LENCO]), [
    { kitSku: kit, sku: SKU_LENCO, quantidade: 5 },
  ]);
});

test("baixa usa SKU completo no formato __ antes de considerar a variante", () => {
  const kit = `KIT__${SKU_LENCO}__${SKU_PAREO}`;
  assert.deepEqual(inferirComposicaoKitEstoque(kit, [SKU_LENCO, SKU_PAREO, "OUTRO/6921-H"]), [
    { kitSku: kit, sku: SKU_LENCO, quantidade: 1 },
    { kitSku: kit, sku: SKU_PAREO, quantidade: 1 },
  ]);
});

test("inferência de baixa bloqueia SKU parcial, ausência, ambiguidade e variantes parecidas", () => {
  for (const kit of ["KIT-SEM-PADRAO", `${SKU_KIT}-LIXO`, `${SKU_KIT}__`, "KIT__", "KIT2-0/70X70-6921-H", "KIT2-1/70X70-6921-H-INVALIDO-1/70X70-6921-D"]) {
    assert.throws(() => inferirComposicaoKitEstoque(kit, [SKU_LENCO, SKU_PAREO]));
  }
  assert.throws(() => inferirComposicaoKitEstoque(SKU_KIT, [SKU_LENCO]));
  assert.throws(() => inferirComposicaoKitEstoque(SKU_KIT, [SKU_LENCO, SKU_PAREO, "OUTRO/6921-H"]));
  assert.throws(() => inferirComposicaoKitEstoque(SKU_KIT, ["OUTRO/16921-H", "OUTRO/6921-H1", SKU_PAREO]));
});

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
        pedido_olist_ids: ["375443630"],
        skus_olist_origem: [SKU_KIT],
      },
    ],
    [
      SKU_LENCO,
      {
        sku: SKU_LENCO,
        imagem_url: "https://example.com/lenco.jpg",
        quantidade_pedidos: 2,
        pedido_olist_ids: ["375443631"],
        skus_olist_origem: [SKU_LENCO],
      },
    ],
  ]);

  const resultado = expandirDemandasKitsOlist({
    demandas,
    skusCandidatos: [SKU_LENCO, SKU_PAREO],
    composicoes: new Map([[SKU_KIT, [{ sku: SKU_LENCO, quantidade: 1 }, { sku: SKU_PAREO, quantidade: 1 }]]]),
  });

  assert.deepEqual([...resultado.values()], [
    {
      sku: SKU_LENCO,
      imagem_url: "https://example.com/lenco.jpg",
      quantidade_pedidos: 5,
      pedido_olist_ids: ["375443630", "375443631"],
      skus_olist_origem: [SKU_KIT, SKU_LENCO],
    },
    {
      sku: SKU_PAREO,
      imagem_url: null,
      quantidade_pedidos: 3,
      pedido_olist_ids: ["375443630"],
      skus_olist_origem: [SKU_KIT],
    },
  ]);
});

test("rejeita SKU KIT em formato desconhecido", () => {
  assert.throws(
    () => extrairComponentesSkuKitOlist("KIT-SEM-COMPONENTES"),
    ComponenteKitOlistError,
  );
});

function demanda(sku: string, quantidade = 3) {
  return { sku, imagem_url: null, quantidade_pedidos: quantidade, pedido_olist_ids: ["123"], skus_olist_origem: [sku] };
}

test("composição cadastrada tem precedência sobre variantes escritas no kit", () => {
  const resultado = expandirDemandasKitsOlist({
    demandas: new Map([[SKU_KIT, demanda(SKU_KIT)], [SKU_LENCO, demanda(SKU_LENCO, 1)]]),
    skusCandidatos: [SKU_LENCO, SKU_PAREO],
    composicoes: new Map([[SKU_KIT, [{ sku: SKU_LENCO, quantidade: 2 }]]]),
  });
  assert.equal(resultado.size, 1);
  assert.equal(resultado.get(SKU_LENCO)?.quantidade_pedidos, 7);
  assert.deepEqual(resultado.get(SKU_LENCO)?.skus_olist_origem, [SKU_KIT, SKU_LENCO]);
});

test("associação permite kit sem padrão reconhecível e mantém pedidos originais", () => {
  for (const sku of ["KIT-SEM-PADRAO", "COMBO-ESPECIAL", "KIT1-FORRINHO-MV20170-E"]) {
    const resultado = expandirDemandasKitsOlist({
      demandas: new Map([[sku, demanda(sku)]]), skusCandidatos: [SKU_LENCO, SKU_PAREO],
      composicoes: new Map([[sku, [{ sku: SKU_LENCO, quantidade: 2 }, { sku: SKU_PAREO, quantidade: 1 }]]]),
    });
    assert.equal(resultado.has(sku), false);
    assert.equal(resultado.get(SKU_LENCO)?.quantidade_pedidos, 6);
    assert.equal(resultado.get(SKU_PAREO)?.quantidade_pedidos, 3);
    assert.deepEqual(resultado.get(SKU_LENCO)?.pedido_olist_ids, ["123"]);
  }
});

test("solicitação bloqueia composições explícitas autorreferentes ou repetidas", () => {
  const sku = "KIT1-FORRINHO-MV20170-E";
  for (const componentes of [
    [{ sku, quantidade: 1 }],
    [{ sku: SKU_LENCO, quantidade: 1 }, { sku: SKU_LENCO, quantidade: 2 }],
  ]) {
    assert.throws(() => expandirDemandasKitsOlist({
      demandas: new Map([[sku, demanda(sku)]]), skusCandidatos: [sku, SKU_LENCO],
      composicoes: new Map([[sku, componentes]]),
    }));
  }
});

test("componente associado indisponível bloqueia geração sem recorrer ao padrão do SKU", () => {
  assert.throws(() => expandirDemandasKitsOlist({
    demandas: new Map([[SKU_KIT, demanda(SKU_KIT)]]), skusCandidatos: [SKU_LENCO, SKU_PAREO],
    composicoes: new Map([[SKU_KIT, [{ sku: "INATIVO-OU-OUTRO-APLICATIVO", quantidade: 1 }]]]),
  }), /não está ativo neste aplicativo/);
});

test("mistura associação explícita, kit sem associação e produto individual sem perder demanda", () => {
  const resultado = expandirDemandasKitsOlist({
    demandas: new Map([["COMBO", demanda("COMBO", 2)], [SKU_KIT, demanda(SKU_KIT, 1)], [SKU_LENCO, demanda(SKU_LENCO, 4)]]),
    skusCandidatos: [SKU_LENCO, SKU_PAREO],
    composicoes: new Map([["COMBO", [{ sku: SKU_PAREO, quantidade: 3 }]]]),
  });
  assert.equal(resultado.get(SKU_LENCO)?.quantidade_pedidos, 4);
  assert.equal(resultado.get(SKU_PAREO)?.quantidade_pedidos, 6);
  assert.equal(resultado.get(SKU_KIT)?.quantidade_pedidos, 1);
});

 test("solicitação mantém SKU e demanda do kit sem associação, com ou sem formato legado", () => {
  for (const sku of ["KIT1-FORRINHO-MV20170-E", SKU_KIT]) {
    const original = demanda(sku);
    const resultado = expandirDemandasKitsOlist({ demandas: new Map([[sku, original]]), skusCandidatos: [SKU_LENCO, SKU_PAREO] });
    assert.deepEqual([...resultado.values()], [original]);
  }
});
