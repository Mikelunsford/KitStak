// billing-api: Stripe billing surface for org owners and admins.
//
// Three routes:
//   GET  /subscription            -> read the org's current Stripe state from
//                                    organizations (no Stripe API call).
//   POST /checkout-session        -> create a Stripe Checkout Session for the
//                                    selected plan. Lazily creates a Stripe
//                                    Customer on first call and persists the
//                                    id back to organizations.stripe_customer_id.
//   POST /billing-portal-session  -> create a Stripe Billing Portal session so
//                                    the operator can manage payment methods,
//                                    invoices, and plan changes in Stripe.
//
// Auth: verify_jwt = true (default). State-changing routes (POSTs) call
// requireCap(caller, 'org.billing.manage') and are wrapped in
// respondWithIdempotency per the constitution.
//
// Stripe wiring block dependencies:
//   - migration 0071 (organizations.stripe_customer_id, stripe_subscription_id,
//     subscription_status, subscription_plan, trial_ends_at,
//     subscription_current_period_end).
//   - stripe-webhook bundle (writes subscription state back to the org on
//     checkout.session.completed and customer.subscription.* events).
//   - SPA /admin/billing page (consumes these three routes).
//
// org.billing.read and org.billing.manage are added to capabilities.ts in
// this same PR (owner + admin roles). The parallel caps PR is a no-op if
// this lands first; otherwise this PR rebases over the caps additions.

import Stripe from 'stripe';
import { z } from 'zod';

import { route, type RouteCtx } from '../_shared/route.ts';
import {
  admin,
  parseBody,
  requireCap,
  respondWithIdempotency,
} from '../_shared/handler-helpers.ts';
import { ok, ApiError } from '../_shared/responses.ts';
import { requireCaller } from '../_shared/tenant.ts';

const BUNDLE = 'billing-api';

// The six approved Stripe Price IDs. Source of truth lives in the Stripe
// dashboard; mirrored here so the SPA can pass a stable plan code instead of
// a leaky price id. Adding a new plan: add the price in Stripe, then append
// to this map and to the Zod enum below.
const PLAN_TO_PRICE = {
  starter_monthly: 'price_1TbmMV4KMrbWyNl1MPMQrM2a',
  starter_annual: 'price_1TbmSB4KMrbWyNl1QpHy3QQU',
  pro_monthly: 'price_1TbmOU4KMrbWyNl1sbGBK6qz',
  pro_annual: 'price_1TbmSw4KMrbWyNl1rp7mEfLc',
  enterprise_monthly: 'price_1TbmQD4KMrbWyNl1z7vh1f4T',
  enterprise_annual: 'price_1TbmTe4KMrbWyNl186ej636V',
} as const;

type PlanCode = keyof typeof PLAN_TO_PRICE;

const CheckoutSessionBodySchema = z.object({
  plan: z.enum([
    'starter_monthly',
    'starter_annual',
    'pro_monthly',
    'pro_annual',
    'enterprise_monthly',
    'enterprise_annual',
  ]),
  success_url: z.string().url().optional(),
  cancel_url: z.string().url().optional(),
});

const PortalSessionBodySchema = z.object({
  return_url: z.string().url().optional(),
});

const DEFAULT_SUCCESS_URL =
  'https://www.kitstak.com/admin/billing?checkout=success';
const DEFAULT_CANCEL_URL =
  'https://www.kitstak.com/admin/billing?checkout=canceled';
const DEFAULT_RETURN_URL = 'https://www.kitstak.com/admin/billing';

/**
 * Lazy Stripe client factory. Throws INTERNAL_ERROR 500 when the secret key
 * env var is absent so the handler never silently calls Stripe with an
 * undefined key.
 */
function stripeClient(): Stripe {
  const key = Deno.env.get('STRIPE_SECRET_KEY');
  if (!key) {
    throw new ApiError(
      'INTERNAL_ERROR',
      500,
      'STRIPE_SECRET_KEY not configured',
    );
  }
  return new Stripe(key);
}

interface OrgBillingRow {
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  subscription_status: string | null;
  subscription_plan: string | null;
  trial_ends_at: string | null;
  subscription_current_period_end: string | null;
}

async function loadOrgBilling(orgId: string): Promise<OrgBillingRow> {
  const sb = admin();
  const { data, error } = await sb
    .from('organizations')
    .select(
      'stripe_customer_id, stripe_subscription_id, subscription_status, subscription_plan, trial_ends_at, subscription_current_period_end',
    )
    .eq('id', orgId)
    .maybeSingle();

  if (error) {
    throw new ApiError(
      'INTERNAL_ERROR',
      500,
      `organizations lookup failed: ${error.message}`,
    );
  }
  if (!data) {
    // The caller's JWT carries an org_id that does not resolve. Constitution
    // says workflow POSTs across tenants return 404; the same posture applies
    // here so we never echo "your own org was deleted" leakage.
    throw new ApiError('NOT_FOUND', 404, 'Organization not found.');
  }
  return data as OrgBillingRow;
}

