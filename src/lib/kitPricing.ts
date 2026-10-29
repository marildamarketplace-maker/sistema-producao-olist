import { MARKETPLACE_FEES, OWN_DOMAIN_FEES, SalesChannelId } from './marketplaceFees';
import { PricingCalculatorUtils, PricingInput } from './pricingCalculator';

export type KitOptions = {
  shipping: number;
  advertisingPercentage: number;
  affiliatePercentage: number;
  shippingPercentage: number;
};

export const EMPTY_KIT_OPTIONS: KitOptions = {
  shipping: 0, advertisingPercentage: 0, affiliatePercentage: 0, shippingPercentage: 0,
};

export function calculateKitPrices(input: PricingInput, channelId: SalesChannelId, options: KitOptions) {
  if (Object.values(input).some(value => !Number.isFinite(value) || value < 0)
    || Object.values(options).some(value => !Number.isFinite(value) || value < 0)
    || input.pricePerMeter <= 0 || input.metersUsed <= 0) {
    throw new Error('Informe custos e percentuais válidos.');
  }
  const ownDomain = channelId === 'dominioProprio';
  const config = ownDomain ? OWN_DOMAIN_FEES : MARKETPLACE_FEES[channelId];
  const advertisingRate = ownDomain ? 0 : options.advertisingPercentage / 100;
  const affiliateRate = channelId === 'tiktokShop' ? options.affiliatePercentage / 100 : 0;
  const shippingRate = channelId === 'tiktokShop' ? options.shippingPercentage / 100 : 0;
  const shipping = ownDomain ? 0 : options.shipping;
  const extraRate = advertisingRate + affiliateRate + shippingRate;
  const effectiveConfig = {
    ...config,
    ranges: config.ranges.map(range => ({ ...range, percentage: range.percentage + extraRate })),
  };
  return [2, 3, 5].map(quantity => {
    const [result] = PricingCalculatorUtils.calculateChannelPrices({
      ...input,
      metersUsed: input.metersUsed * quantity,
      // Embalagem e extras são por kit; frete também é cobrado uma vez.
      extraCosts: input.extraCosts + shipping,
    }, [effectiveConfig]);
    const advertising = result.recommendedPrice * advertisingRate;
    const affiliates = result.recommendedPrice * affiliateRate;
    const shippingService = result.recommendedPrice * shippingRate;
    return {
      ...result,
      quantity,
      extraCosts: input.extraCosts,
      percentageFee: result.percentageFee - extraRate * 100,
      marketplaceCost: result.marketplaceCost - advertising - affiliates - shippingService,
      shipping, advertising, affiliates, shippingService,
      unitPrice: result.recommendedPrice / quantity,
    };
  });
}
export type KitPricing = ReturnType<typeof calculateKitPrices>[number];
