// P1-1 unit tests for the pure quote-line estimator. Locks the integer math
// and banker's rounding so the live "Estimated subtotal" on the create screen
// agrees with the server to the cent for tax-free lines.

import { describe, it, expect } from 'vitest';

import {
  ESTIMATED_SUBTOTAL_LABEL,
  estimateLineAmountCents,
  estimateSubtotalCents,
} from './quoteLineEstimate';
import { makeEmptyQuoteLineDraft, type QuoteLineDraft } from './quoteLineDraft';

function draft(partial: Partial<QuoteLineDraft>): QuoteLineDraft {
  return { ...makeEmptyQuoteLineDraft(), ...partial };
}

describe('estimateLineAmountCents', () => {
  it('multiplies quantity by unit price with no discount', () => {
    // 2 units (qty_e3 2000) at 500 cents = 1000 cents.
    expect(
      estimateLineAmountCents(draft({ quantity_e3: 2000, unit_price_cents: 500 })),
    ).toBe(1000);
  });

  it('applies a percentage discount via basis points', () => {
    // 1 unit at 1000 cents, 10% off (1000 bps) = 900 cents.
    expect(
      estimateLineAmountCents(
        draft({ quantity_e3: 1000, unit_price_cents: 1000, discount_bps: 1000 }),
      ),
    ).toBe(900);
  });

  it('rounds half to even (banker\'s rounding)', () => {
    // qty_e3 500 (0.5 units) at price p, no discount: net = 0.5 * p cents.
    // 0.5 -> 0, 1.5 -> 2, 2.5 -> 2, 3.5 -> 4.
    expect(
      estimateLineAmountCents(draft({ quantity_e3: 500, unit_price_cents: 1 })),
    ).toBe(0);
    expect(
      estimateLineAmountCents(draft({ quantity_e3: 500, unit_price_cents: 3 })),
    ).toBe(2);
    expect(
      estimateLineAmountCents(draft({ quantity_e3: 500, unit_price_cents: 5 })),
    ).toBe(2);
    expect(
      estimateLineAmountCents(draft({ quantity_e3: 500, unit_price_cents: 7 })),
    ).toBe(4);
  });

  it('treats null inputs as zero', () => {
    expect(
      estimateLineAmountCents(
        draft({ quantity_e3: null, unit_price_cents: null, discount_bps: null }),
      ),
    ).toBe(0);
  });
});

describe('estimateSubtotalCents', () => {
  it('sums the per-line net estimates', () => {
    const lines = [
      draft({ quantity_e3: 10000, unit_price_cents: 500 }), // 10 * 500 = 5000
      draft({ quantity_e3: 2000, unit_price_cents: 250 }), // 2 * 250 = 500
    ];
    expect(estimateSubtotalCents(lines)).toBe(5500);
  });

  it('returns 0 for an empty list', () => {
    expect(estimateSubtotalCents([])).toBe(0);
  });
});

describe('ESTIMATED_SUBTOTAL_LABEL', () => {
  it('states it is an estimate that finalizes on save, with no em dash', () => {
    expect(ESTIMATED_SUBTOTAL_LABEL).toBe(
      'Estimated subtotal. Final total calculates on save.',
    );
    expect(ESTIMATED_SUBTOTAL_LABEL).not.toContain('—');
  });
});