async function getSubscription(ctx: RouteCtx): Promise<Response> {
  const caller = requireCaller(ctx.req);
  requireCap(caller, 'org.billing.read');

  const row = await loadOrgBilling(caller.orgId);
  return ok({
    status: row.subscription_status,
    plan: row.subscription_plan,
    trial_ends_at: row.trial_ends_at,
    current_period_end: row.subscription_current_period_end,
    stripe_customer_id: row.stripe_customer_id,
  });
}

/**
 * Resolve the caller's email from auth.users via admin.getUserById. Stripe
 * requires an email on the Customer record so receipts and portal links land
 * in the right inbox.
 */
async function resolveCallerEmail(userId: string): Promise<string> {
  const sb = admin();
  const { data, error } = await sb.auth.admin.getUserById(userId);
  if (error || !data?.user?.email) {
    throw new ApiError(
      'INTERNAL_ERROR',
      500,
      'Caller email could not be resolved from auth.users',
    );
  }
  return data.user.email;
}

/**
 * Persist a freshly-minted Stripe Customer id back to organizations. Service-
 * role bypasses RLS; the explicit `.eq('id', orgId)` is the tenant guard.
 */
async function persistCustomerId(
  orgId: string,
  customerId: string,
): Promise<void> {
  const sb = admin();
  const { error } = await sb
    .from('organizations')
    .update({ stripe_customer_id: customerId })
    .eq('id', orgId);
  if (error) {
    throw new ApiError(
      'INTERNAL_ERROR',
      500,
      `failed to persist stripe_customer_id: ${error.message}`,
    );
  }
}

async function postCheckoutSession(ctx: RouteCtx): Promise<Response> {
  const caller = requireCaller(ctx.req);
  requireCap(caller, 'org.billing.manage');
  const body = await parseBody(ctx.req, CheckoutSessionBodySchema);

  return respondWithIdempotency(
    ctx.req,
    caller,
    BUNDLE,
    '/checkout-session',
    body,
    async () => {
      const stripe = stripeClient();
      const row = await loadOrgBilling(caller.orgId);

      let customerId = row.stripe_customer_id;
      if (!customerId) {
        const email = await resolveCallerEmail(caller.userId);
        const customer = await stripe.customers.create({
          email,
          metadata: {
            org_id: caller.orgId,
            kitstak_org_id: caller.orgId,
          },
        });
        customerId = customer.id;
        await persistCustomerId(caller.orgId, customerId);
      }

      const price = PLAN_TO_PRICE[body.plan as PlanCode];
      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        customer: customerId,
        line_items: [{ price, quantity: 1 }],
        success_url: body.success_url ?? DEFAULT_SUCCESS_URL,
        cancel_url: body.cancel_url ?? DEFAULT_CANCEL_URL,
        client_reference_id: caller.orgId,
        allow_promotion_codes: true,
        automatic_tax: { enabled: true },
        billing_address_collection: 'required',
      });

      if (!session.url) {
        throw new ApiError(
          'INTERNAL_ERROR',
          500,
          'Stripe Checkout Session returned no url',
        );
      }
      return ok({ checkout_url: session.url });
    },
  );
}

async function postBillingPortalSession(ctx: RouteCtx): Promise<Response> {
  const caller = requireCaller(ctx.req);
  requireCap(caller, 'org.billing.manage');
  const body = await parseBody(ctx.req, PortalSessionBodySchema);

  return respondWithIdempotency(
    ctx.req,
    caller,
    BUNDLE,
    '/billing-portal-session',
    body,
    async () => {
      const row = await loadOrgBilling(caller.orgId);
      if (!row.stripe_customer_id) {
        // No portal until the org has checked out at least once. 422 is the
        // shape-of-state error rail, distinct from 404 (org missing) and 403
        // (cap denied).
        throw new ApiError(
          'VALIDATION_ERROR',
          422,
          'No Stripe customer for this org. Complete a checkout first.',
        );
      }

      const stripe = stripeClient();
      const session = await stripe.billingPortal.sessions.create({
        customer: row.stripe_customer_id,
        return_url: body.return_url ?? DEFAULT_RETURN_URL,
      });

      if (!session.url) {
        throw new ApiError(
          'INTERNAL_ERROR',
          500,
          'Stripe Billing Portal Session returned no url',
        );
      }
      return ok({ portal_url: session.url });
    },
  );
}

Deno.serve((req: Request) =>
  route(
    req,
    [
      { method: 'GET',  path: '/subscription',           handler: getSubscription },
      { method: 'POST', path: '/checkout-session',       handler: postCheckoutSession },
      { method: 'POST', path: '/billing-portal-session', handler: postBillingPortalSession },
    ],
    { bundle: BUNDLE },
  ),
);
