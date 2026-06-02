// Regression suite for A2 (WS-A MONEY INTEGRITY) - purchase-order line math
// uses banker's rounding (roundHalfEven), not Math.round (half-up). The PO
// lineComputed helper feeds the persisted po_line_items.line_subtotal_cents
// / line_tax_cents / line_total_cents, so a half-up bias here would drift
// the persisted PO totals.
//
// roundHalfEven resolves exact-half values to the nearest EVEN integer:
//   0.5 -> 0,  1.5 -> 2,  2.5 -> 2,  3.5 -> 4,  4.5 -> 4
// Math.round (half-up) would instead give 1, 2, 3, 4, 5. The cases below
// pick fractional quantities so qty * unit lands exactly on .5 and the two
// rounding modes diverge, locking the banker's-rounding contract in.
//
// Target:
//   * supabase/functions/vendors-api/handlers/purchase-orders.ts lineComputed

import { describe, expect, it } from 'vitest';

import { lineComputed } from '../../../../supabase/functions/vendors-api/handlers/purchase-orders.ts';

describe('vendors-api - purchase-order line half-even rounding (A2)', () => {
  // -------------------------------------------------------------------------
  // Subtotal boundary: qty * unit lands on an exact half.
  // -------------------------------------------------------------------------

  it('rounds a .5 subtotal DOWN to the nearest even (2.5 -> 2)', () => {
    // 0.5 * 5 = 2.5 -> half-even 2 (Math.round would give 3).
    const out = lineComputed({
      quantity_ordered: 0.5,
      unit_price_cents: 5,
      tax_rate_bps: 0,
    });
    expect(out.line_subtotal_cents).toBe(2);
    expect(out.line_total_cents).toBe(2);
  });

  it('rounds a .5 subtotal UP to the nearest even (3.5 -> 4)', () => {
    // 0.5 * 7 = 3.5 -> half-even 4.
    const out = lineComputed({
      quantity_ordered: 0.5,
      unit_price_cents: 7,
      tax_rate_bps: 0,
    });
    expect(out.line_subtotal_cents).toBe(4);
    expect(out.line_total_cents).toBe(4);
  });

  it('rounds a .5 subtotal DOWN to the nearest even (4.5 -> 4)', () => {
    // 0.5 * 9 = 4.5 -> half-even 4 (Math.round would give 5).
    const out = lineComputed({
      quantity_ordered: 0.5,
      unit_price_cents: 9,
      tax_rate_bps: 0,
    });
    expect(out.line_subtotal_cents).toBe(4);
  });

  // -------------------------------------------------------------------------
  // Tax boundary: (subtotal * bps) / 10000 lands on an exact half.
  // -------------------------------------------------------------------------

  it('rounds a .5 tax amount to the nearest even (sub 50 @ 50 bps -> 0.25? use 100 @ 50bps)', () => {
    // sub = 1 * 100 = 100. tax = (100 * 50) / 10000 = 0.5 -> half-even 0.
    const out = lineComputed({
      quantity_ordered: 1,
      unit_price_cents: 100,
      tax_rate_bps: 50,
    });
    expect(out.line_subtotal_cents).toBe(100);
    expect(out.line_tax_cents).toBe(0);
    expect(out.line_total_cents).toBe(100);
  });

  it('rounds a .5 tax amount UP to the nearest even (sub 300 @ 50 bps -> 1.5 -> 2)', () => {
    // sub = 1 * 300 = 300. tax = (300 * 50) / 10000 = 1.5 -> half-even 2.
    const out = lineComputed({
      quantity_ordered: 1,
      unit_price_cents: 300,
      tax_rate_bps: 50,
    });
    expect(out.line_tax_cents).toBe(2);
    expect(out.line_total_cents).toBe(302);
  });

  // -------------------------------------------------------------------------
  // Whole-number inputs are unchanged (no rounding ambiguity).
  // -------------------------------------------------------------------------

  it('computes whole-number lines exactly with tax', () => {
    // sub = 3 * 1000 = 3000. tax = (3000 * 825) / 10000 = 247.5 -> 248.
    const out = lineComputed({
      quantity_ordered: 3,
      unit_price_cents: 1000,
      tax_rate_bps: 825,
    });
    expect(out.line_subtotal_cents).toBe(3000);
    // 247.5 -> half-even 248.
    expect(out.line_tax_cents).toBe(248);
    expect(out.line_total_cents).toBe(3248);
  });
});
