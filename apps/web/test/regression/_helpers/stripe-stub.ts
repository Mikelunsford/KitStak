// Active Stripe client mock. The Vitest regression config rewrites the
// bare `stripe` specifier (mapped via supabase/functions/deno.json to
// npm:stripe@^17 in production) to this module so edge handlers that
// `import Stripe from 'stripe'` get an in-memory double.
//
// Tests set the active mock via setActiveStripeMock(...) before invoking
// the handler. The default export is a constructor that returns the active
// mock, mirroring the `new Stripe(secret)` call shape.
//
// Surfaces covered:
//   - customers.create               (billing-api: provision customer)
//   - checkout.sessions.create       (billing-api: checkout link)
//   - billingPortal.sessions.create  (billing-api: portal link)
//   - webhooks.constructEventAsync   (stripe-webhook: verify signature)
//   - subscriptions.retrieve         (stripe-webhook: hydrate subscription)

export interface StripeCustomersCreateArgs {
  email?: string;
  metadata?: Record<string, string>;
}

export interface StripeCustomer {
  id: string;
}

export interface StripeCheckoutSessionArgs {
  mode?: string;
  customer?: string;
  line_items?: Array<{ price?: string; quantity?: number }>;
  success_url?: string;
  cancel_url?: string;
  client_reference_id?: string;
  allow_promotion_codes?: boolean;
  automatic_tax?: { enabled?: boolean };
  billing_address_collection?: string;
}

export interface StripeCheckoutSession {
  id: string;
  url: string | null;
}

export interface StripeBillingPortalSessionArgs {
  customer?: string;
  return_url?: string;
}

export interface StripeBillingPortalSession {
  id: string;
  url: string | null;
}

export interface StripeSubscriptionItemPrice {
  id: string;
}
export interface StripeSubscriptionItem {
  price: StripeSubscriptionItemPrice;
}
export interface StripeSubscriptionLike {
  id: string;
  status: string;
  customer: string;
  current_period_end: number;
  items: { data: StripeSubscriptionItem[] };
}

export interface StripeMockState {
  customersCreateCalls: StripeCustomersCreateArgs[];
  customersCreateResult: StripeCustomer;
  checkoutSessionCalls: StripeCheckoutSessionArgs[];
  checkoutSessionResult: StripeCheckoutSession;
  billingPortalCalls: StripeBillingPortalSessionArgs[];
  billingPortalResult: StripeBillingPortalSession;
  // Webhook surface (stripe-webhook bundle).
  webhookVerifyOk: boolean;
  webhookEvent: Record<string, unknown> | null;
  subscriptions: Record<string, StripeSubscriptionLike>;
  subscriptionsRetrieveCalls: string[];
}

export function makeStripeMockState(
  overrides: Partial<StripeMockState> = {},
): StripeMockState {
  return {
    customersCreateCalls: [],
    customersCreateResult: { id: 'cus_default_test' },
    checkoutSessionCalls: [],
    checkoutSessionResult: {
      id: 'cs_test_default',
      url: 'https://checkout.stripe.test/cs_test_default',
    },
    billingPortalCalls: [],
    billingPortalResult: {
      id: 'bps_test_default',
      url: 'https://billing.stripe.test/bps_test_default',
    },
    webhookVerifyOk: true,
    webhookEvent: null,
    subscriptions: {},
    subscriptionsRetrieveCalls: [],
    ...overrides,
  };
}

let active: StripeMockState | null = null;

export function setActiveStripeMock(state: StripeMockState): void {
  active = state;
}

export function clearActiveStripeMock(): void {
  active = null;
}

function requireActive(): StripeMockState {
  if (!active) {
    throw new Error(
      'No active Stripe mock state. Call setActiveStripeMock(state) before invoking the handler.',
    );
  }
  return active;
}

// Convenience setters for stripe-webhook tests. Webhook tests do not always
// call setActiveStripeMock explicitly (the webhook surface predates the
// per-test state pattern); these auto-install a default state on first use so
// the calling test keeps working.
function activeOrInit(): StripeMockState {
  if (!active) active = makeStripeMockState();
  return active;
}
export function setStripeStubVerifyOk(ok: boolean): void {
  activeOrInit().webhookVerifyOk = ok;
}
export function setStripeStubEvent(event: Record<string, unknown>): void {
  activeOrInit().webhookEvent = event;
}
export function setStripeStubSubscription(sub: StripeSubscriptionLike): void {
  activeOrInit().subscriptions[sub.id] = sub;
}
export function stripeStubRetrieveCalls(): readonly string[] {
  return activeOrInit().subscriptionsRetrieveCalls;
}

// Webhook-side reset hook. Clears active state so the next test's
// setActiveStripeMock starts fresh. Safe no-op when no active mock is
// installed.
export function resetStripeStub(): void {
  active = null;
}

class FakeStripe {
  // The handler reads `Deno.env.get('STRIPE_SECRET_KEY')` first; the
  // constructor only needs to accept the arg.
  constructor(_secret: string, _opts?: { apiVersion?: string }) {
    /* no-op */
  }

  customers = {
    create: async (
      args: StripeCustomersCreateArgs,
    ): Promise<StripeCustomer> => {
      const state = requireActive();
      state.customersCreateCalls.push(args);
      return state.customersCreateResult;
    },
  };

  checkout = {
    sessions: {
      create: async (
        args: StripeCheckoutSessionArgs,
      ): Promise<StripeCheckoutSession> => {
        const state = requireActive();
        state.checkoutSessionCalls.push(args);
        return state.checkoutSessionResult;
      },
    },
  };

  billingPortal = {
    sessions: {
      create: async (
        args: StripeBillingPortalSessionArgs,
      ): Promise<StripeBillingPortalSession> => {
        const state = requireActive();
        state.billingPortalCalls.push(args);
        return state.billingPortalResult;
      },
    },
  };

  webhooks = {
    constructEventAsync: async (
      _rawBody: string,
      _signature: string,
      _secret: string,
    ): Promise<Record<string, unknown>> => {
      const state = requireActive();
      if (!state.webhookVerifyOk) {
        throw new Error('Signature verification stub: invalid');
      }
      if (!state.webhookEvent) {
        throw new Error('Stripe stub event not set');
      }
      return state.webhookEvent;
    },
  };

  subscriptions = {
    retrieve: async (id: string): Promise<StripeSubscriptionLike> => {
      const state = requireActive();
      state.subscriptionsRetrieveCalls.push(id);
      const sub = state.subscriptions[id];
      if (!sub) throw new Error(`Stripe stub subscription not set: ${id}`);
      return sub;
    },
  };
}

export default FakeStripe;
