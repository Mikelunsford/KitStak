// Regression suite for the stripe-webhook edge bundle.
//
// Covers the constitutional contract for Stripe-callable webhooks:
//   1. Missing Stripe-Signature header -> 401.
//   2. Invalid signature -> 401 (verify failure surfaces as UNAUTHORIZED).
//   3. Duplicate event_id (stripe_webhook_events PK 23505) -> 200 short-
//      circuit, NO further processing (no organizations.update side effect,
//      no markProcessed write).
//   4. checkout.session.completed -> organizations.update with
//      subscription_status='active' + plan slug derived from price id.
//   5. customer.subscription.deleted -> organizations.update with
//      subscription_status='canceled'.
//   6. invoice.payment_failed -> organizations.update with
//      subscription_status='past_due'.
//
// The Stripe SDK is replaced by a local stub at
// `_helpers/stripe-stub.ts` via the vitest regression config's
// `npm:stripe@^17` rewrite. The Supabase client is the in-memory stub used
// by every other regression test. Tests forge the raw POST and feed it to
// the captured Deno.serve handler.

import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';

import {
  installDenoShim,
  capturedHandler,
  resetCapturedHandler,
} from './_helpers/deno-shim.ts';
import {
  makeState,
  type MockState,
} from './_helpers/supabase-mock.ts';
import {
  setActiveMockState,
  clearActiveMockState,
} from './_helpers/supabase-stub.ts';
import {
  resetStripeStub,
  setStripeStubEvent,
  setStripeStubSubscription,
  setStripeStubVerifyOk,
  stripeStubRetrieveCalls,
} from './_helpers/stripe-stub.ts';

const CUSTOMER_ID = 'cus_test_kitstak_org_001';
const ORG_ID = '00000000-0000-4000-8000-0000000000a1';
const SUB_ID = 'sub_test_001';
const PRICE_PRO_MONTHLY = 'price_1TbmOU4KMrbWyNl1sbGBK6qz';
const NOW = Math.floor(Date.now() / 1000);

interface ParsedJson {
  status: number;
  json: {
    data?: { received?: boolean; duplicate?: boolean };
    error?: { code?: string; message?: string };
  };
}

async function readJsonStatus(res: Response): Promise<ParsedJson> {
  const text = await res.text();
  return {
    status: res.status,
    json: text ? JSON.parse(text) : {},
  };
}

function makeWebhookRequest(
  init: {
    body?: string;
    headers?: Record<string, string>;
  } = {},
): Request {
  return new Request('https://example.test/stripe-webhook', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
    body: init.body ?? '{}',
  });
}

function baseState(): MockState {
  const state = makeState();
  // Seed an organization keyed by stripe_customer_id so the update path
  // in the handler has a row to land on. The mock matches by .eq filters.
  state.rows.organizations = [
    {
      id: ORG_ID,
      stripe_customer_id: CUSTOMER_ID,
      stripe_subscription_id: null,
      subscription_status: 'trialing',
      subscription_plan: null,
      subscription_current_period_end: null,
    },
  ];
  state.rows.stripe_webhook_events = [];
  state.insertConstraints = {
    stripe_webhook_events: { column: 'event_id' },
  };
  return state;
}

