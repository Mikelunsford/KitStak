/**
 * Billing service. Wraps the billing-api edge bundle.
 *
 *   GET  /billing-api/subscription            -> Subscription
 *   POST /billing-api/checkout-session  {plan} -> { checkout_url }
 *   POST /billing-api/billing-portal-session   -> { portal_url }
 *
 * The bundle ships in a parallel PR (Stripe wiring block, item 8). This
 * file is the SPA-side reader and stays decoupled from the worker so the
 * SPA build does not depend on the bundle's TS surface.
 *
 * The plan canon (PLAN_CATALOG / PlanCode / planByCode) lives in
 * ./billingPlans.ts so unit tests can import it without transitively
 * pulling apiClient -> supabase. Re-exported here for the call sites
 * that already pull both the catalog and the network helpers from one
 * place.
 */

import { z } from 'zod';

import { apiRequest } from '@/lib/apiClient';

import { PLAN_CODES, type PlanCode } from './billingPlans';

export {
  PLAN_CATALOG,
  PLAN_CODES,
  planByCode,
} from './billingPlans';
export type {
  PlanCadence,
  PlanCode,
  PlanSpec,
  PlanTier,
} from './billingPlans';

const PlanCodeSchema = z.enum(PLAN_CODES as unknown as [PlanCode, ...PlanCode[]]);

// ---------------------------------------------------------------------------
// Subscription envelope.
// ---------------------------------------------------------------------------

export type SubscriptionStatus =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'incomplete'
  | 'incomplete_expired'
  | 'unpaid'
  | 'paused';

const SubscriptionStatusSchema = z.enum([
  'trialing',
  'active',
  'past_due',
  'canceled',
  'incomplete',
  'incomplete_expired',
  'unpaid',
  'paused',
]);

const SubscriptionSchema = z.object({
  status: SubscriptionStatusSchema,
  plan: PlanCodeSchema.nullable(),
  trial_ends_at: z.string().nullable(),
  current_period_end: z.string().nullable(),
  stripe_customer_id: z.string().nullable(),
});

export type Subscription = z.infer<typeof SubscriptionSchema>;

export async function getSubscription(): Promise<Subscription> {
  const data = await apiRequest<unknown>('/billing-api/subscription', {
    method: 'GET',
  });
  return SubscriptionSchema.parse(data);
}

// ---------------------------------------------------------------------------
// Checkout-session and portal-session.
// ---------------------------------------------------------------------------

const CheckoutSessionSchema = z.object({
  checkout_url: z.string().url(),
});

export async function createCheckoutSession(
  plan: PlanCode,
): Promise<{ checkout_url: string }> {
  const data = await apiRequest<unknown>('/billing-api/checkout-session', {
    method: 'POST',
    body: { plan },
  });
  return CheckoutSessionSchema.parse(data);
}

const PortalSessionSchema = z.object({
  portal_url: z.string().url(),
});

export async function createBillingPortalSession(): Promise<{
  portal_url: string;
}> {
  const data = await apiRequest<unknown>(
    '/billing-api/billing-portal-session',
    { method: 'POST' },
  );
  return PortalSessionSchema.parse(data);
}
