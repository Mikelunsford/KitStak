// Active Stripe client mock. The Vitest regression config rewrites the
// bare `stripe` specifier (mapped via supabase/functions/deno.json to
// npm:stripe@^17 in production) to this module so edge handlers that
// `import Stripe from 'stripe'` get an in-memory double.
//
// Tests set the active mock via setActiveStripeMock(...) before invoking
// the handler. The default export is a constructor that returns the active
// mock, mirroring the `new Stripe(secret)` call shape.

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

export interface StripeMockState {
  customersCreateCalls: StripeCustomersCreateArgs[];
  customersCreateResult: StripeCustomer;
  checkoutSessionCalls: StripeCheckoutSessionArgs[];
  checkoutSessionResult: StripeCheckoutSession;
  billingPortalCalls: StripeBillingPortalSessionArgs[];
  billingPortalResult: StripeBillingPortalSession;
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

class FakeStripe {
  // The handler reads `Deno.env.get('STRIPE_SECRET_KEY')` first; the
  // constructor only needs to accept the arg.
  constructor(_secret: string) {
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
}

export default FakeStripe;
