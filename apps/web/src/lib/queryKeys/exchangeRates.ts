export const exchangeRatesKeys = {
  all: ['sales', 'exchange_rates'] as const,
  list: () => ['sales', 'exchange_rates', 'list'] as const,
};
