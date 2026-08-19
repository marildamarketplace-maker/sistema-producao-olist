export type MarketplaceId = "shopee" | "mercadoLivre" | "tiktokShop";

export type FeeRange = {
  minPrice: number;
  maxPrice: number | null;
  percentage: number;
  fixedFee: number;
  proportionalFixedFee?: number;
};

export type MarketplaceFeeConfig = {
  id: MarketplaceId;
  name: string;
  ranges: readonly FeeRange[];
};

const NO_MAXIMUM = null;

export const MARKETPLACE_FEES: Record<MarketplaceId, MarketplaceFeeConfig> = {
  shopee: {
    id: "shopee",
    name: "Shopee",
    ranges: [
      { minPrice: 0, maxPrice: 79.99, percentage: 0.2, fixedFee: 4 },
      { minPrice: 80, maxPrice: 99.99, percentage: 0.14, fixedFee: 16 },
      { minPrice: 100, maxPrice: 199.99, percentage: 0.14, fixedFee: 20 },
      { minPrice: 200, maxPrice: 499.99, percentage: 0.14, fixedFee: 26 },
      { minPrice: 500, maxPrice: NO_MAXIMUM, percentage: 0.14, fixedFee: 26 },
    ],
  },
  mercadoLivre: {
    id: "mercadoLivre",
    name: "Mercado Livre Premium",
    ranges: [
      {
        minPrice: 0,
        maxPrice: 12.49,
        percentage: 0.19,
        fixedFee: 0,
        proportionalFixedFee: 0.5,
      },
      { minPrice: 12.5, maxPrice: 28.99, percentage: 0.19, fixedFee: 6.25 },
      { minPrice: 29, maxPrice: 49.99, percentage: 0.19, fixedFee: 6.5 },
      { minPrice: 50, maxPrice: 78.99, percentage: 0.19, fixedFee: 6.75 },
      { minPrice: 79, maxPrice: NO_MAXIMUM, percentage: 0.19, fixedFee: 0 },
    ],
  },
  tiktokShop: {
    id: "tiktokShop",
    name: "TikTok Shop",
    ranges: [
      { minPrice: 0, maxPrice: 49.99, percentage: 0.1, fixedFee: 4 },
      { minPrice: 50, maxPrice: NO_MAXIMUM, percentage: 0.06, fixedFee: 6 },
    ],
  },
};

export const DEFAULT_PERCENTAGES = {
  taxes: 4,
  labor: 25,
  profit: 10,
} as const;
