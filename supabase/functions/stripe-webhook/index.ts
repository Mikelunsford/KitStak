// stripe-webhook: Stripe-callable webhook endpoint. Receives subscription
// lifecycle events from Stripe and reflects them onto
// `public.organizations.subscription_*` columns.
//
// Authentication: Stripe-Signature HMAC verified against
// STRIPE_WEBHOOK_SECRET via the official `stripe` npm package
// (`stripe.webhooks.constructEventAsync`). No Supabase JWT involved;
// config.toml sets `verify_jwt = false` for this function.
//
// Idempotency: every event_id is INSERTed into
// `public.stripe_webhook_events` (PK on event_id). A unique-violation
// (Postgres 23505) means we have seen this event before and return 200
// without re-processing. Stripe retries on 5xx so we MUST never let an
// already-processed event re-run.
//
// Return-200 posture: after signature verification succeeds, every error
// path returns 200 so Stripe does not retry forever. Failures leave the
// stripe_webhook_events row with `processed_at IS NULL` for operator
// replay. The Sentry capture in `_shared/sentry.ts` records the error so
// the row is not lost in silence.
//
// Handled event types route to `organizations` subscription updates; all
// other events are logged and acked.

import Stripe from 'npm:stripe@^17';

import { route, type RouteCtx } from '../_shared/route.ts';
import { admin } from '../_shared/handler-helpers.ts';
import { ApiError, fromApiError, ok } from '../_shared/responses.ts';
import { ERROR_CODES } from '../_shared/constants.ts';
import { captureException } from '../_shared/sentry.ts';

const BUNDLE = 'stripe-webhook';

// Hardcoded Stripe price-id -> internal plan slug. The product catalogue
// is fixed (6 SKUs across 3 tiers x 2 cadences) and lives in the operator's
// Stripe dashboard. When a new price is added, this map must update.
const PRICE_TO_PLAN: Record<string, string> = {
  'price_1TbmMV4KMrbWyNl1MPMQrM2a': 'starter_monthly',
  'price_1TbmSB4KMrbWyNl1QpHy3QQU': 'starter_annual',
  'price_1TbmOU4KMrbWyNl1sbGBK6qz': 'pro_monthly',
  'price_1TbmSw4KMrbWyNl1rp7mEfLc': 'pro_annual',
  'price_1TbmQD4KMrbWyNl1z7vh1f4T': 'enterprise_monthly',
  'price_1TbmTe4KMrbWyNl186ej636V': 'enterprise_annual',
};

// Resolve plan slug from a Stripe price id. Returns null for unknown prices
// so callers can decide whether to clear, retain, or refuse to write the
// column. The current handlers retain whatever is there rather than wipe
// it on an unknown price.
function planFromPriceId(priceId: string | null | undefined): string | null {
  if (!priceId) return null;
  return PRICE_TO_PLAN[priceId] ?? null;
}

// Extract the first line-item price id from a subscription event. Stripe
// subscriptions can carry multiple items; for Kitstak's flat-tier pricing
// each subscription has exactly one item, so we read items.data[0].
function priceIdFromSubscription(
  sub: Stripe.Subscription | null | undefined,
): string | null {
  const item = sub?.items?.data?.[0];
  const price = item?.price;
  if (!price) return null;
  return typeof price === 'string' ? price : price.id ?? null;
}

// Stripe's current_period_end is a unix timestamp (seconds). Postgres
// timestamptz columns want ISO 8601. Returns null for missing inputs so
// the update path can short-circuit instead of writing 'NaN'.
function periodEndIso(secondsEpoch: number | null | undefined): string | null {
  if (typeof secondsEpoch !== 'number' || !Number.isFinite(secondsEpoch)) {
    return null;
  }
  return new Date(secondsEpoch * 1000).toISOString();
}

// Returns the customer id as a string regardless of whether Stripe expanded
// the field. Used by lookup-by-stripe-customer-id queries against
// public.organizations.
function customerIdOf(
  customer: string | Stripe.Customer | Stripe.DeletedCustomer | null,
): string | null {
  if (!customer) return null;
  return typeof customer === 'string' ? customer : customer.id ?? null;
}

// Update `organizations` row matched by stripe_customer_id. Only writes the
// columns that are present in the patch (undefined values are stripped).
// Caller passes the customer id resolved from the event.
async function updateOrgByCustomer(
  customerId: string,
  patch: Record<string, string | null | undefined>,
): Promise<void> {
  const cleanPatch: Record<string, string | null> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined) cleanPatch[k] = v;
  }
  if (Object.keys(cleanPatch).length === 0) return;

  const client = admin();
  const { error } = await client
    .from('organizations')
    .update(cleanPatch)
    .eq('stripe_customer_id', customerId);
  if (error) {
    throw new Error(
      `organizations update failed for customer ${customerId}: ${error.message}`,
    );
  }
}

