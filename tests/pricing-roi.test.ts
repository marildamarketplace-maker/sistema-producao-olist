import assert from 'node:assert/strict';
import test from 'node:test';
import { PricingCalculatorUtils } from '../src/lib/pricingCalculator';
import { MARKETPLACE_FEES } from '../src/lib/marketplaceFees';

for (const cost of [1, 10, 35, 50.97, 79, 150, 400]) {
  for (const target of [0, 25, 50]) {
    test(`ROI ${target}% cobre custos e usa a faixa correta para custo ${cost}`, () => {
      const results = PricingCalculatorUtils.calculateMarketplacePrices({ pricePerMeter: cost, metersUsed: 1, extraCosts: 2, taxesPercentage: 4, laborPercentage: 25, profitPercentage: 10 }, target);
      for (const result of results) {
        const range = MARKETPLACE_FEES[result.marketplaceId].ranges.find(range => result.recommendedPrice >= range.minPrice && (range.maxPrice === null || result.recommendedPrice <= range.maxPrice));
        assert.ok(range);
        const fees = result.recommendedPrice * (range.percentage + (range.proportionalFixedFee ?? 0)) + range.fixedFee;
        const profit = result.recommendedPrice * 0.71 - result.totalCost - fees;
        assert.ok(profit + 0.001 >= result.totalCost * target / 100);
        assert.ok(Math.abs(profit - result.estimatedProfit) < 0.000001);
      }
    });
  }
}
test('rejeita metas inválidas', () => {
  for (const target of [-1, NaN, Infinity]) {
    assert.throws(() => PricingCalculatorUtils.calculateMarketplacePrices({pricePerMeter: 10, metersUsed: 1, extraCosts: 0, taxesPercentage: 4, laborPercentage: 25, profitPercentage: 10}, target));
  }
});
