import { FeeRange, MARKETPLACE_FEES, MarketplaceId } from "@/lib/marketplaceFees";

export type PricingInput = {
  pricePerMeter: number;
  metersUsed: number;
  extraCosts: number;
  taxesPercentage: number;
  laborPercentage: number;
  profitPercentage: number;
};

export type MarketplacePricing = {
  marketplaceId: MarketplaceId;
  marketplaceName: string;
  minimumPrice: number;
  recommendedPrice: number;
  percentageFee: number;
  fixedFee: number;
  materialCost: number;
  extraCosts: number;
  totalCost: number;
  marketplaceCost: number;
  taxes: number;
  labor: number;
  estimatedProfit: number;
  netMargin: number;
};

const COMMERCIAL_PRICE_STEP = 5;
const COMMERCIAL_ENDING = 0.9;
const CENT_TOLERANCE = 0.001;

function isPriceInRange(price: number, range: FeeRange) {
  return price + CENT_TOLERANCE >= range.minPrice
    && (range.maxPrice === null || price <= range.maxPrice + CENT_TOLERANCE);
}

function calculateFixedFee(price: number, range: FeeRange) {
  return range.fixedFee + price * (range.proportionalFixedFee ?? 0);
}

export function roundToCommercialPrice(minimumPrice: number) {
  const rounded = Math.ceil(
    (minimumPrice - COMMERCIAL_ENDING - CENT_TOLERANCE) / COMMERCIAL_PRICE_STEP,
  ) * COMMERCIAL_PRICE_STEP + COMMERCIAL_ENDING;

  return Number(Math.max(minimumPrice, rounded).toFixed(2));
}

function findRecommendedPrice(
  minimumPrice: number,
  totalCost: number,
  ranges: readonly FeeRange[],
  taxes: number,
  labor: number,
  profit: number,
) {
  let candidate = roundToCommercialPrice(minimumPrice);

  for (let attempt = 0; attempt < 1_000; attempt += 1) {
    const range = ranges.find((item) => isPriceInRange(candidate, item));
    if (range) {
      const marketplaceCost = candidate * range.percentage + calculateFixedFee(candidate, range);
      const availableProfit = candidate - totalCost - marketplaceCost - candidate * taxes - candidate * labor;
      if (availableProfit + CENT_TOLERANCE >= candidate * profit) return { price: candidate, range };
    }
    candidate = Number((candidate + COMMERCIAL_PRICE_STEP).toFixed(2));
  }

  return null;
}

function findValidPrice(
  totalCost: number,
  range: FeeRange,
  taxes: number,
  labor: number,
  profit: number,
) {
  const totalRate = range.percentage + (range.proportionalFixedFee ?? 0) + taxes + labor + profit;
  const denominator = 1 - totalRate;
  if (denominator <= 0) return null;

  const calculatedPrice = (totalCost + range.fixedFee) / denominator;
  const candidate = Math.max(calculatedPrice, range.minPrice);
  return isPriceInRange(candidate, range) ? candidate : null;
}

export function calculateMarketplacePrices(input: PricingInput): MarketplacePricing[] {
  const materialCost = input.pricePerMeter * input.metersUsed;
  const totalCost = materialCost + input.extraCosts;
  const taxesRate = input.taxesPercentage / 100;
  const laborRate = input.laborPercentage / 100;
  const profitRate = input.profitPercentage / 100;

  return Object.values(MARKETPLACE_FEES).map((marketplace) => {
    const validOptions = marketplace.ranges
      .map((range) => ({
        range,
        price: findValidPrice(totalCost, range, taxesRate, laborRate, profitRate),
      }))
      .filter((option): option is { range: FeeRange; price: number } => option.price !== null)
      .sort((a, b) => a.price - b.price);

    const minimumOption = validOptions[0];
    if (!minimumOption) {
      throw new Error(`Não foi possível calcular um preço válido para ${marketplace.name}.`);
    }

    const minimumPrice = minimumOption.price;
    const recommendation = findRecommendedPrice(
      minimumPrice,
      totalCost,
      marketplace.ranges,
      taxesRate,
      laborRate,
      profitRate,
    );
    if (!recommendation) {
      throw new Error(`O preço recomendado não pertence a uma faixa válida de ${marketplace.name}.`);
    }
    const { price: recommendedPrice, range: recommendedRange } = recommendation;

    const fixedFee = calculateFixedFee(recommendedPrice, recommendedRange);
    const percentageCost = recommendedPrice * recommendedRange.percentage;
    const marketplaceCost = percentageCost + fixedFee;
    const taxes = recommendedPrice * taxesRate;
    const labor = recommendedPrice * laborRate;
    const estimatedProfit = recommendedPrice - totalCost - marketplaceCost - taxes - labor;

    return {
      marketplaceId: marketplace.id,
      marketplaceName: marketplace.name,
      minimumPrice,
      recommendedPrice,
      percentageFee: recommendedRange.percentage * 100,
      fixedFee,
      materialCost,
      extraCosts: input.extraCosts,
      totalCost,
      marketplaceCost,
      taxes,
      labor,
      estimatedProfit,
      netMargin: recommendedPrice > 0 ? (estimatedProfit / recommendedPrice) * 100 : 0,
    };
  });
}