// Per-event-type processor. Each branch is deliberately small so the
// behaviour table in the journal stays a direct match against this switch.
async function processEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      const customerId = customerIdOf(session.customer);
      if (!customerId) return;
      const subscriptionId =
        typeof session.subscription === 'string'
          ? session.subscription
          : session.subscription?.id ?? null;
      // Pull the subscription to learn the price id + period end. Checkout
      // session itself does not carry the period end.
      let plan: string | null = null;
      let periodEnd: string | null = null;
      if (subscriptionId) {
        const stripe = stripeClient();
        const sub = await stripe.subscriptions.retrieve(subscriptionId);
        plan = planFromPriceId(priceIdFromSubscription(sub));
        periodEnd = periodEndIso(sub.current_period_end);
      }
      await updateOrgByCustomer(customerId, {
        stripe_subscription_id: subscriptionId,
        subscription_status: 'active',
        subscription_plan: plan ?? undefined,
        subscription_current_period_end: periodEnd ?? undefined,
      });
      return;
    }

    case 'customer.subscription.created': {
      const sub = event.data.object as Stripe.Subscription;
      const customerId = customerIdOf(sub.customer);
      if (!customerId) return;
      await updateOrgByCustomer(customerId, {
        stripe_subscription_id: sub.id,
        subscription_status: sub.status,
        subscription_plan: planFromPriceId(priceIdFromSubscription(sub)) ?? undefined,
        subscription_current_period_end:
          periodEndIso(sub.current_period_end) ?? undefined,
      });
      return;
    }

    case 'customer.subscription.updated': {
      const sub = event.data.object as Stripe.Subscription;
      const customerId = customerIdOf(sub.customer);
      if (!customerId) return;
      await updateOrgByCustomer(customerId, {
        subscription_status: sub.status,
        subscription_plan: planFromPriceId(priceIdFromSubscription(sub)) ?? undefined,
        subscription_current_period_end:
          periodEndIso(sub.current_period_end) ?? undefined,
      });
      return;
    }

    case 'customer.subscription.deleted': {
      const sub = event.data.object as Stripe.Subscription;
      const customerId = customerIdOf(sub.customer);
      if (!customerId) return;
      await updateOrgByCustomer(customerId, {
        subscription_status: 'canceled',
      });
      return;
    }

    case 'customer.subscription.paused': {
      const sub = event.data.object as Stripe.Subscription;
      const customerId = customerIdOf(sub.customer);
      if (!customerId) return;
      await updateOrgByCustomer(customerId, {
        subscription_status: 'paused',
      });
      return;
    }

    case 'customer.subscription.resumed': {
      const sub = event.data.object as Stripe.Subscription;
      const customerId = customerIdOf(sub.customer);
      if (!customerId) return;
      await updateOrgByCustomer(customerId, {
        subscription_status: 'active',
      });
      return;
    }

    case 'customer.subscription.trial_will_end': {
      // Log only. The SPA banner is driven by organizations.trial_ends_at
      // which is set at provisioning time. Re-deriving from the event is
      // not necessary and would race the dedicated trial sweep.
      console.log('stripe-webhook: trial_will_end', {
        event_id: event.id,
        subscription_id: (event.data.object as Stripe.Subscription).id,
      });
      return;
    }

    case 'invoice.paid': {
      // Log only. Revenue ledger lives outside this handler; duplicating
      // the accounting write here would create reconciliation drift.
      console.log('stripe-webhook: invoice.paid', { event_id: event.id });
      return;
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object as Stripe.Invoice;
      const customerId = customerIdOf(invoice.customer);
      if (!customerId) return;
      await updateOrgByCustomer(customerId, {
        subscription_status: 'past_due',
      });
      return;
    }

    default: {
      // Unhandled but acked. Stripe will not retry; we ACK 200 from the
      // caller. Operator can audit unhandled types from the
      // stripe_webhook_events table (processed_at IS NOT NULL with no
      // matching organizations.subscription_status change).
      console.log('stripe-webhook: ignored event type', {
        event_id: event.id,
        type: event.type,
      });
    }
  }
}

