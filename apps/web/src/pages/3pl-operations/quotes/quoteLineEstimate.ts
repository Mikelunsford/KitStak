// P1-1: pure pre-tax estimator for the quote CREATE staged-lines table. The
// operator builds multi-line tiered quotes; without a live number they work
// blind, since the authoritative total only appears on the saved detail page.
// This estimates each line's net amount (gross minus discount) and a running
// subtotal so the screen shows a number while building.
//
// Estimate only, never authority. Tax is a server concern (re-snapshotted at
// save) and the server recomputes every authoritative total from trusted line
// inputs. The math uses integer cents and roundHalfEven (banker's rounding) so
// it agrees with the server to the cent for tax-free lines. Pure module (no
// React, no query hooks) so the vitest suite pins the contract, matching
// quoteLineDraft.ts.

import { roundHalfEven } from '@/lib/money';

import type { QuoteLineDraft } from './quoteLineDraft';

const QTY_SCALE = 1000; // quantity_e3 is thousandths (1000 = 1 unit)
const BPS_SCALE = 10000; // discount_bps: 10000 = 100%

/**
 * Net cents for one draft line: quantity * unit_price * (1 - discount), as
 * quantity_e3 * unit_price_cents * (BPS_SCALE - discount_bps) /
 * (QTY_SCALE * BPS_SCALE), banker's-rounded to whole cents. Null inputs read
 * as zero, mirroring the create page's "blank means zero" handling.
 */
export function estimateLineAmountCents(draft: QuoteLineDraft): number {
  const qtyE3 = draft.quantity_e3 ?? 0;
  const price = draft.unit_price_cents ?? 0;
  const discountBps = draft.discount_bps ?? 0;
  const net =
    (qtyE3 * price * (BPS_SCALE - discountBps)) / (QTY_SCALE * BPS_SCALE);
  return roundHalfEven(net);
}

/** Sum of the per-line net estimates. Pre-tax, pre-final. */
export function estimateSubtotalCents(drafts: QuoteLineDraft[]): number {
  return drafts.reduce((sum, draft) => sum + estimateLineAmountCents(draft), 0);
}

// Exact copy guidance from the plan. No em dash; tax stays a server concern.
export const ESTIMATED_SUBTOTAL_LABEL =
  'Estimated subtotal. Final total calculates on save.';
