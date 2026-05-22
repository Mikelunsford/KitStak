// PR-C / BNEW-3 (refined by PR-F): helper for pre-filling the quote
// line-add form when the operator picks an item from ItemPicker.
// Extracted as a pure function so the vitest unit test can pin the
// contract without rendering the page.
//
// History: PR-C originally closed an async-stale race with a
// `useEffect` watching a `useItem(id)` result. That fixed the empty-
// fields bug from `Kitstak_E2E_Smoke_v2_Results_2026-05-22.md` § BNEW-3
// but introduced a visible flash (id landed one render before fields).
// PR-F removes the effect entirely: ItemPicker now emits the matched
// Item from its loaded list at selection time, and QuoteDetailPage
// calls this helper *synchronously* from the picker's onChange.
//
// The shape of this helper has not changed — it accepts an Item and
// returns the populated field bundle, so the unit-test contract is
// preserved across both call patterns.

import type { Item } from '@/lib/types/sales';

export interface ItemSelectionFields {
  name: string;
  sku: string;
  unit_price_cents: string;
}

/**
 * Given an Item (resolved synchronously from the ItemPicker dropdown
 * list as of PR-F), return the values that should populate the quote
 * line-add form fields. Returns null when no item is provided so the
 * caller can leave the form alone (e.g. on clear).
 */
export function applyItemSelection(item: Item | null | undefined): ItemSelectionFields | null {
  if (!item) return null;
  return {
    name: item.name,
    sku: item.sku,
    unit_price_cents: String(item.unit_price_cents),
  };
}
