// Stripe SDK stub for regression tests.
//
// The Kitstak edge function imports `npm:stripe@^17` (Deno-style specifier).
// The vitest regression config rewrites that specifier to this file so the
// Node-flavoured test harness can run without installing the Stripe Node
// SDK. The stub reproduces only the surface the stripe-webhook bundle
// actually uses:
//
//   new Stripe(secretKey, { apiVersion })
//   stripe.webhooks.constructEventAsync(rawBody, signature, secret)
//     -> resolves to a Stripe.Event when state says verify-ok, throws when
//        state says verify-fail. Tests toggle the state via setStripeStub*.
//   stripe.subscriptions.retrieve(id)
//     -> returns a Stripe.Subscription from the per-test stub state.
//
// The types module re-exports the same shapes so handler code using
// `Stripe.Event` / `Stripe.Subscription` etc. compiles.

interface SubscriptionItemPrice { id: string }
interface SubscriptionItem { price: SubscriptionItemPrice }
interface SubscriptionLike {
  id: string;
  status: string;
  customer: string;
  current_period_end: number;
  items: { data: SubscriptionItem[] };
}

interface StubState {
  verifyOk: boolean;
  event: Record<string, unknown> | null;
  subscriptions: Record<string, SubscriptionLike>;
  retrieveCalls: string[];
}

const stubState: StubState = {
  verifyOk: true,
  event: null,
  subscriptions: {},
  retrieveCalls: [],
};

export function setStripeStubVerifyOk(ok: boolean): void {
  stubState.verifyOk = ok;
}
export function setStripeStubEvent(event: Record<string, unknown>): void {
  stubState.event = event;
}
export function setStripeStubSubscription(sub: SubscriptionLike): void {
  stubState.subscriptions[sub.id] = sub;
}
export function resetStripeStub(): void {
  stubState.verifyOk = true;
  stubState.event = null;
  stubState.subscriptions = {};
  stubState.retrieveCalls = [];
}
export function stripeStubRetrieveCalls(): readonly string[] {
  return stubState.retrieveCalls;
}

class StripeMock {
  webhooks = {
    constructEventAsync: async (
      _rawBody: string,
      _signature: string,
      _secret: string,
    ): Promise<Record<string, unknown>> => {
      if (!stubState.verifyOk) {
        throw new Error('Signature verification stub: invalid');
      }
      if (!stubState.event) {
        throw new Error('Stripe stub event not set');
      }
      return stubState.event;
    },
  };

  subscriptions = {
    retrieve: async (id: string): Promise<SubscriptionLike> => {
      stubState.retrieveCalls.push(id);
      const sub = stubState.subscriptions[id];
      if (!sub) throw new Error(`Stripe stub subscription not set: ${id}`);
      return sub;
    },
  };

  // ESM-style default export hook for `import Stripe from 'npm:stripe@^17'`.
}

export default StripeMock;
