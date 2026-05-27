// Unit tests for the /admin/billing pure helpers. Pin the wire copy and
// price formatting so a renamed plan or a typo in the URL-state parser
// fails CI instead of shipping.

import { describe, it, expect } from 'vitest';

// Imports from the pure billingPlans module, not billingService, so the
// test does not transitively load apiClient -> supabase (which throws at
// import time when VITE_ env vars are absent). Mirrors paymentInvalidation.
import { PLAN_CATALOG, planByCode } from '@/lib/services/billingPlans';

import {
  annualSavingsBadge,
  formatPlanPrice,
  parseBillingUrlState,
} from './billingFormatters';

describe('PLAN_CATALOG (Stripe wiring plan canon)', () => {
  it('contains exactly six plans (3 tiers x 2 cadences)', () => {
    expect(PLAN_CATALOG).toHaveLength(6);
  });

  it('exposes the six plan codes the brief calls for', () => {
    const codes = PLAN_CATALOG.map((p) => p.code);
    expect(codes).toEqual([
      'starter_monthly',
      'starter_annual',
      'pro_monthly',
      'pro_annual',
      'enterprise_monthly',
      'enterprise_annual',
    ]);
  });

  it('prices each plan in cents per the constitution (BIGINT cents)', () => {
    const byCode = Object.fromEntries(
      PLAN_CATALOG.map((p) => [p.code, p.price_cents]),
    );
    expect(byCode.starter_monthly).toBe(80000);
    expect(byCode.starter_annual).toBe(816000);
    expect(byCode.pro_monthly).toBe(180000);
    expect(byCode.pro_annual).toBe(1836000);
    expect(byCode.enterprise_monthly).toBe(350000);
    expect(byCode.enterprise_annual).toBe(3570000);
  });
});

describe('planByCode', () => {
  it('returns the plan spec when the code matches', () => {
    expect(planByCode('pro_annual')?.displayName).toBe('Professional Annual');
  });

  it('returns null for an unknown code, null, or undefined', () => {
    expect(planByCode('unknown')).toBeNull();
    expect(planByCode(null)).toBeNull();
    expect(planByCode(undefined)).toBeNull();
  });

  it('formats plan names as "Tier Cadence" (Professional Annual, not pro_annual)', () => {
    expect(planByCode('starter_monthly')?.displayName).toBe('Starter Monthly');
    expect(planByCode('enterprise_annual')?.displayName).toBe(
      'Enterprise Annual',
    );
  });
});

describe('formatPlanPrice', () => {
  it('renders /mo suffix for monthly plans', () => {
    const plan = planByCode('starter_monthly');
    expect(plan).not.toBeNull();
    if (plan) expect(formatPlanPrice(plan)).toBe('$800.00/mo');
  });

  it('renders /yr suffix for annual plans', () => {
    const plan = planByCode('starter_annual');
    expect(plan).not.toBeNull();
    if (plan) expect(formatPlanPrice(plan)).toBe('$8,160.00/yr');
  });
});

describe('annualSavingsBadge', () => {
  it('returns "Save 15%" for annual plans', () => {
    const plan = planByCode('pro_annual');
    expect(plan).not.toBeNull();
    if (plan) expect(annualSavingsBadge(plan)).toBe('Save 15%');
  });

  it('returns null for monthly plans', () => {
    const plan = planByCode('pro_monthly');
    expect(plan).not.toBeNull();
    if (plan) expect(annualSavingsBadge(plan)).toBeNull();
  });
});

describe('parseBillingUrlState', () => {
  it('returns success when checkout=success and includes the plan display name', () => {
    const result = parseBillingUrlState('?checkout=success', 'Professional Annual');
    expect(result).toEqual({
      kind: 'success',
      planDisplayName: 'Professional Annual',
    });
  });

  it('returns canceled when checkout=canceled', () => {
    expect(parseBillingUrlState('?checkout=canceled', null)).toEqual({
      kind: 'canceled',
    });
  });

  it('returns gated when gated=true', () => {
    expect(parseBillingUrlState('?gated=true', null)).toEqual({
      kind: 'gated',
    });
  });

  it('returns null when no relevant param is present', () => {
    expect(parseBillingUrlState('', null)).toBeNull();
    expect(parseBillingUrlState('?foo=bar', null)).toBeNull();
  });

  it('prefers checkout=success over a coincident gated=true (post-purchase wins)', () => {
    const result = parseBillingUrlState(
      '?checkout=success&gated=true',
      'Starter Monthly',
    );
    expect(result?.kind).toBe('success');
  });
});

describe('brand voice (no em dashes, double hyphens, emojis)', () => {
  it('plan display names follow Built to Ship voice', () => {
    for (const plan of PLAN_CATALOG) {
      expect(plan.displayName).not.toMatch(/—|--/);
      expect(plan.displayName).not.toMatch(
        /[\u{1F300}-\u{1FAFF}]|[\u{2600}-\u{27BF}]/u,
      );
    }
  });
});
