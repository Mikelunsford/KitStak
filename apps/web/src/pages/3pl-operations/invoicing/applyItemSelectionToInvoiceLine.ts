// PR-D / BNEW-3-INV: helper for pre-filling the invoice line-add form when
// the operator picks an item from ItemPicker. Extracted as a pure function
// so the vitest unit test can pin the contract without rendering the page,
// mirroring the precedent set by PR-C (`applyItemSelection.ts` in the
// quotes folder, commit 5285534).
//
// The bug this closes: `InvoiceDetailPage.onPickItem` read
// `selectedItem.data` from `useItem(selectedItemId)` *synchronously* after
// calling `setSelectedItemId(itemId)`. On the first pick the react-query
// hook has not yet resolved, so `selectedItem.data` is undefined and the
// description / unit price fields stay empty. On subsequent picks the
// stale data pointed at the previously picked item. Either way the picker
// label "PRE-FILLS DESCRIPTION AND PRICE" lied.
//
// The fix moves the prefill into a `useEffect` watching the resolved item;
// the actual field-population shape lives here.
//
// The invoice line shape differs from the quote line shape: invoices use
// `description` (not `name`) and do not snapshot a sku on the line, so a
// dedicated helper is clearer than overloading the quote helper.

import type { Item } from '@/lib/types/sales';

export interface InvoiceLineSelectionFields {
  description: string;
  unit_price_cents: string;
}

/**
 * Given a fetched Item, return the values that should populate the invoice
 * line-add form fields. Returns null when no item is provided so the caller
 * can leave the form alone (e.g. on clear or while the query is pending).
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
