// PR-D / BNEW-3-INV: regression tests for the invoice line-add prefill
// helper. Pins the contract that selecting an item in the invoice line-add
// form populates Description and Unit price from the catalog. Mirrors the
// quote-side `applyItemSelection.test.ts` shape (PR-C, commit 5285534).

import { describe, it, expect } from 'vitest';

import type { Item } from '@/lib/types/sales';
import { applyItemSelectionToInvoiceLine } from './applyItemSelectionToInvoiceLine';

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
  currency_code: 'USD',
  default_tax_id: null,
  is_active: true,
  is_taxable: true,
  is_sellable: true,
  is_purchasable: false,
  metadata: {},
};

describe('applyItemSelectionToInvoiceLine', () => {
  it('returns description (from item.name) and stringified unit_price_cents', () => {
    expect(applyItemSelectionToInvoiceLine(SAMPLE_ITEM)).toEqual({
      description: 'Smoke V2 Raw Material',
      unit_price_cents: '1234',
    });
  });

  it('stringifies a zero price without dropping the digit', () => {
    expect(
      applyItemSelectionToInvoiceLine({ ...SAMPLE_ITEM, unit_price_cents: 0 }),
    ).toEqual({
      description: 'Smoke V2 Raw Material',
      unit_price_cents: '0',
    });
  });

  it('returns null when no item is provided (clear)', () => {
    expect(applyItemSelectionToInvoiceLine(null)).toBeNull();
  });

  it('returns null when item is undefined (query pending)', () => {
    expect(applyItemSelectionToInvoiceLine(undefined)).toBeNull();
  });
});
