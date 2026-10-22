import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateAdvertisingScenarios } from '../src/lib/advertisingReturn';
import { PricingCalculatorUtils } from '../src/lib/pricingCalculator';

test('calcula retorno publicitário em múltiplos sobre receita, não ROI sobre produto', () => {
  const scenarios = calculateAdvertisingScenarios({ recommendedPrice: 100, estimatedProfit: 20 });
  assert.ok(scenarios);
  assert.deepEqual(scenarios.map(s => s.returnMultiple), [5, 6.67, 10]);
  assert.equal(scenarios[0].adCost, 20);
  assert.equal(scenarios[0].profitAfterAds, 0);
  assert.ok(scenarios[1].profitAfterAds >= 5);
  assert.equal(scenarios[2].profitAfterAds, 10);
});

test('não recomenda anúncios sem contribuição positiva ou com valores inválidos', () => {
  for (const [recommendedPrice, estimatedProfit] of [[100, 0], [100, -5], [0, 1], [NaN, 20], [100, Infinity], [100, 101]]) {
    assert.equal(calculateAdvertisingScenarios({ recommendedPrice, estimatedProfit }), null);
  }
});

for (const cost of [1, 10, 35, 50.97, 79, 150, 400]) {
  test(`cenários cobrem custos e preservam lucro em todos marketplaces para custo ${cost}`, () => {
    const prices = PricingCalculatorUtils.calculateMarketplacePrices({ pricePerMeter: cost, metersUsed: 1, extraCosts: 2, taxesPercentage: 4, laborPercentage: 25, profitPercentage: 10 });
    for (const price of prices) {
      const scenarios = calculateAdvertisingScenarios(price);
      assert.ok(scenarios);
      for (const scenario of scenarios) {
        const profit = price.recommendedPrice - price.totalCost - price.marketplaceCost - price.taxes - price.labor - scenario.adCost;
        assert.ok(profit >= -1e-10);
        assert.ok(profit + 1e-10 >= price.estimatedProfit * scenario.retainedShare);
        assert.ok(Math.abs(price.recommendedPrice / scenario.adCost - scenario.returnMultiple) < 1e-10);
      }
      assert.ok(scenarios[0].returnMultiple < scenarios[1].returnMultiple);
      assert.ok(scenarios[1].returnMultiple < scenarios[2].returnMultiple);
    }
  });
}

test('arredonda retorno mínimo para cima mesmo com sobra fracionada', () => {
  const scenarios = calculateAdvertisingScenarios({recommendedPrice: 99.9, estimatedProfit: 13.123});
  assert.ok(scenarios);
  assert.equal(scenarios[0].returnMultiple, 7.62);
  assert.ok(scenarios[0].adCost <= 13.123);
});
