export const currenciesKeys = {
  all: ['sales', 'currencies'] as const,
  list: () => ['sales', 'currencies', 'list'] as const,
};
