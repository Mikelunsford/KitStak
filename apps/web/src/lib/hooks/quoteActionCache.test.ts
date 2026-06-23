// P0-1 regression: quote state actions (submit/approve/revise/cancel/send) must
// reflect the new state on the detail page with no reload. The fix writes the
// authoritative returned Quote into the byId detail cache synchronously and does
// NOT invalidate that detail key (an invalidation refetch can lag the write and,
// with staleTime 30s plus refetchOnWindowFocus false, strand the operator on the
// pre-transition state until reload).
//
// Imports the helper directly, not the useQuotes hook surface, so the test does
// not transitively load apiClient -> supabase (which throws at import time when
// VITE_ env vars are absent). Mirrors transitionInvalidation.test.ts.

import { QueryClient } from '@tanstack/react-query';
import { describe, it, expect, vi } from 'vitest';

import {
  applyQuoteActionResult,
  mergeQuoteIntoDetail,
  type QuoteDetailCache,
} from './quoteActionCache';
import { auditLogKeys } from '@/lib/queryKeys/auditLog';
import { quotesKeys } from '@/lib/queryKeys/quotes';
import type { Quote, QuoteLineItem } from '@/lib/types/sales';

const QUOTE_ID = '00000000-0000-4000-8000-000000000001';

// Minimal fixtures. setQueryData/getQueryData do not validate their payload, so
// a narrowed partial is enough to assert the state-carry contract.
function quoteAt(state: string): Quote {
  return { id: QUOTE_ID, state } as unknown as Quote;
}

const LINE = { id: 'line-1' } as unknown as QuoteLineItem;

function draftDetail(): QuoteDetailCache {
  return { quote: quoteAt('draft'), lineItems: [LINE] };
}

describe('mergeQuoteIntoDetail', () => {
  it('replaces the quote and preserves the line items', () => {
    const next = mergeQuoteIntoDetail(draftDetail(), quoteAt('approved'));
    expect(next?.quote.state).toBe('approved');
    expect(next?.lineItems).toEqual([LINE]);
  });

  it('returns undefined when the detail was never loaded (no partial seed)', () => {
    expect(mergeQuoteIntoDetail(undefined, quoteAt('approved'))).toBeUndefined();
  });
});

describe('applyQuoteActionResult', () => {
  it('holds the new state in the byId cache immediately, with no refetch', () => {
    const qc = new QueryClient();
    qc.setQueryData<QuoteDetailCache>(quotesKeys.byId(QUOTE_ID), draftDetail());

    applyQuoteActionResult(qc, QUOTE_ID, quoteAt('approved'));

    const cached = qc.getQueryData<QuoteDetailCache>(quotesKeys.byId(QUOTE_ID));
    expect(cached?.quote.state).toBe('approved');
    // Line items survive the merge untouched.
    expect(cached?.lineItems).toEqual([LINE]);
  });

  it('does NOT invalidate the detail key, so a lagged refetch cannot clobber the fresh state', () => {
    const qc = new QueryClient();
    qc.setQueryData<QuoteDetailCache>(quotesKeys.byId(QUOTE_ID), draftDetail());
    const spy = vi.spyOn(qc, 'invalidateQueries').mockResolvedValue();

    applyQuoteActionResult(qc, QUOTE_ID, quoteAt('approved'));

    const invalidatedKeys = spy.mock.calls.map((call) => call[0]?.queryKey);
    // The list and the audit timeline are swept...
    expect(invalidatedKeys).toContainEqual(quotesKeys.all);
    expect(invalidatedKeys).toContainEqual(
      auditLogKeys.byEntity('quote', QUOTE_ID),
    );
    // ...but the detail key is not, which is the crux of P0-1.
    expect(invalidatedKeys).not.toContainEqual(quotesKeys.byId(QUOTE_ID));
  });
});
