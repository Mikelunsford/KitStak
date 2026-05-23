// Regression suite for B1 (Wave B): line pre-fill helpers used by
// InvoiceCreatePage when the caller deep-links with ?shipment_id= or
// ?project_id=. Pure functions, no React.

import { describe, it, expect } from 'vitest';

import {
  shipmentLineToInvoiceLineCreate,
  projectLineToInvoiceLineCreate,
} from './sourceLinePrefill';

const ITEM_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ITEM_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const mkItem = (overrides: Record<string, unknown> = {}) => ({
  id: ITEM_A,
  org_id: 'org-1',
  sku: 'SKU-1',
  name: 'Widget',
  description: 'Steel widget',
  category_id: null,
  unit_id: null,
  kind: 'product' as const,
  unit_price_cents: 1500,
  unit_cost_cents: 800,
  currency_code: 'USD',
  default_tax_id: null,
  is_active: true,
  is_taxable: true,
  is_sellable: true,
  is_purchasable: true,
  metadata: {},
  ...overrides,
});

describe('shipmentLineToInvoiceLineCreate', () => {
  it('returns null when the item is missing from the loaded list', () => {
    const out = shipmentLineToInvoiceLineCreate(
      { item_id: ITEM_B, quantity: '3', position: 1 },
      [mkItem({ id: ITEM_A })],
    );
    expect(out).toBeNull();
  });

  it('returns null when the items list is undefined (still loading)', () => {
    const out = shipmentLineToInvoiceLineCreate(
      { item_id: ITEM_A, quantity: '3', position: 1 },
      undefined,
    );
    expect(out).toBeNull();
  });

  it('maps item.name to description and item.unit_price_cents to the line price', () => {
    const out = shipmentLineToInvoiceLineCreate(
      { item_id: ITEM_A, quantity: '4', position: 2 },
      [mkItem({ id: ITEM_A, name: 'Widget', unit_price_cents: 1500 })],
    );
    expect(out).toEqual({
      description: 'Widget',
      quantity: '4',
      unit_price_cents: '1500',
      line_total_cents: '6000',
      item_id: ITEM_A,
      sort_order: 2,
    });
  });

  it('uses item.unit_price_cents (sales price), not the shipment unit_cost_cents (COGS)', () => {
    // unit_cost_cents on a shipment line is the COGS snapshot for
    // inventory accounting, which is different from the price we want
    // to bill the customer. The helper must derive price from the
    // Item, not the shipment line.
    const out = shipmentLineToInvoiceLineCreate(
      { item_id: ITEM_A, quantity: '1', position: 1 },
      [mkItem({ unit_price_cents: 2500, unit_cost_cents: 800 })],
    );
    expect(out?.unit_price_cents).toBe('2500');
    expect(out?.line_total_cents).toBe('2500');
  });

  it('returns null when quantity is not numeric', () => {
    const out = shipmentLineToInvoiceLineCreate(
      { item_id: ITEM_A, quantity: 'oops', position: 1 },
      [mkItem()],
    );
    expect(out).toBeNull();
  });
});

describe('projectLineToInvoiceLineCreate', () => {
  it('uses description when present and falls back to name otherwise', () => {
    expect(
      projectLineToInvoiceLineCreate({
        item_id: ITEM_A,
        name: 'Setup fee',
        description: 'Onboarding & kit ramp',
        quantity: '1',
        unit_price_cents: 50000,
        position: 1,
      }).description,
    ).toBe('Onboarding & kit ramp');
    expect(
      projectLineToInvoiceLineCreate({
        item_id: ITEM_A,
        name: 'Setup fee',
        description: null,
        quantity: '1',
        unit_price_cents: 50000,
        position: 1,
      }).description,
    ).toBe('Setup fee');
  });

  it('preserves item_id when present and omits it when null', () => {
    const withItem = projectLineToInvoiceLineCreate({
      item_id: ITEM_A,
      name: 'X',
      description: null,
      quantity: '1',
      unit_price_cents: 100,
      position: 0,
    });
    expect(withItem.item_id).toBe(ITEM_A);
    const withoutItem = projectLineToInvoiceLineCreate({
      item_id: null,
      name: 'X',
      description: null,
      quantity: '1',
      unit_price_cents: 100,
      position: 0,
    });
    expect(withoutItem.item_id).toBeUndefined();
  });

  it('computes line_total_cents as round(qty * unit_price)', () => {
    const out = projectLineToInvoiceLineCreate({
      item_id: null,
      name: 'X',
      description: null,
      quantity: '3',
      unit_price_cents: 1234,
      position: 0,
    });
    expect(out.line_total_cents).toBe('3702');
  });

  it('falls back to 0 line_total when quantity is not numeric', () => {
    const out = projectLineToInvoiceLineCreate({
      item_id: null,
      name: 'X',
      description: null,
      quantity: 'oops',
      unit_price_cents: 100,
      position: 0,
    });
    expect(out.line_total_cents).toBe('0');
  });
});
