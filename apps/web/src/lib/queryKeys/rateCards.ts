export const rateCardsKeys = {
  all: ['estimate', 'rate_cards'] as const,
  list: () => ['estimate', 'rate_cards', 'list'] as const,
  byId: (id: string) => ['estimate', 'rate_cards', 'byId', id] as const,
  active: () => ['estimate', 'rate_cards', 'active'] as const,
};
