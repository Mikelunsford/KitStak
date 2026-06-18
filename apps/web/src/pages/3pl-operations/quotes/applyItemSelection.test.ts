// PR-C / BNEW-3: regression tests for the item-pick prefill helper.
// Pins the contract that selecting an item in the quote line-add form
// populates Name, SKU, and Unit price from the catalog. See
// `Kitstak_E2E_Smoke_v2_Results_2026-05-22.md` § BNEW-3.

import { describe, it, expect } from 'vitest';

import type { Item } from '@/lib/types/sales';
import { applyItemSelection } from './applyItemSelection';

const SAMPLE_ITEM: Item = {
  id: '00000000-0000-0000-0000-000000000001',
  org_id: '00000000-0000-0000-0000-0000000000aa',
  sku: 'SV2-RM',
  name: 'Smoke V2 Raw Material',
  description: null,
  category_id: null,
  unit_id: null,
  kind: 'product',
  unit_price_cents: 1234,
  unit_cost_cents: null,
  cost_cents: null,
  currency_code: 'USD',
  default_tax_id: null,
  unit_of_measure: null,
  reorder_point: null,
  barcode: null,
  supply_source: 'in_house',
  is_active: true,
  is_taxable: true,
  is_sellable: true,
  is_purchasable: false,
  metadata: {},
};

describe('applyItemSelection', () => {
  it('returns name, sku, and stringified unit_price_cents from the item', () => {
    expect(applyItemSelection(SAMPLE_ITEM)).toEqual({
      name: 'Smoke V2 Raw Material',
      sku: 'SV2-RM',
      unit_price_cents: '1234',
    });
  });

  it('stringifies a zero price without dropping the digit', () => {
    expect(applyItemSelection({ ...SAMPLE_ITEM, unit_price_cents: 0 })).toEqual({
      name: 'Smoke V2 Raw Material',
      sku: 'SV2-RM',
      unit_price_cents: '0',
    });
  });

  it('returns null when no item is provided (clear)', () => {
    expect(applyItemSelection(null)).toBeNull();
  });

  it('returns null when item is undefined (query pending)', () => {
    expect(applyItemSelection(undefined)).toBeNull();
  });
});
