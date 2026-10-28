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

test('domínio próprio considera material, extras, impostos, trabalho e lucro sem taxas', () => {
  const input = { pricePerMeter: 20, metersUsed: 2, extraCosts: 10, taxesPercentage: 4, laborPercentage: 25, profitPercentage: 10 };
  const marketplaces = PricingCalculatorUtils.calculateMarketplacePrices(input);
  const channels = PricingCalculatorUtils.calculateMarketplacePrices(input, true);
  assert.equal(marketplaces.length, 3);
  assert.deepEqual(channels.slice(0, 3), marketplaces);
  const ownDomain = channels.find(channel => channel.marketplaceId === 'dominioProprio');
  assert.ok(ownDomain);
  assert.equal(ownDomain.marketplaceName, 'Domínio Próprio');
  assert.equal(ownDomain.materialCost, 40);
  assert.equal(ownDomain.extraCosts, 10);
  assert.equal(ownDomain.marketplaceCost, 0);
  assert.equal(ownDomain.percentageFee, 0);
  assert.equal(ownDomain.fixedFee, 0);
  assert.ok(Math.abs(ownDomain.minimumPrice - 50 / 0.61) < 1e-10);
  assert.equal(ownDomain.recommendedPrice, 85.9);
  assert.equal(ownDomain.taxes, ownDomain.recommendedPrice * 0.04);
  assert.equal(ownDomain.labor, ownDomain.recommendedPrice * 0.25);
  assert.equal(ownDomain.estimatedProfit, ownDomain.recommendedPrice - 50 - ownDomain.taxes - ownDomain.labor);
  assert.ok(ownDomain.netMargin >= 10);
});
