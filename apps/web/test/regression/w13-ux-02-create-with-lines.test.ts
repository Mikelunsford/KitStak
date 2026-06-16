// R-W13-UX-02 regression suite. Pins the create-screen-with-lines contract
// for quote / invoice / BOM. The repo has no jsdom / testing-library (SPA
// component tests target the pure helpers that drive the page's submit flow,
// mirroring BillingPage.test.ts and the lineDraft / sourceLinePrefill
// precedent). These cover the draft-to-payload conversion and validation
// that the create pages replay after the header create succeeds, so a
// single Create action lands header + lines.
//
// Receiving is intentionally out of scope: its create page already stages
// lines inline via @/components/forms/LineItemsEditor (covered by the
// existing lineDraft helper), so R-W13-UX-02 is a no-op there.
//
// Constitutional invariants protected:
//   * Money: invoice line_total_cents uses banker's rounding (roundHalfEven)
//     and integer cents on the wire. Quote drafts carry integer qty_e3 /
//     cents / bps. No floats persisted.
//   * Order: emitted lines preserve operator entry order via position /
//     sort_order.
//   * No 403/404 surface, no RLS / audit / idempotency change (SPA only).

import { describe, it, expect } from 'vitest';

import {
  isQuoteLineDraftFilled,
  quoteDraftToLineRequest,
  quoteDraftsToLineRequests,
  makeEmptyQuoteLineDraft,
  type QuoteLineDraft,
} from '../../src/pages/3pl-operations/quotes/quoteLineDraft.ts';
import {
  isInvoiceLineDraftFilled,
  invoiceDraftToLineCreate,
  invoiceDraftsToLineCreates,
  makeEmptyInvoiceLineDraft,
  type InvoiceLineDraft,
} from '../../src/pages/3pl-operations/invoicing/invoiceLineDraft.ts';
import {
  isBomLineDraftFilled,
  validateBomDrafts,
  bomDraftToCreateBody,
  bomDraftsToCreateBodies,
  makeEmptyBomLineDraft,
  type BomLineDraft,
} from '../../src/pages/3pl-operations/boms/bomLineDraft.ts';

// ---------------------------------------------------------------------------
// Quote lines
// ---------------------------------------------------------------------------

function quoteDraft(over: Partial<QuoteLineDraft> = {}): QuoteLineDraft {
  return { ...makeEmptyQuoteLineDraft(), ...over };
}

