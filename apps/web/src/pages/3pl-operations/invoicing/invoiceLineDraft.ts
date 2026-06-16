// R-W13-UX-02: pure helpers for staging operator-entered invoice line
// drafts on the create screen. The invoicing-api create handler
// (POST /invoices) accepts the header shape only; lines are added one
// POST at a time over /invoices/:id/line-items (createInvoiceLineItem).
// So the create page holds an in-memory array of drafts and, after the
// header POST succeeds, replays each draft through createInvoiceLineItem
// in a single submit flow (one user action). This sits alongside the
// existing B1 source-document prefill (shipment / project lines): when
// the operator deep-links from a source the derived lines POST first,
// then any manually entered drafts.
//
// Split out as a pure module (no React, no query hooks, no supabase
// client in the graph) so the vitest suite can pin the contract, the
// same pattern as `sourceLinePrefill.ts` and `lineDraft.ts`.

import { roundHalfEven } from '@/lib/money';
import type { InvoiceLineCreate } from '@/lib/services/invoiceLineItemsService';

/**
 * In-memory draft for an invoice line on the create form. Mirrors the
 * InvoiceDetailPage add-line field set (description, qty, unit price
 * cents, optional item). Quantity and unit price are held as strings so
 * the inputs stay fully controlled, exactly like the detail page state.
 */
export interface InvoiceLineDraft {
  /** Stable client-side React key. Not sent to the server. */
  draftId: string;
  item_id: string | null;
  description: string;
  /** Decimal quantity as a string ("1", "2.5"). */
  quantity: string;
  /** Whole cents as a string. */
  unit_price_cents: string;
}

let fallbackCounter = 0;

/**
 * Stable-ish draft id. `crypto.randomUUID` is the constitutional choice
 * (the `uuid` package is banned). Falls back to a counter when the
 * runtime lacks it.
 */
export function nextInvoiceDraftId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  fallbackCounter += 1;
  return `invoice-line-draft-${fallbackCounter}`;
}

export function makeEmptyInvoiceLineDraft(): InvoiceLineDraft {
  return {
    draftId: nextInvoiceDraftId(),
    item_id: null,
    description: '',
    quantity: '1',
    unit_price_cents: '0',
  };
}

/**
 * True when a draft carries the minimum an invoice line needs: a
 * non-blank description. InvoiceLineCreate requires description and
 * line_total_cents; everything else is optional. Empty drafts are
 * dropped before submit.
 */
export function isInvoiceLineDraftFilled(draft: InvoiceLineDraft): boolean {
  return draft.description.trim().length > 0;
}

/**
 * Convert one draft into the POST body createInvoiceLineItem expects.
 * line_total_cents is a display convenience computed with banker's
 * rounding (money rule); the invoicing handler server-recomputes the
 * persisted value, so this mirrors the detail-page onAddLine math.
 * sort_order is passed by the caller so entry order is preserved.
 */
export function invoiceDraftToLineCreate(
  draft: InvoiceLineDraft,
  sortOrder: number,
): InvoiceLineCreate {
  const qtyNum = Number(draft.quantity);
  const priceNum = Number(draft.unit_price_cents);
  const lineTotal = roundHalfEven(qtyNum * priceNum);
  const body: InvoiceLineCreate = {
    description: draft.description,
    quantity: draft.quantity,
    unit_price_cents: draft.unit_price_cents,
    line_total_cents: String(lineTotal),
    sort_order: sortOrder,
  };
  if (draft.item_id) {
    body.item_id = draft.item_id;
  }
  return body;
}

/**
 * Convert the filled drafts (skipping blank rows) into ordered POST
 * bodies. sort_order starts at the supplied base (so manual lines land
 * after any source-derived lines already queued) and increments per
 * emitted line.
 */
export function invoiceDraftsToLineCreates(
  drafts: InvoiceLineDraft[],
  baseSortOrder = 0,
): InvoiceLineCreate[] {
  return drafts
    .filter(isInvoiceLineDraftFilled)
    .map((draft, index) =>
      invoiceDraftToLineCreate(draft, baseSortOrder + index),
    );
}