describe('stripe-webhook edge bundle (Stripe wiring)', () => {
  let handler: (req: Request) => Promise<Response> | Response;

  beforeAll(async () => {
    installDenoShim();
    resetCapturedHandler();
    await import('../../../../supabase/functions/stripe-webhook/index.ts');
    handler = capturedHandler();
  });

  beforeEach(() => {
    resetStripeStub();
  });

  afterEach(() => {
    clearActiveMockState();
  });

  it('returns 401 when Stripe-Signature header is missing', async () => {
    setActiveMockState(baseState());
    const res = await handler(makeWebhookRequest({ body: '{}' }));
    const { status, json } = await readJsonStatus(res);
    expect(status).toBe(401);
    expect(json.error?.code).toBe('UNAUTHORIZED');
  });

  it('returns 401 when signature verification fails', async () => {
    setActiveMockState(baseState());
    setStripeStubVerifyOk(false);
    const res = await handler(
      makeWebhookRequest({
        body: '{}',
        headers: { 'stripe-signature': 't=1,v1=bogus' },
      }),
    );
    const { status, json } = await readJsonStatus(res);
    expect(status).toBe(401);
    expect(json.error?.code).toBe('UNAUTHORIZED');
  });

  it('short-circuits on duplicate event_id without re-processing', async () => {
    const state = baseState();
    // Pre-seed the event row to trigger the unique-violation path on insert.
    state.rows.stripe_webhook_events = [
      { event_id: 'evt_dup_001', event_type: 'invoice.payment_failed' },
    ];
    setActiveMockState(state);

    setStripeStubVerifyOk(true);
    setStripeStubEvent({
      id: 'evt_dup_001',
      type: 'invoice.payment_failed',
      data: { object: { customer: CUSTOMER_ID } },
    });

    const res = await handler(
      makeWebhookRequest({
        body: '{}',
        headers: { 'stripe-signature': 't=1,v1=ok' },
      }),
    );
    const { status, json } = await readJsonStatus(res);
    expect(status).toBe(200);
    expect(json.data?.received).toBe(true);
    expect(json.data?.duplicate).toBe(true);

    // No organizations.update call, no markProcessed (which is an update on
    // stripe_webhook_events with processed_at).
    expect(state.updates.filter((u) => u.table === 'organizations')).toHaveLength(0);
    expect(
      state.updates.filter((u) => u.table === 'stripe_webhook_events'),
    ).toHaveLength(0);
  });

  it('checkout.session.completed flips org to active with plan from price', async () => {
    const state = baseState();
    setActiveMockState(state);

    setStripeStubSubscription({
      id: SUB_ID,
      status: 'active',
      customer: CUSTOMER_ID,
      current_period_end: NOW + 30 * 86_400,
      items: { data: [{ price: { id: PRICE_PRO_MONTHLY } }] },
    });
    setStripeStubEvent({
      id: 'evt_chk_001',
      type: 'checkout.session.completed',
      data: {
        object: {
          customer: CUSTOMER_ID,
          subscription: SUB_ID,
        },
      },
    });

    const res = await handler(
      makeWebhookRequest({
        body: '{}',
        headers: { 'stripe-signature': 't=1,v1=ok' },
      }),
    );
    const { status, json } = await readJsonStatus(res);
    expect(status).toBe(200);
    expect(json.data?.received).toBe(true);

    // The handler must have looked up the subscription to derive the plan.
    expect(stripeStubRetrieveCalls()).toContain(SUB_ID);

    const orgUpdates = state.updates.filter((u) => u.table === 'organizations');
    expect(orgUpdates).toHaveLength(1);
    expect(orgUpdates[0].patch.subscription_status).toBe('active');
    expect(orgUpdates[0].patch.stripe_subscription_id).toBe(SUB_ID);
    expect(orgUpdates[0].patch.subscription_plan).toBe('pro_monthly');
    expect(
      orgUpdates[0].filters.some(
        (f) => f.col === 'stripe_customer_id' && f.val === CUSTOMER_ID,
      ),
    ).toBe(true);

    // processed_at stamped.
    const procUpdates = state.updates.filter(
      (u) => u.table === 'stripe_webhook_events',
    );
    expect(procUpdates).toHaveLength(1);
    expect(procUpdates[0].patch.processed_at).toBeTruthy();
  });

  it('customer.subscription.deleted flips org to canceled', async () => {
    const state = baseState();
    setActiveMockState(state);

    setStripeStubEvent({
      id: 'evt_sub_del_001',
      type: 'customer.subscription.deleted',
      data: {
        object: {
          id: SUB_ID,
          status: 'canceled',
          customer: CUSTOMER_ID,
          current_period_end: NOW,
          items: { data: [{ price: { id: PRICE_PRO_MONTHLY } }] },
        },
      },
    });

    const res = await handler(
      makeWebhookRequest({
        body: '{}',
        headers: { 'stripe-signature': 't=1,v1=ok' },
      }),
    );
    const { status } = await readJsonStatus(res);
    expect(status).toBe(200);

    const orgUpdates = state.updates.filter((u) => u.table === 'organizations');
    expect(orgUpdates).toHaveLength(1);
    expect(orgUpdates[0].patch.subscription_status).toBe('canceled');
  });

  it('invoice.payment_failed flips org to past_due', async () => {
    const state = baseState();
    setActiveMockState(state);

    setStripeStubEvent({
      id: 'evt_inv_fail_001',
      type: 'invoice.payment_failed',
      data: {
        object: {
          id: 'in_test_001',
          customer: CUSTOMER_ID,
        },
      },
    });

    const res = await handler(
      makeWebhookRequest({
        body: '{}',
        headers: { 'stripe-signature': 't=1,v1=ok' },
      }),
    );
    const { status } = await readJsonStatus(res);
    expect(status).toBe(200);

    const orgUpdates = state.updates.filter((u) => u.table === 'organizations');
    expect(orgUpdates).toHaveLength(1);
    expect(orgUpdates[0].patch.subscription_status).toBe('past_due');
  });
});
