export const pricingTiersKeys = {
  all: ['sales', 'pricing_tiers'] as const,
  list: () => ['sales', 'pricing_tiers', 'list'] as const,
};
