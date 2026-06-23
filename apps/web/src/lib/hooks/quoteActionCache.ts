// P0-1: authoritative cache reconciliation for quote state actions
// (submit, approve, revise, cancel, send).
//
// The quotes-api transition route returns the post-transition Quote (parsed
// through QuoteSchema in quotesService.quoteAction). The hook used to throw
// that value away and rely on invalidating the byId detail query, which only
// schedules an async refetch. Under read-after-write timing that refetch can
// return the pre-transition row, and with TanStack staleTime 30s plus
// refetchOnWindowFocus false the stale row then sticks until a manual reload.
// That is the "stepper stays on Sent for approval after Approve" bug from the
// 2026-06-23 walkthrough. R-W13-UX-01 had already added the detail-key
// invalidation; invalidation alone is not enough, because you cannot fix a
// read-after-write race by scheduling another read.
//
// The fix writes the returned Quote into the detail cache synchronously and
// deliberately does NOT invalidate the byId detail key, so no lagged refetch
// can clobber the fresh state. The list (all) and the audit timeline are still
// invalidated; a slightly lagged list or timeline refetch self-heals and is
// not the surface showing the stale transition.
//
// Pulled into its own file (no apiClient or supabase import) so the regression
// test can exercise it without the SPA supabase singleton throwing at import
// time when VITE_ env vars are absent. Mirrors transitionInvalidation.ts and
// paymentInvalidation.ts.

import type { QueryClient } from '@tanstack/react-query';

import { auditLogKeys } from '@/lib/queryKeys/auditLog';
import { quotesKeys } from '@/lib/queryKeys/quotes';
import type { Quote, QuoteLineItem } from '@/lib/types/sales';

// The byId detail cache holds the GET envelope (quotesService.getQuote): the
// quote plus its line items. A state action changes only the quote row, never
// its line items.
export interface QuoteDetailCache {
  quote: Quote;
  lineItems: QuoteLineItem[];
}

// Pure merge. Replaces the quote in the detail envelope with the authoritative
// post-transition quote and leaves lineItems untouched. Returns prev unchanged
// (undefined) when the detail page was never loaded, so we never seed a partial
// envelope that is missing its line items.
export function mergeQuoteIntoDetail(
  prev: QuoteDetailCache | undefined,
  quote: Quote,
): QuoteDetailCache | undefined {
  return prev ? { ...prev, quote } : prev;
}

// Applies the authoritative action result to the query cache: writes the quote
// into the detail envelope synchronously, then invalidates the list and the
// audit timeline. Does not invalidate the detail key (see file header).
export function applyQuoteActionResult(
  qc: QueryClient,
  id: string,
  quote: Quote,
): void {
  qc.setQueryData<QuoteDetailCache>(quotesKeys.byId(id), (prev) =>
    mergeQuoteIntoDetail(prev, quote),
  );
  void qc.invalidateQueries({ queryKey: quotesKeys.all });
  void qc.invalidateQueries({ queryKey: auditLogKeys.byEntity('quote', id) });
}
