// P0-2: the quote detail header flashed the raw customer id (an 8-char UUID
// prefix) while the customer name was still loading. The header resolves the
// customer chip with fallbackLabel(name, id), which returns id.slice(0, 8) when
// the name is absent. useCustomer is a separate query that is not seeded on the
// create -> detail navigation, so the first render after create had no name and
// showed the id.
//
// This gates the loading window: while the name is in flight, return a neutral
// placeholder instead of the id. Once the query settles, defer to fallbackLabel,
// which yields the loaded name or, for a genuinely nameless / deleted / cross
// tenant customer, the id prefix that stays diagnosable.
//
// Pure and React free so the regression test exercises it without loading the
// QuoteDetailPage surface (which pulls the SPA supabase singleton at import
// time). Mirrors formatQuoteStateLabel.ts and applyItemSelection.ts.

import { fallbackLabel } from '@/components/shell/breadcrumbFallback';

export const CUSTOMER_LOADING_LABEL = 'Loading customer.';

export function resolveCustomerLabel(
  displayName: string | null | undefined,
  customerId: string | null | undefined,
  isLoading: boolean,
): string {
  if (isLoading && !(displayName && displayName.length > 0)) {
    return CUSTOMER_LOADING_LABEL;
  }
  return fallbackLabel(displayName, customerId);
}
