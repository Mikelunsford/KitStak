// Regression suite for the billing-api edge bundle (Stripe wiring block).
//
// Locks in the constitutional contract:
//   1. GET /subscription returns the org's current row, no Stripe call.
//   2. GET /subscription requires org.billing.read; non-billing roles -> 403.
//   3. POST /checkout-session requires org.billing.manage -> 403 when denied.
//   4. POST /checkout-session lazily creates a Stripe Customer when the org
//      has none, persists the id, and returns the Checkout url.
//   5. POST /checkout-session validates the plan code -> 422 on invalid input.
//   6. POST /checkout-session enforces Idempotency-Key (the wrapper is
//      present) -> 400 IDEMPOTENCY_KEY_REQUIRED when the header is absent.
//   7. POST /billing-portal-session returns 422 when stripe_customer_id is
//      null (no portal until the org has checked out at least once).
//   8. POST /billing-portal-session returns the portal url when the customer
//      id is set.

import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
  installDenoShim,
  capturedHandler,
  resetCapturedHandler,
} from './_helpers/deno-shim.ts';
import { makeState, bearer } from './_helpers/supabase-mock.ts';
import {
  setActiveMockState,
  clearActiveMockState,
} from './_helpers/supabase-stub.ts';
import {
  makeStripeMockState,
  setActiveStripeMock,
  clearActiveStripeMock,
} from './_helpers/stripe-stub.ts';

const ORG_A = '00000000-0000-4000-8000-0000000000a1';
const ORG_B = '00000000-0000-4000-8000-0000000000a2';
const OWNER_USER = '00000000-0000-4000-8000-0000000000b1';
const VIEWER_USER = '00000000-0000-4000-8000-0000000000b2';

const OWNER_CALLER = {
  userId: OWNER_USER,
  orgId: ORG_A,
  role: 'org_owner' as const,
};
const VIEWER_CALLER = {
  userId: VIEWER_USER,
  orgId: ORG_A,
  role: 'viewer' as const,
};
const OWNER_CALLER_ORG_B = {
  userId: OWNER_USER,
  orgId: ORG_B,
  role: 'org_owner' as const,
};

// Stable UUID v4 for Idempotency-Key. Variant bits 8xxx, version bits 4xxx.
const IDEM_KEY_1 = '11111111-1111-4111-8111-111111111111';
const IDEM_KEY_2 = '22222222-2222-4222-8222-222222222222';

function readJsonStatus(res: Response): Promise<{
  status: number;
  json: { data?: unknown; error?: { code?: string } };
}> {
  return res.text().then((t) => ({ status: res.status, json: JSON.parse(t) }));
}

function get(
  path: string,
  caller: { userId: string; orgId: string; role: string },
): Request {
  return new Request(`https://example.test${path}`, {
    method: 'GET',
    headers: { authorization: bearer(caller) },
  });
}

