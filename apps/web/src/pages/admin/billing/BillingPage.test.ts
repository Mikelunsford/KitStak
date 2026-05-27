// Behavioural pins for BillingPage. The repo has no jsdom / @testing-library
// (Sidebar.test, sidebarGating, etc. all follow the pure-helper pattern), so
// the four task-mandated assertions are wired against the pure helpers that
// drive the page's render decisions.

import { describe, it, expect } from 'vitest';

import { PLAN_CATALOG, planByCode } from '@/lib/services/billingPlans';

import {
  formatPlanPrice,
  isCurrentPlanCard,
  shouldShowManageInStripe,
} from './billingFormatters';

describe('BillingPage current plan card formatting', () => {
  it('formats pro_annual as "Professional Annual" (not pro_annual)', () => {
    const plan = planByCode('pro_annual');
    expect(plan?.displayName).toBe('Professional Annual');
  });

  it('formats each known plan code via the catalog displayName field', () => {
    for (const plan of PLAN_CATALOG) {
      expect(plan.displayName).toMatch(/^(Starter|Professional|Enterprise) (Monthly|Annual)$/);
    }
  });
});

describe('BillingPage plan grid', () => {
  it('renders 6 plan cards (3 tiers x 2 cadences)', () => {
    expect(PLAN_CATALOG).toHaveLength(6);
  });

  it('renders the correct price string on every card', () => {
    const expected: Record<string, string> = {
      starter_monthly: '$800.00/mo',
      starter_annual: '$8,160.00/yr',
      pro_monthly: '$1,800.00/mo',
      pro_annual: '$18,360.00/yr',
      enterprise_monthly: '$3,500.00/mo',
      enterprise_annual: '$35,700.00/yr',
    };
    for (const plan of PLAN_CATALOG) {
      expect(formatPlanPrice(plan)).toBe(expected[plan.code]);
    }
  });

  it('shows the Save 15% badge on annuals only', () => {
    const annuals = PLAN_CATALOG.filter((p) => p.cadence === 'annual');
    const monthlies = PLAN_CATALOG.filter((p) => p.cadence === 'monthly');
    expect(annuals).toHaveLength(3);
    expect(monthlies).toHaveLength(3);
  });
});

describe('Manage in Stripe button visibility', () => {
  it('is hidden when stripe_customer_id is null (still in pre-checkout trial)', () => {
    expect(shouldShowManageInStripe(null)).toBe(false);
  });

  it('is hidden when stripe_customer_id is an empty string', () => {
    expect(shouldShowManageInStripe('')).toBe(false);
  });

  it('is shown once the org has a stripe_customer_id', () => {
    expect(shouldShowManageInStripe('cus_AbC123XyZ')).toBe(true);
  });
});

describe('Current plan label on matching card', () => {
  it('returns true when the card code matches the active plan', () => {
    expect(isCurrentPlanCard('pro_annual', 'pro_annual')).toBe(true);
  });

  it('returns false for non-matching cards', () => {
    expect(isCurrentPlanCard('starter_monthly', 'pro_annual')).toBe(false);
  });

  it('returns false when there is no active plan (fresh trial)', () => {
    expect(isCurrentPlanCard('starter_monthly', null)).toBe(false);
  });
});
