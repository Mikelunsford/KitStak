// PR-C / BNEW-3: helper for pre-filling the quote line-add form when the
// operator picks an item from ItemPicker. Extracted as a pure function so
// the vitest unit test can pin the contract without rendering the page.
//
// The bug this closes: the original `onPickItem` handler read
// `selectedItem.data` from `useItem(selectedItemId)` *synchronously* after
// calling `setSelectedItemId(itemId)`. On the first pick, the query is in
// flight, so `selectedItem.data` is undefined and the name/sku/price fields
// stay empty. The form then validates Name as required and the operator has
// to retype it. See `Kitstak_E2E_Smoke_v2_Results_2026-05-22.md` § BNEW-3.
//
// The fix moves the prefill into a `useEffect` watching the resolved item,
// and the actual field-population logic lives here as a pure function.

import type { Item } from '@/lib/types/sales';

export interface ItemSelectionFields {
  name: string;
  sku: string;
  unit_price_cents: string;
}

/**
 * Given a fetched Item, return the values that should populate the quote
 * line-add form fields. Returns null when no item is provided so the caller
 * can decide to leave the form alone (e.g. on clear or while the query is
 * pending).
 */
export function applyItemSelection(item: Item | null | undefined): ItemSelectionFields | null {
  if (!item) return null;
  return {
    name: item.name,
    sku: item.sku,
    unit_price_cents: String(item.unit_price_cents),
  };
}
