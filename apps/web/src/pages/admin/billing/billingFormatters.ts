// Pure helpers backing /admin/billing. No React, no DOM — keeps unit
// tests cheap and matches the membersInviteForm / dashboardChecklistSteps
// shape used elsewhere in /admin.
//
// Wire to BillingPage.tsx via named import. Tests live in
// billingFormatters.test.ts.

import { formatCents } from '@/lib/money';
import type { PlanCadence, PlanSpec } from '@/lib/services/billingPlans';

/** "$800/mo" or "$8,160/yr". formatCents handles the currency conversion. */
export function formatPlanPrice(plan: PlanSpec, currency = 'USD'): string {
  const amount = formatCents(plan.price_cents, currency);
  return `${amount}${suffixForCadence(plan.cadence)}`;
}

function suffixForCadence(cadence: PlanCadence): string {
  return cadence === 'annual' ? '/yr' : '/mo';
}

/**
 * Annual cards carry a 15%-off badge. Returns the label string when
 * applicable, null otherwise. Kept pure so tests can pin the copy.
 */
export function annualSavingsBadge(plan: PlanSpec): string | null {
  return plan.cadence === 'annual' ? 'Save 15%' : null;
}

/**
 * Should the "Manage in Stripe" button render? Hidden until the org has
 * a stripe_customer_id (i.e. the operator has completed at least one
 * Checkout). During the no-card trial there is nothing for the portal to
 * manage, so the button stays hidden.
 */
export function shouldShowManageInStripe(
  stripeCustomerId: string | null,
): boolean {
  return typeof stripeCustomerId === 'string' && stripeCustomerId.length > 0;
}

/**
 * Should the plan card render the "Current plan" label instead of the
 * Upgrade button? True when the active subscription plan matches the
 * card's plan code.
 */
export function isCurrentPlanCard(
  cardCode: string,
  activePlan: string | null,
): boolean {
  return Boolean(activePlan) && activePlan === cardCode;
}

/**
 * URL-state code -> banner shape. Returns null when the param is absent
 * or unrecognised so the caller can render nothing.
 */
export type BillingUrlState =
  | { kind: 'success'; planDisplayName: string | null }
  | { kind: 'canceled' }
  | { kind: 'gated' }
  | null;

export function parseBillingUrlState(
  search: string,
  planDisplayName: string | null,
): BillingUrlState {
  const params = new URLSearchParams(search);
  const checkout = params.get('checkout');
  if (checkout === 'success') {
    return { kind: 'success', planDisplayName };
  }
  if (checkout === 'canceled') {
    return { kind: 'canceled' };
  }
  if (params.get('gated') === 'true') {
    return { kind: 'gated' };
  }
  return null;
}
