import type { MarketplacePricing } from "@/lib/pricingCalculator";

/** Retorno publicitário = receita atribuída / gasto em anúncios, em múltiplos. */
export function calculateAdvertisingScenarios(result: Pick<MarketplacePricing, "recommendedPrice" | "estimatedProfit">) {
  const { recommendedPrice: revenue, estimatedProfit: contribution } = result;
  if (!Number.isFinite(revenue) || !Number.isFinite(contribution) || revenue <= 0 || contribution <= 0 || contribution > revenue) return null;

  return [
    { label: "Mínimo sem prejuízo", retainedShare: 0 },
    { label: "Intermediário", retainedShare: 0.25 },
    { label: "Bom", retainedShare: 0.5 },
  ].map(({ label, retainedShare }) => {
    const advertisingBudget = contribution * (1 - retainedShare);
    // Arredondar para cima impede recomendar retorno abaixo do equilíbrio.
    const returnMultiple = Math.ceil(revenue / advertisingBudget * 100) / 100;
    const adCost = revenue / returnMultiple;
    const profitAfterAds = contribution - adCost;
    return { label, retainedShare, returnMultiple, adCost, profitAfterAds, netMargin: profitAfterAds / revenue * 100 };
  });
}