describe('R-W13-UX-02 quote create lines', () => {
  it('drops blank rows (no name) before submit', () => {
    expect(isQuoteLineDraftFilled(quoteDraft({ name: '' }))).toBe(false);
    expect(isQuoteLineDraftFilled(quoteDraft({ name: '   ' }))).toBe(false);
    expect(isQuoteLineDraftFilled(quoteDraft({ name: 'Pallet wrap' }))).toBe(true);
  });

  it('converts a draft into the addLineItem request with integer storage units', () => {
    const req = quoteDraftToLineRequest(
      quoteDraft({
        name: 'Pallet wrap',
        sku: 'PW-1',
        item_id: 'item-1',
        quantity_e3: 2500,
        unit_price_cents: 1299,
        discount_bps: 500,
        tax_id: 'tax-1',
        is_taxable: true,
      }),
      3,
    );
    expect(req).toEqual({
      position: 3,
      name: 'Pallet wrap',
      sku: 'PW-1',
      item_id: 'item-1',
      kind: 'item',
      quantity_e3: 2500,
      unit_price_cents: 1299,
      discount_bps: 500,
      tax_id: 'tax-1',
      is_taxable: true,
    });
  });

  it('nulls empty sku / tax id and defaults null numeric fields to 0', () => {
    const req = quoteDraftToLineRequest(
      quoteDraft({
        name: 'Service',
        sku: '',
        tax_id: '',
        quantity_e3: null,
        unit_price_cents: null,
        discount_bps: null,
      }),
      0,
    );
    expect(req.sku).toBeNull();
    expect(req.tax_id).toBeNull();
    expect(req.item_id).toBeNull();
    expect(req.quantity_e3).toBe(0);
    expect(req.unit_price_cents).toBe(0);
    expect(req.discount_bps).toBe(0);
  });

  it('emits ordered requests for filled rows and skips blanks', () => {
    const drafts = [
      quoteDraft({ name: 'First' }),
      quoteDraft({ name: '' }),
      quoteDraft({ name: 'Second' }),
    ];
    const reqs = quoteDraftsToLineRequests(drafts);
    expect(reqs).toHaveLength(2);
    expect(reqs[0]?.name).toBe('First');
    expect(reqs[0]?.position).toBe(0);
    expect(reqs[1]?.name).toBe('Second');
    expect(reqs[1]?.position).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Invoice lines
// ---------------------------------------------------------------------------

function invoiceDraft(over: Partial<InvoiceLineDraft> = {}): InvoiceLineDraft {
  return { ...makeEmptyInvoiceLineDraft(), ...over };
}

describe('R-W13-UX-02 invoice create lines', () => {
  it('drops blank rows (no description) before submit', () => {
    expect(isInvoiceLineDraftFilled(invoiceDraft({ description: '' }))).toBe(false);
    expect(isInvoiceLineDraftFilled(invoiceDraft({ description: ' ' }))).toBe(false);
    expect(
      isInvoiceLineDraftFilled(invoiceDraft({ description: 'Freight' })),
    ).toBe(true);
  });

  it('computes line_total_cents with banker rounding and integer cents on the wire', () => {
    // 3 x 333 = 999 (exact)
    const exact = invoiceDraftToLineCreate(
      invoiceDraft({ description: 'A', quantity: '3', unit_price_cents: '333' }),
      0,
    );
    expect(exact.line_total_cents).toBe('999');
    expect(exact.unit_price_cents).toBe('333');
    expect(exact.sort_order).toBe(0);

    // 2.5 x 101 = 252.5 -> half-even rounds to 252 (nearest even)
    const halfEven = invoiceDraftToLineCreate(
      invoiceDraft({ description: 'B', quantity: '2.5', unit_price_cents: '101' }),
      1,
    );
    expect(halfEven.line_total_cents).toBe('252');
  });

  it('carries item_id only when present', () => {
    const withItem = invoiceDraftToLineCreate(
      invoiceDraft({ description: 'A', item_id: 'item-9' }),
      0,
    );
    expect(withItem.item_id).toBe('item-9');
    const withoutItem = invoiceDraftToLineCreate(
      invoiceDraft({ description: 'A', item_id: null }),
      0,
    );
    expect('item_id' in withoutItem).toBe(false);
  });

  it('continues sort_order from the source-derived base so manual rows land after', () => {
    const drafts = [
      invoiceDraft({ description: 'Manual 1' }),
      invoiceDraft({ description: '' }),
      invoiceDraft({ description: 'Manual 2' }),
    ];
    // Two derived lines already queued at sort_order 0,1 -> manual base 2.
    const creates = invoiceDraftsToLineCreates(drafts, 2);
    expect(creates).toHaveLength(2);
    expect(creates[0]?.description).toBe('Manual 1');
    expect(creates[0]?.sort_order).toBe(2);
    expect(creates[1]?.description).toBe('Manual 2');
    expect(creates[1]?.sort_order).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// BOM components
// ---------------------------------------------------------------------------

function bomDraft(over: Partial<BomLineDraft> = {}): BomLineDraft {
  return { ...makeEmptyBomLineDraft(), ...over };
}

describe('R-W13-UX-02 BOM create components', () => {
  it('drops blank rows (no component) before submit', () => {
    expect(isBomLineDraftFilled(bomDraft({ component_item_id: '' }))).toBe(false);
    expect(
      isBomLineDraftFilled(bomDraft({ component_item_id: 'item-2' })),
    ).toBe(true);
  });

  it('requires at least one component', () => {
    const v = validateBomDrafts('parent-1', [bomDraft({ component_item_id: '' })]);
    expect(v.ok).toBe(false);
    expect(v.message).toMatch(/at least one component/i);
  });

  it('rejects a component equal to the finished item', () => {
    const v = validateBomDrafts('parent-1', [
      bomDraft({ component_item_id: 'parent-1' }),
    ]);
    expect(v.ok).toBe(false);
    expect(v.message).toMatch(/cannot be the finished item/i);
  });

  it('rejects a non-positive quantity', () => {
    const v = validateBomDrafts('parent-1', [
      bomDraft({ component_item_id: 'item-2', quantity_per: '0' }),
    ]);
    expect(v.ok).toBe(false);
    expect(v.message).toMatch(/greater than zero/i);
  });

  it('accepts a valid component set', () => {
    const v = validateBomDrafts('parent-1', [
      bomDraft({ component_item_id: 'item-2', quantity_per: '2' }),
      bomDraft({ component_item_id: 'item-3', quantity_per: '1.5' }),
    ]);
    expect(v.ok).toBe(true);
    expect(v.message).toBeNull();
  });

  it('converts a draft into the createBomItem body with the chosen parent', () => {
    const body = bomDraftToCreateBody(
      'parent-1',
      bomDraft({
        component_item_id: 'item-2',
        quantity_per: '2.5',
        unit_of_measure: 'kg',
        notes: 'temper first',
      }),
    );
    expect(body).toEqual({
      parent_item_id: 'parent-1',
      component_item_id: 'item-2',
      quantity_per: 2.5,
      unit_of_measure: 'kg',
      notes: 'temper first',
    });
  });

  it('nulls empty unit and notes', () => {
    const body = bomDraftToCreateBody(
      'parent-1',
      bomDraft({ component_item_id: 'item-2', unit_of_measure: '', notes: '' }),
    );
    expect(body.unit_of_measure).toBeNull();
    expect(body.notes).toBeNull();
  });

  it('emits ordered bodies for filled rows and skips blanks', () => {
    const drafts = [
      bomDraft({ component_item_id: 'item-2' }),
      bomDraft({ component_item_id: '' }),
      bomDraft({ component_item_id: 'item-3' }),
    ];
    const bodies = bomDraftsToCreateBodies('parent-1', drafts);
    expect(bodies).toHaveLength(2);
    expect(bodies[0]?.component_item_id).toBe('item-2');
    expect(bodies[1]?.component_item_id).toBe('item-3');
    expect(bodies.every((b) => b.parent_item_id === 'parent-1')).toBe(true);
  });
});
