// design-sync stub for @/lib/hooks/useCurrencies.
// The real hook fetches via TanStack Query + apiClient (no backend in previews).
// Return a small realistic currency list so CurrencyField shows real options.
export function useCurrenciesList(): { data: Array<{ code: string }> } {
  return { data: [{ code: 'USD' }, { code: 'EUR' }, { code: 'GBP' }, { code: 'CAD' }, { code: 'AUD' }] };
}
