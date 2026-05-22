// PR-F: regression tests for the ItemPicker's sync-callback contract.
//
// PR-C (quotes) and PR-D (invoices) introduced a `useItem(id)` +
// `useEffect` pattern to pre-fill dependent form fields when the
// operator picked an item from ItemPicker. That fixed the empty-fields
// bug (BNEW-3 / BNEW-3-INV) but caused a visible flash on every pick:
// the id landed one render before the resolved item, so name / sku /
// price were briefly blank.
//
// PR-F refactors ItemPicker to emit the matched Item alongside the id
// at selection time (the dropdown already has the loaded list in
// scope). The flash is gone because callers can populate dependent
// fields *synchronously* inside onChange.
//
// `pickItemFromList` is the pure resolution step extracted so this
// test can pin the contract without rendering the picker (the repo
// convention skips jsdom/RTL for picker-style components — see
// Breadcrumbs.test.ts header).

import { describe, it, expect } from 'vitest';

import type { Item } from '@/lib/types/sales';
import { pickItemFromList } from './pickItemFromList';

const ITEM_A: Item = {
  id: '00000000-0000-0000-0000-000000000aaa',
  org_id: '00000000-0000-0000-0000-0000000000aa',
  sku: 'PR-F-A',
  name: 'Sync Pick A',
  description: null,
  category_id: null,
  unit_id: null,
  kind: 'product',
  unit_price_cents: 4200,
  unit_cost_cents: null,
  currency_code: 'USD',
  default_tax_id: null,
  is_active: true,
  is_taxable: true,
  is_sellable: true,
  is_purchasable: false,
  metadata: {},
};

const ITEM_B: Item = {
  ...ITEM_A,
  id: '00000000-0000-0000-0000-000000000bbb',
  sku: 'PR-F-B',
  name: 'Sync Pick B',
  unit_price_cents: 9900,
};

const LIST: Item[] = [ITEM_A, ITEM_B];

describe('pickItemFromList', () => {
  it('returns the matching item with its id when the selected value is in the list', () => {
    expect(pickItemFromList(LIST, ITEM_B.id)).toEqual({
      id: ITEM_B.id,
      item: ITEM_B,
    });
  });

  it('emits null id and undefined item when the user clears the dropdown', () => {
    expect(pickItemFromList(LIST, '')).toEqual({
      id: null,
      item: undefined,
    });
  });

  it('emits the id with undefined item when no match exists (defensive)', () => {
    expect(pickItemFromList(LIST, 'not-in-list')).toEqual({
      id: 'not-in-list',
      item: undefined,
    });
  });

  it('returns null id when both the list and the value are empty', () => {
    expect(pickItemFromList([], '')).toEqual({ id: null, item: undefined });
  });

  it('preserves Item reference identity (callers may compare by ===)', () => {
    const result = pickItemFromList(LIST, ITEM_A.id);
    expect(result.item).toBe(ITEM_A);
  });
});
