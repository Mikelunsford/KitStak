import { describe, expect, it } from 'vitest';

import {
  PLAN_TO_PRICE,
  PRICE_TO_PLAN,
} from '../../../../supabase/functions/_shared/stripe-plans';

// D8 (F-Wave10-REVIEW-REMEDIATION): PLAN_TO_PRICE and PRICE_TO_PLAN are two
// independently declared maps in _shared/stripe-plans.ts. They must be exact
// inverses, or a Stripe webhook could route a paid subscription to the wrong
// tier. This contract test makes a drift between them a release blocker.

describe('stripe-plans map parity', () => {
  it('PLAN_TO_PRICE keys equal PRICE_TO_PLAN values (same set)', () => {
    const planKeys = Object.keys(PLAN_TO_PRICE).sort();
    const reversePlans = Object.values(PRICE_TO_PLAN).sort();
    expect(reversePlans).toEqual(planKeys);
  });

  it('PRICE_TO_PLAN keys equal PLAN_TO_PRICE values (same set)', () => {
    const priceKeys = Object.keys(PRICE_TO_PLAN).sort();
    const forwardPrices = Object.values(PLAN_TO_PRICE).sort();
    expect(priceKeys).toEqual(forwardPrices);
  });

  it('round-trips every plan code through price id and back', () => {
    for (const [plan, priceId] of Object.entries(PLAN_TO_PRICE)) {
      expect(PRICE_TO_PLAN[priceId]).toBe(plan);
    }
  });

  it('round-trips every price id through plan code and back', () => {
    for (const [priceId, plan] of Object.entries(PRICE_TO_PLAN)) {
      expect(PLAN_TO_PRICE[plan]).toBe(priceId);
    }
  });
});
