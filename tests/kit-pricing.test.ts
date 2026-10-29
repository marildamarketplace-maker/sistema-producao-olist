import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateKitPrices, EMPTY_KIT_OPTIONS } from '../src/lib/kitPricing';
import { PricingCalculatorUtils } from '../src/lib/pricingCalculator';
import { SalesChannelId } from '../src/lib/marketplaceFees';

const input = { pricePerMeter: 10, metersUsed: 1, extraCosts: 3, taxesPercentage: 4, laborPercentage: 15, profitPercentage: 15 };

for (const channel of ['shopee', 'mercadoLivre', 'tiktokShop', 'dominioProprio'] as SalesChannelId[]) {
  test(`${channel}: kits preservam margem após todos os custos e cobram extras uma vez`, () => {
    const kits = calculateKitPrices(input, channel, { shipping: 8, advertisingPercentage: 10, affiliatePercentage: 10, shippingPercentage: 6 });
    assert.deepEqual(kits.map(kit => kit.quantity), [2, 3, 5]);
    for (const kit of kits) {
      assert.equal(kit.materialCost, 10 * kit.quantity);
      assert.equal(kit.extraCosts, 3);
      const remaining = kit.recommendedPrice - kit.materialCost - kit.extraCosts - kit.shipping - kit.marketplaceCost - kit.shippingService - kit.affiliates - kit.advertising - kit.taxes - kit.labor;
      assert.ok(Math.abs(remaining - kit.estimatedProfit) < 1e-10);
      assert.ok(remaining + 0.001 >= kit.recommendedPrice * 0.15);
      if (channel === 'dominioProprio') {
        assert.equal(kit.marketplaceCost + kit.shipping + kit.shippingService + kit.affiliates + kit.advertising, 0);
      }
      if (channel !== 'tiktokShop') assert.equal(kit.affiliates + kit.shippingService, 0);
    }
  });
  test(`${channel}: aplica redução na meta de lucro por peça da venda avulsa`, () => {
    for (const kit of calculateKitPrices(input, channel, EMPTY_KIT_OPTIONS)) {
      const base = PricingCalculatorUtils.calculateMarketplacePrices({ ...input, metersUsed: input.metersUsed }, true).find(price => price.marketplaceId === channel)!;
      assert.ok(kit.estimatedProfit + 0.001 >= base.estimatedProfit * kit.quantity * (1 - kit.profitReductionPercentage / 100));
      assert.equal(kit.targetProfitPerUnit, base.estimatedProfit * (1 - kit.profitReductionPercentage / 100));
      assert.ok(kit.profitPerUnit + 0.001 >= kit.targetProfitPerUnit);
    }
  });
}

test('TikTok recalcula faixa do kit ao ultrapassar R$ 50', () => {
  const kits = calculateKitPrices({ ...input, taxesPercentage: 0, laborPercentage: 0, profitPercentage: 10, extraCosts: 0 }, 'tiktokShop', EMPTY_KIT_OPTIONS);
  assert.equal(kits[0].percentageFee, 10);
  assert.equal(kits[0].fixedFee, 4);
  assert.equal(kits[2].percentageFee, 6);
  assert.equal(kits[2].fixedFee, 6);
});

test('rejeita entradas inválidas e percentuais inviáveis', () => {
  for (const invalid of [-1, NaN, Infinity]) {
    assert.throws(() => calculateKitPrices(input, 'shopee', { ...EMPTY_KIT_OPTIONS, shipping: invalid }));
    assert.throws(() => calculateKitPrices({ ...input, metersUsed: invalid }, 'shopee', EMPTY_KIT_OPTIONS));
  }
  assert.throws(() => calculateKitPrices(input, 'tiktokShop', { ...EMPTY_KIT_OPTIONS, advertisingPercentage: 100 }));
});


test('regressão: material de R$ 3,75 preserva lucro avulso nos kits do domínio próprio', () => {
  const values = { ...input, pricePerMeter: 3.75, extraCosts: 0, laborPercentage: 25, profitPercentage: 15 };
  const unit = PricingCalculatorUtils.calculateMarketplacePrices(values, true).find(p => p.marketplaceId === 'dominioProprio')!;
  assert.equal(unit.recommendedPrice, 10.9);
  const kits = calculateKitPrices(values, 'dominioProprio', EMPTY_KIT_OPTIONS);
  assert.deepEqual(kits.map(k => k.profitReductionPercentage), [14, 21, 35]);
  assert.deepEqual(kits.map(k => k.recommendedPrice), [20.9, 30.9, 45.9]);
  for (const kit of kits) assert.ok(kit.estimatedProfit >= unit.estimatedProfit * kit.quantity * (1 - kit.profitReductionPercentage / 100) - 0.001);
});


test('Premium: simula reduções de 14%, 21% e 35% no exemplo de material de R$ 3,75', () => {
  const kits = calculateKitPrices({ pricePerMeter: 3.75, metersUsed: 1, extraCosts: 0, taxesPercentage: 4, laborPercentage: 25, profitPercentage: 10 }, 'mercadoLivre', EMPTY_KIT_OPTIONS);
  assert.deepEqual(kits.map(k => k.recommendedPrice), [40.9, 50.9, 70.9]);
  assert.deepEqual(kits.map(k => Number(k.estimatedProfit.toFixed(2))), [7.27, 8.47, 11.37]);
});
