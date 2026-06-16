// R-W13-UX-02: pure helpers for staging quote line drafts on the create
// screen. The quotes-api create handler (POST /quotes) accepts the header
// shape only; lines are added one POST at a time over the existing
// /quotes/:id/line-items endpoint. So the create page holds an in-memory
// array of drafts and, after the header POST succeeds, replays each draft
// through addLineItem in a single submit flow (one user action).
//
// Split out as a pure module (no React, no query hooks, no supabase
// client in the graph) so the vitest suite can pin the contract the same
// way `lineDraft.ts`, `applyItemSelection.ts`, and `sourceLinePrefill.ts`
// already do. The repo has no jsdom / testing-library.

import type { CreateQuoteLineRequest } from '@/lib/types/sales';

/**
 * In-memory draft for a quote line on the create form. Mirrors the
 * QuoteDetailPage add-line field set (name, sku, item, qty_e3, price,
 * discount, tax, taxable). Integer storage units (qty_e3, cents, bps)
 * are held as numbers exactly like the detail-page state so the two
 * surfaces stay byte-for-byte consistent.
 */
export interface QuoteLineDraft {
  /** Stable client-side React key. Not sent to the server. */
  draftId: string;
  item_id: string | null;
  name: string;
  sku: string;
  /** Integer qty_e3 (x1000). 1000 = 1 unit. */
  quantity_e3: number | null;
  /** Whole cents. */
  unit_price_cents: number | null;
  /** Basis points (1% = 100). */
  discount_bps: number | null;
  tax_id: string;
  is_taxable: boolean;
}

let fallbackCounter = 0;

/**
 * Stable-ish draft id. `crypto.randomUUID` is the constitutional choice
 * (the `uuid` package is banned). Falls back to a counter when the
 * runtime lacks it.
 */
export function nextQuoteDraftId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  fallbackCounter += 1;
  return `quote-line-draft-${fallbackCounter}`;
}

export function makeEmptyQuoteLineDraft(): QuoteLineDraft {
  return {
    draftId: nextQuoteDraftId(),
    item_id: null,
    name: '',
    sku: '',
    quantity_e3: 1000,
    unit_price_cents: 0,
    discount_bps: 0,
    tax_id: '',
    is_taxable: true,
  };
}

/**
 * True when a draft carries the minimum a quote line needs: a non-blank
 * name. The Zod CreateQuoteLineRequest requires name.min(1); everything
 * else has a server default. Empty drafts are dropped before submit.
 */
export function isQuoteLineDraftFilled(draft: QuoteLineDraft): boolean {
  return draft.name.trim().length > 0;
}

/**
 * Convert one draft into the POST body addLineItem expects. position is
 * passed by the caller so entry order is preserved across the batch.
 * Pure; testable without a React renderer.
 */
export function quoteDraftToLineRequest(
  draft: QuoteLineDraft,
  position: number,
): CreateQuoteLineRequest {
  return {
    position,
    name: draft.name,
    sku: draft.sku ? draft.sku : null,
    item_id: draft.item_id,
    kind: 'item',
    quantity_e3: draft.quantity_e3 ?? 0,
    unit_price_cents: draft.unit_price_cents ?? 0,
    discount_bps: draft.discount_bps ?? 0,
    tax_id: draft.tax_id ? draft.tax_id : null,
    is_taxable: draft.is_taxable,
  };
}

/**
 * Convert the filled drafts (skipping blank rows) into ordered POST
 * bodies. position starts at 0 and increments per emitted line so the
 * server-side ordering matches the operator's entry order.
 */
export function quoteDraftsToLineRequests(
  drafts: QuoteLineDraft[],
): CreateQuoteLineRequest[] {
  return drafts
    .filter(isQuoteLineDraftFilled)
    .map((draft, index) => quoteDraftToLineRequest(draft, index));
}