// Single shared Stripe client. The constructor reads STRIPE_SECRET_KEY at
// call time so missing-env returns a clear ApiError instead of throwing
// at module load. apiVersion is pinned so SDK upgrades do not silently
// change wire shapes Stripe sends us.
let cachedStripe: Stripe | null = null;
function stripeClient(): Stripe {
  if (cachedStripe) return cachedStripe;
  const key = Deno.env.get('STRIPE_SECRET_KEY');
  if (!key) {
    throw new ApiError(
      ERROR_CODES.INTERNAL_ERROR,
      500,
      'Missing STRIPE_SECRET_KEY',
    );
  }
  cachedStripe = new Stripe(key, { apiVersion: '2024-09-30.acacia' });
  return cachedStripe;
}

// Insert {event_id, event_type, payload}. Returns true on fresh insert,
// false on duplicate (23505). Other errors throw and bubble up.
async function recordEvent(event: Stripe.Event): Promise<boolean> {
  const client = admin();
  const { error } = await client
    .from('stripe_webhook_events')
    .insert({
      event_id: event.id,
      event_type: event.type,
      payload: event,
    });
  if (!error) return true;
  // Postgres unique-violation. The Supabase JS client surfaces the code in
  // error.code; the message also embeds "duplicate key value". Match on
  // code first, fall back to message snippet for defence in depth.
  const code = (error as { code?: string }).code;
  const message = error.message ?? '';
  if (code === '23505' || /duplicate key value/i.test(message)) {
    return false;
  }
  throw new Error(`stripe_webhook_events insert failed: ${message}`);
}

async function markProcessed(eventId: string): Promise<void> {
  const client = admin();
  await client
    .from('stripe_webhook_events')
    .update({ processed_at: new Date().toISOString() })
    .eq('event_id', eventId);
}

// POST / (the webhook lives at /functions/v1/stripe-webhook). The route
// table strips the bundle prefix so this handler sees `/`.
async function handleWebhook(ctx: RouteCtx): Promise<Response> {
  const { req, requestId } = ctx;

  const signature = req.headers.get('stripe-signature');
  if (!signature) {
    return fromApiError(new ApiError(ERROR_CODES.UNAUTHORIZED, 401, 'Missing Stripe-Signature header'));
  }

  const secret = Deno.env.get('STRIPE_WEBHOOK_SECRET');
  if (!secret) {
    // No secret configured server-side. This is a server misconfiguration
    // and must NOT be ACKed 200 (otherwise events would silently drop on
    // a fresh deploy that forgot the env var). 500 makes Stripe retry,
    // which is the correct posture until the operator fixes the env.
    return fromApiError(
      new ApiError(ERROR_CODES.INTERNAL_ERROR, 500, 'Missing STRIPE_WEBHOOK_SECRET'),
    );
  }

  const rawBody = await req.text();

  // Verify signature using the official SDK. constructEventAsync is the
  // Deno-compatible variant; the sync constructEvent uses Node's crypto
  // module which is not available in Supabase Edge runtime.
  let event: Stripe.Event;
  try {
    event = await stripeClient().webhooks.constructEventAsync(
      rawBody,
      signature,
      secret,
    );
  } catch (err) {
    // Verification failure. 401 is the correct posture: Stripe-Signature
    // is the auth-equivalent for this endpoint.
    const message = err instanceof Error ? err.message : String(err);
    return fromApiError(
      new ApiError(ERROR_CODES.UNAUTHORIZED, 401, `Signature verification failed: ${message}`),
    );
  }

  // Idempotency: persist the event row. Duplicate event_id short-circuits
  // to 200 without re-processing.
  let fresh: boolean;
  try {
    fresh = await recordEvent(event);
  } catch (err) {
    // Insert failure that is not a duplicate. Capture and ACK 200 so
    // Stripe does not retry forever; the row will not exist either, so
    // operator replay is by event-id from Stripe's dashboard.
    captureException(err, {
      route: '/',
      method: req.method,
      bundle: BUNDLE,
      request_id: requestId,
    });
    return ok({ received: true });
  }

  if (!fresh) {
    // Duplicate. Ack 200; no re-processing.
    return ok({ received: true, duplicate: true });
  }

  // Process the event. Errors from here are captured but ACKed 200; the
  // row stays with processed_at IS NULL for manual replay.
  try {
    await processEvent(event);
    await markProcessed(event.id);
  } catch (err) {
    captureException(err, {
      route: '/',
      method: req.method,
      bundle: BUNDLE,
      request_id: requestId,
      url: ctx.url.origin + ctx.url.pathname,
    });
    // Leave processed_at NULL so the row is visible for replay.
  }

  return ok({ received: true });
}

Deno.serve((req: Request) =>
  route(
    req,
    [
      { method: 'POST', path: '/', handler: handleWebhook },
    ],
    { bundle: BUNDLE },
  ),
);
