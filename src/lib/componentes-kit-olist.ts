export type DemandaProdutoOlist = {
  sku: string;
  imagem_url: string | null;
  quantidade_pedidos: number;
  pedido_olist_ids: string[];
  skus_olist_origem: string[];
};

export type ComponenteSkuKitOlist = {
  variante: string;
  quantidade: number;
};

export class ComponenteKitOlistError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ComponenteKitOlistError";
  }
}

export function skuEhKitOlist(sku: string) {
  return sku.trim().toUpperCase().startsWith("KIT");
}

function validarQuantidadeComponente(quantidadeTexto: string, skuKit: string) {
  const quantidade = Number(quantidadeTexto);

  if (!Number.isSafeInteger(quantidade) || quantidade <= 0) {
    throw new ComponenteKitOlistError(
      `O kit ${skuKit} possui quantidade de componente invalida: ${quantidadeTexto}.`,
    );
  }

  return quantidade;
}

function extrairComponentesFormatoComSeparador(skuKit: string) {
  const partes = skuKit
    .split("__")
    .slice(1)
    .map((parte) => parte.trim())
    .filter(Boolean);

  if (partes.length === 0) return [];

  return partes.map((skuComponente) => {
    const variante = skuComponente.match(/(?:^|\/)(\d+-[A-Z0-9]+)$/i)?.[1];

    if (!variante) {
      throw new ComponenteKitOlistError(
        `Nao foi possivel identificar a variante do componente ${skuComponente} no kit ${skuKit}.`,
      );
    }

    return {
      variante: variante.toUpperCase(),
      quantidade: 1,
    };
  });
}

export function extrairComponentesSkuKitOlist(sku: string): ComponenteSkuKitOlist[] {
  const skuKit = sku.trim();

  if (!skuEhKitOlist(skuKit)) return [];

  if (skuKit.includes("__")) {
    const componentes = extrairComponentesFormatoComSeparador(skuKit);

    if (componentes.length > 0) return componentes;
  }

  const componentes = [...skuKit.matchAll(/(?:^|-)(\d+)\/[^/]*?-(\d+-[A-Z0-9]+)(?=-\d+\/|$)/gi)].map(
    (resultado) => ({
      quantidade: validarQuantidadeComponente(resultado[1], skuKit),
      variante: resultado[2].toUpperCase(),
    }),
  );

  if (componentes.length === 0) {
    throw new ComponenteKitOlistError(
      `Nao foi possivel identificar os componentes do kit ${skuKit}.`,
    );
  }

  return componentes;
}

export function selecionarSkuComponenteKitOlist(input: {
  skuKit: string;
  variante: string;
  skusCandidatos: readonly string[];
}) {
  const varianteNormalizada = input.variante.trim().toUpperCase();
  const correspondencias = input.skusCandidatos.filter((sku) => {
    const skuNormalizado = sku.trim().toUpperCase();
    return !skuEhKitOlist(skuNormalizado) && skuNormalizado.includes(varianteNormalizada);
  });

  if (correspondencias.length === 0) {
    throw new ComponenteKitOlistError(
      `Nao foi encontrado produto ativo para a variante ${varianteNormalizada} do kit ${input.skuKit}.`,
    );
  }

  if (correspondencias.length > 1) {
    throw new ComponenteKitOlistError(
      `A variante ${varianteNormalizada} do kit ${input.skuKit} corresponde a mais de um SKU: ${correspondencias.join(", ")}.`,
    );
  }

  return correspondencias[0];
}

function somarDemanda(
  demandas: Map<string, DemandaProdutoOlist>,
  demanda: DemandaProdutoOlist,
) {
  const atual = demandas.get(demanda.sku);
  const quantidade = (atual?.quantidade_pedidos ?? 0) + demanda.quantidade_pedidos;
  const pedidoOlistIds = [
    ...new Set([...(atual?.pedido_olist_ids ?? []), ...demanda.pedido_olist_ids]),
  ];
  const skusOlistOrigem = [
    ...new Set([...(atual?.skus_olist_origem ?? []), ...demanda.skus_olist_origem]),
  ];

  if (!Number.isSafeInteger(quantidade) || quantidade <= 0) {
    throw new ComponenteKitOlistError(
      `A quantidade calculada para o SKU ${demanda.sku} e invalida.`,
    );
  }

  demandas.set(demanda.sku, {
    sku: demanda.sku,
    imagem_url: atual?.imagem_url ?? demanda.imagem_url,
    quantidade_pedidos: quantidade,
    pedido_olist_ids: pedidoOlistIds,
    skus_olist_origem: skusOlistOrigem,
  });
}

export function expandirDemandasKitsOlist(input: {
  demandas: ReadonlyMap<string, DemandaProdutoOlist>;
  skusCandidatos: readonly string[];
}) {
  const demandasExpandidas = new Map<string, DemandaProdutoOlist>();

  for (const demanda of input.demandas.values()) {
    if (!skuEhKitOlist(demanda.sku)) {
      somarDemanda(demandasExpandidas, demanda);
      continue;
    }

    const componentes = extrairComponentesSkuKitOlist(demanda.sku);

    for (const componente of componentes) {
      const skuComponente = selecionarSkuComponenteKitOlist({
        skuKit: demanda.sku,
        variante: componente.variante,
        skusCandidatos: input.skusCandidatos,
      });
      const quantidadePedidos = demanda.quantidade_pedidos * componente.quantidade;

      if (!Number.isSafeInteger(quantidadePedidos) || quantidadePedidos <= 0) {
        throw new ComponenteKitOlistError(
          `A quantidade calculada para a variante ${componente.variante} do kit ${demanda.sku} e invalida.`,
        );
      }

      somarDemanda(demandasExpandidas, {
        sku: skuComponente,
        imagem_url: null,
        quantidade_pedidos: quantidadePedidos,
        pedido_olist_ids: demanda.pedido_olist_ids,
        skus_olist_origem: demanda.skus_olist_origem,
      });
    }
  }

  return demandasExpandidas;
}
