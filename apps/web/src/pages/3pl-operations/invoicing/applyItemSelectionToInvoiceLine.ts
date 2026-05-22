// PR-D / BNEW-3-INV (refined by PR-F): helper for pre-filling the
// invoice line-add form when the operator picks an item from
// ItemPicker. Extracted as a pure function so the vitest unit test can
// pin the contract without rendering the page, mirroring the precedent
// set by PR-C (`applyItemSelection.ts` in the quotes folder).
//
// History: PR-D originally closed an async-stale race with a
// `useEffect` watching a `useItem(id)` result. PR-F removes the effect
// entirely — ItemPicker emits the matched Item from its loaded list at
// selection time and InvoiceDetailPage calls this helper synchronously
// from the picker's onChange. No more visible flash, no more
// rules-of-hooks gymnastics.
//
// The shape of this helper is unchanged — it accepts an Item and
// returns the populated field bundle, so the unit-test contract is
// preserved across both call patterns.
//
// The invoice line shape differs from the quote line shape: invoices
// use `description` (not `name`) and do not snapshot a sku on the
// line, so a dedicated helper is clearer than overloading the quote
// helper.

import type { Item } from '@/lib/types/sales';

export interface InvoiceLineSelectionFields {
  description: string;
  unit_price_cents: string;
}

/**
 * Given an Item (resolved synchronously from the ItemPicker dropdown
 * list as of PR-F), return the values that should populate the invoice
 * line-add form fields. Returns null when no item is provided so the
 * caller can leave the form alone (e.g. on clear).
 */
export function applyItemSelectionToInvoiceLine(
  item: Item | null | undefined,
): InvoiceLineSelectionFields | null {
  if (!item) return null;
  return {
    description: item.name,
    unit_price_cents: String(item.unit_price_cents),
  };
}
