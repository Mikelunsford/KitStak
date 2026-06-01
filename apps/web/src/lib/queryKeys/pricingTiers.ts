export const pricingTiersKeys = {
  all: ['sales', 'pricing_tiers'] as const,
  list: () => ['sales', 'pricing_tiers', 'list'] as const,
  byId: (id: string) => ['sales', 'pricing_tiers', 'byId', id] as const,
};
