// design-sync stub for @/lib/hooks/useDefaultCurrency.
// The real hook reads org settings via useAuth/useSettings (needs AuthProvider,
// absent in previews). Return a sane default so CurrencyField renders.
export function useDefaultCurrency(): string {
  return 'USD';
}
