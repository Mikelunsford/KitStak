// F-Wave5-CO-02: PostHog analytics wrapper for the SPA.
//
// Posture:
//
//   1. Lazy-loaded. posthog-js is ~30 kB gzipped. We dynamic-import it
//      inside initAnalytics so it lands in its own Rollup chunk and never
//      grows the main index chunk above the 40 kB cap.
//
//   2. No-op when env keys are absent. Dev and staging without an API key
//      stay quiet; no warnings, no network calls.
//
//   3. Bounded event surface. Exactly 5 funnel events are typed in the
//      AnalyticsEvent union. New events go through a follow-up filing,
//      not a freehand call site.
//
//   4. No PII in event properties. Identifier is the Supabase user.id
//      UUID. Monetary amounts are bucketed (under_1k / 1k_to_10k /
//      10k_to_100k / over_100k) so absolute dollar values never leave
//      the SPA. Email / name / phone / address never appear in any
//      property shape exported from this module.
//
//   5. Session recording masks all inputs. Forms (signin, customer
//      contact data, money) never replay raw keystrokes.

import type { PostHog } from 'posthog-js';

// ---------------------------------------------------------------------------
// Event canon (bounded surface). Adding an event here requires a follow-up
// filing plus a constitution-review note.
// ---------------------------------------------------------------------------

export type AnalyticsEvent =
  | 'signed_in'
  | 'quote_sent'
  | 'project_converted'
  | 'invoice_sent'
  | 'payment_received';

export type AnalyticsPropValue = string | number | boolean | null;

export type AnalyticsProps = Record<string, AnalyticsPropValue>;

// Amount buckets. Boundaries declared as named cent constants so the
// bucket function itself is the only place that converts a money value
// into a coarse label.
const ONE_K_CENTS = 1_000_00;
const TEN_K_CENTS = 10_000_00;
const HUNDRED_K_CENTS = 100_000_00;

export type AmountBucket = 'under_1k' | '1k_to_10k' | '10k_to_100k' | 'over_100k';

/**
 * Coerce a cents value (number or numeric string per the canon's
 * FinanceCentsSchema shape) into a coarse bucket label. Never returns
 * the raw value. Negative or NaN inputs land in `under_1k`.
 */
export function bucketCents(input: number | string | bigint | null | undefined): AmountBucket {
  const n = typeof input === 'number'
    ? input
    : typeof input === 'string'
      ? Number(input)
      : typeof input === 'bigint'
        ? Number(input)
        : 0;
  if (!Number.isFinite(n) || n < ONE_K_CENTS) return 'under_1k';
  if (n < TEN_K_CENTS) return '1k_to_10k';
  if (n < HUNDRED_K_CENTS) return '10k_to_100k';
  return 'over_100k';
}

// ---------------------------------------------------------------------------
// Module-private posthog handle. Resolved by initAnalytics. Every public
// helper guards on null so calls before init (or in dev without a key)
// are silent no-ops.
// ---------------------------------------------------------------------------

let posthog: PostHog | null = null;
let initPromise: Promise<void> | null = null;

/**
 * Lazy-load posthog-js and call posthog.init. Safe to call multiple
 * times; subsequent calls return the same promise. No-op when
 * VITE_POSTHOG_KEY is absent so dev / staging without analytics stay
 * quiet.
 *
 * Never await this from a UI-blocking path. The init network round trip
 * is fire-and-forget; analytics is observational, not load-bearing.
 */
export function initAnalytics(): Promise<void> {
  if (initPromise) return initPromise;

  const key = import.meta.env.VITE_POSTHOG_KEY;
  if (!key) {
    initPromise = Promise.resolve();
    return initPromise;
  }

  const host = import.meta.env.VITE_POSTHOG_HOST ?? 'https://us.i.posthog.com';

  initPromise = import('posthog-js')
    .then((mod) => {
      const ph = mod.default ?? mod;
      ph.init(key, {
        api_host: host,
        autocapture: true,
        capture_pageview: true,
        disable_session_recording: false,
        session_recording: {
          maskAllInputs: true,
        },
        persistence: 'localStorage+cookie',
      });
      posthog = ph as unknown as PostHog;
    })
    .catch(() => {
      // Analytics is observational; a load failure must never break
      // the SPA. Swallow and stay in no-op posture.
      posthog = null;
    });

  return initPromise;
}

/**
 * Identify the current authenticated user against the opaque Supabase
 * user.id UUID. NEVER pass email, name, phone, or any other PII as the
 * identifier. The id is stable and unique per user, which is all
 * PostHog needs to stitch sessions.
 */
export function identifyUser(userId: string): void {
  if (!posthog) return;
  if (!userId) return;
  posthog.identify(userId);
}

/**
 * Reset the anonymous-session token on sign-out so the next sign-in
 * starts a fresh distinct_id. Without this, an anonymous browser would
 * keep accumulating events against the previous user's identity.
 */
export function resetAnalytics(): void {
  if (!posthog) return;
  posthog.reset();
}

/**
 * Emit one of the 5 funnel events. Properties are limited to scalar
 * values (string / number / boolean / null) by the AnalyticsPropValue
 * type so call sites cannot accidentally ship nested PII-rich objects.
 *
 * No raw monetary amounts. Bucket via bucketCents at the call site.
 */
export function track(event: AnalyticsEvent, properties?: AnalyticsProps): void {
  if (!posthog) return;
  posthog.capture(event, properties);
}