function post(
  path: string,
  caller: { userId: string; orgId: string; role: string },
  body: unknown,
  opts: { idempotencyKey?: string | null } = {},
): Request {
  const headers: Record<string, string> = {
    authorization: bearer(caller),
    'content-type': 'application/json',
  };
  if (opts.idempotencyKey !== null) {
    headers['idempotency-key'] = opts.idempotencyKey ?? IDEM_KEY_1;
  }
  return new Request(`https://example.test${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

function makeBillingState(opts: {
  orgs?: Array<{
    id: string;
    stripe_customer_id?: string | null;
    stripe_subscription_id?: string | null;
    subscription_status?: string | null;
    subscription_plan?: string | null;
    trial_ends_at?: string | null;
    subscription_current_period_end?: string | null;
  }>;
  owner_email?: string;
} = {}) {
  const orgs = (opts.orgs ?? [
    {
      id: ORG_A,
      stripe_customer_id: null,
      stripe_subscription_id: null,
      subscription_status: 'trialing',
      subscription_plan: null,
      trial_ends_at: '2026-06-10T00:00:00Z',
      subscription_current_period_end: null,
    },
  ]).map((o) => ({
    id: o.id,
    stripe_customer_id: o.stripe_customer_id ?? null,
    stripe_subscription_id: o.stripe_subscription_id ?? null,
    subscription_status: o.subscription_status ?? null,
    subscription_plan: o.subscription_plan ?? null,
    trial_ends_at: o.trial_ends_at ?? null,
    subscription_current_period_end:
      o.subscription_current_period_end ?? null,
  }));

  const state = makeState({ organizations: orgs });

  // The handler resolves caller email via auth.admin.getUserById. Seed an
  // override so the test does not depend on the default echo.
  state.authAdminGetUserByIdResults[OWNER_USER] = {
    data: {
      user: {
        id: OWNER_USER,
        email: opts.owner_email ?? 'owner@example.test',
        email_confirmed_at: '2026-01-01T00:00:00Z',
      },
    },
    error: null,
  };

  return state;
}

describe('billing-api edge bundle - Stripe wiring', () => {
  let handler: (req: Request) => Promise<Response> | Response;

  beforeAll(async () => {
    installDenoShim();
    resetCapturedHandler();
    await import('../../../../supabase/functions/billing-api/index.ts');
    handler = capturedHandler();
  });

  afterEach(() => {
    clearActiveMockState();
    clearActiveStripeMock();
  });

  // GET /subscription
  it('GET /subscription returns the orgs current subscription row', async () => {
    setActiveMockState(
      makeBillingState({
        orgs: [
          {
            id: ORG_A,
            stripe_customer_id: 'cus_existing_123',
            stripe_subscription_id: 'sub_existing_123',
            subscription_status: 'active',
            subscription_plan: 'pro_monthly',
            trial_ends_at: null,
            subscription_current_period_end: '2026-06-30T00:00:00Z',
          },
        ],
      }),
    );
    setActiveStripeMock(makeStripeMockState());

    const res = await handler(get('/subscription', OWNER_CALLER));
    const { status, json } = await readJsonStatus(res);
    expect(status).toBe(200);
    expect(json.data).toMatchObject({
      status: 'active',
      plan: 'pro_monthly',
      trial_ends_at: null,
      current_period_end: '2026-06-30T00:00:00Z',
      stripe_customer_id: 'cus_existing_123',
    });
  });

  it('GET /subscription returns 403 when caller lacks org.billing.read', async () => {
    setActiveMockState(makeBillingState());
    setActiveStripeMock(makeStripeMockState());

    const res = await handler(get('/subscription', VIEWER_CALLER));
    const { status, json } = await readJsonStatus(res);
    expect(status).toBe(403);
    expect(json.error?.code).toBe('FORBIDDEN');
  });

  // POST /checkout-session
  it('POST /checkout-session returns 403 when caller lacks org.billing.manage', async () => {
    setActiveMockState(makeBillingState());
    setActiveStripeMock(makeStripeMockState());

    const res = await handler(
      post(
        '/checkout-session',
        VIEWER_CALLER,
        { plan: 'starter_monthly' },
      ),
    );
    const { status, json } = await readJsonStatus(res);
    expect(status).toBe(403);
    expect(json.error?.code).toBe('FORBIDDEN');
  });

  it('POST /checkout-session lazily creates a Stripe Customer and returns checkout_url', async () => {
    setActiveMockState(makeBillingState());
    const stripeState = makeStripeMockState({
      customersCreateResult: { id: 'cus_freshly_created' },
      checkoutSessionResult: {
        id: 'cs_test_lazycreate',
        url: 'https://checkout.stripe.test/cs_test_lazycreate',
      },
    });
    setActiveStripeMock(stripeState);

    const res = await handler(
      post(
        '/checkout-session',
        OWNER_CALLER,
        { plan: 'pro_annual' },
      ),
    );
    const { status, json } = await readJsonStatus(res);
    expect(status).toBe(200);
    expect(json.data).toMatchObject({
      checkout_url: 'https://checkout.stripe.test/cs_test_lazycreate',
    });

    // Stripe Customer was created with the caller email and org metadata.
    expect(stripeState.customersCreateCalls).toHaveLength(1);
    expect(stripeState.customersCreateCalls[0]).toMatchObject({
      email: 'owner@example.test',
      metadata: { org_id: ORG_A, kitstak_org_id: ORG_A },
    });

    // Checkout Session received the right plan price and defaults.
    expect(stripeState.checkoutSessionCalls).toHaveLength(1);
    const args = stripeState.checkoutSessionCalls[0];
    expect(args.mode).toBe('subscription');
    expect(args.customer).toBe('cus_freshly_created');
    expect(args.line_items?.[0]?.price).toBe(
      'price_1TbmSw4KMrbWyNl1rp7mEfLc',
    );
    expect(args.client_reference_id).toBe(ORG_A);
    expect(args.allow_promotion_codes).toBe(true);
    expect(args.automatic_tax?.enabled).toBe(true);
    expect(args.billing_address_collection).toBe('required');
    expect(args.success_url).toContain('/admin/billing');
    expect(args.cancel_url).toContain('/admin/billing');
  });

  it('POST /checkout-session returns 422 for an invalid plan code', async () => {
    setActiveMockState(makeBillingState());
    setActiveStripeMock(makeStripeMockState());

    const res = await handler(
      post(
        '/checkout-session',
        OWNER_CALLER,
        { plan: 'platinum_unlimited' },
      ),
    );
    const { status, json } = await readJsonStatus(res);
    expect(status).toBe(422);
    expect(json.error?.code).toBe('VALIDATION_ERROR');
  });

  it('POST /checkout-session returns 400 IDEMPOTENCY_KEY_REQUIRED when header is missing (wrapper present)', async () => {
    setActiveMockState(makeBillingState());
    setActiveStripeMock(makeStripeMockState());

    const res = await handler(
      post(
        '/checkout-session',
        OWNER_CALLER,
        { plan: 'starter_monthly' },
        { idempotencyKey: null },
      ),
    );
    const { status, json } = await readJsonStatus(res);
    expect(status).toBe(400);
    expect(json.error?.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });

  // POST /billing-portal-session
  it('POST /billing-portal-session returns 422 when stripe_customer_id is null', async () => {
    setActiveMockState(
      makeBillingState({
        orgs: [
          {
            id: ORG_B,
            stripe_customer_id: null,
            subscription_status: 'trialing',
          },
        ],
      }),
    );
    setActiveStripeMock(makeStripeMockState());

    const res = await handler(
      post(
        '/billing-portal-session',
        OWNER_CALLER_ORG_B,
        {},
        { idempotencyKey: IDEM_KEY_2 },
      ),
    );
    const { status, json } = await readJsonStatus(res);
    expect(status).toBe(422);
    expect(json.error?.code).toBe('VALIDATION_ERROR');
  });

  it('POST /billing-portal-session returns portal_url when stripe_customer_id is set', async () => {
    setActiveMockState(
      makeBillingState({
        orgs: [
          {
            id: ORG_A,
            stripe_customer_id: 'cus_already_set',
            subscription_status: 'active',
            subscription_plan: 'starter_monthly',
          },
        ],
      }),
    );
    const stripeState = makeStripeMockState({
      billingPortalResult: {
        id: 'bps_test_open',
        url: 'https://billing.stripe.test/bps_test_open',
      },
    });
    setActiveStripeMock(stripeState);

    const res = await handler(
      post(
        '/billing-portal-session',
        OWNER_CALLER,
        {},
        { idempotencyKey: IDEM_KEY_2 },
      ),
    );
    const { status, json } = await readJsonStatus(res);
    expect(status).toBe(200);
    expect(json.data).toMatchObject({
      portal_url: 'https://billing.stripe.test/bps_test_open',
    });

    expect(stripeState.billingPortalCalls).toHaveLength(1);
    const args = stripeState.billingPortalCalls[0];
    expect(args.customer).toBe('cus_already_set');
    expect(args.return_url).toBe('https://www.kitstak.com/admin/billing');
  });
});
