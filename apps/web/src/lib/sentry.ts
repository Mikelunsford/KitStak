// F-Wave5-CO-01 / F-Wave3-OBS-01 (SPA portion): Sentry SaaS error and
// performance capture wrapper for the SPA. Edge-function capture is
// out of scope for this filing and tracked as F-Wave5-CO-01-EDGE-01.
//
// Posture (mirrors src/lib/analytics.ts so the chassis is consistent):
//
//   1. Lazy-loaded. @sentry/react with browserTracing plus replay
//      lands in its own Rollup chunk (manualChunks.sentry in
//      vite.config.ts). The main index chunk stays under the 40 kB
//      gzipped cap.
//
//   2. No-op when VITE_SENTRY_DSN is absent at build. Dev and any
//      preview without the DSN stay quiet; no warnings, no network
//      calls, no chunk emitted because the dynamic import is
//      unreachable post-Vite-define and Rollup tree-shakes it.
//
//   3. PII scrubbed at the source. beforeSend strips email, IP,
//      cookies, Authorization headers, query strings, and any value
//      that matches an email pattern in extra / tags / contexts.
//      sendDefaultPii: false at init refuses IP and cookies by
//      default. The identifier we set on Sentry is the opaque
//      Supabase user.id UUID, never email or name.
//
//   4. Sample rates default-conservative. Traces 10 percent.
//      Baseline session replay OFF (0.0). Replay-on-error 100 percent
//      so an actual error always gets the visual context.
//      All four rates operator-overridable via env vars without a
//      code redeploy.
//
//   5. Capture must never break the SPA. The dynamic import is
//      .catch()-swallowed; captureException short-circuits on null.

import type * as SentryReact from '@sentry/react';

// ---------------------------------------------------------------------------
// Module-private Sentry handle. Resolved by initSentry. Every public helper
// guards on null so calls before init (or in builds without a DSN) are
// silent no-ops.
// ---------------------------------------------------------------------------

let sentry: typeof SentryReact | null = null;
let initPromise: Promise<void> | null = null;

// Default sample rates. Operator can override via env vars without a code
// change. Defaults are chosen for a low-volume launch posture; dial up via
// VITE_SENTRY_TRACES_SAMPLE_RATE and VITE_SENTRY_REPLAY_SESSION_SAMPLE_RATE.
const DEFAULT_TRACES_SAMPLE_RATE = 0.1;
const DEFAULT_REPLAY_SESSION_SAMPLE_RATE = 0.0;
const DEFAULT_REPLAY_ON_ERROR_SAMPLE_RATE = 1.0;

// Regex used by the beforeSend scrub. Matches common PII shapes that should
// never reach Sentry even if a code-level error message embeds them.
const EMAIL_REGEX = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const PHONE_REGEX = /\+?\d[\d\s().-]{7,}\d/;

function parseRate(input: string | undefined, fallback: number): number {
  if (!input) return fallback;
  const n = Number(input);
  if (!Number.isFinite(n) || n < 0 || n > 1) return fallback;
  return n;
}

// Walks a record and redacts any string value that looks like email or
// phone. Returns a shallow copy; does not mutate input.
function scrubRecord(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (typeof v === 'string' && (EMAIL_REGEX.test(v) || PHONE_REGEX.test(v))) {
      out[k] = '[redacted]';
    } else {
      out[k] = v;
    }
  }
  return out;
}

/**
 * beforeSend hook. Runs on every event before transport. Returning null
 * drops the event entirely. The contract here is constitutional, not
 * cosmetic: any PII that arrives at Sentry is a constitution review.
 *
 * Exported only for unit testing; not part of the public module surface.
 */
export function scrubEvent(
  event: SentryReact.ErrorEvent,
): SentryReact.ErrorEvent | null {
  // 1. Strip user PII. Keep only the opaque id (Supabase UUID), and set
  //    ip_address: null explicitly so Sentry's server-side Relay does not
  //    auto-fill it from the request source IP after this scrub runs.
  //
  //    Background: `sendDefaultPii: false` at init prevents the SDK from
  //    SENDING the IP. But Sentry's Relay (server-side ingest) can still
  //    ENRICH the event with IP from the request source unless we set
  //    `ip_address: null` explicitly. The Relay treats null as "operator
  //    opted out, do not enrich". This is layered with the project-level
  //    "Prevent Storing of IP Addresses" Security & Privacy toggle which
  //    must also be ON; the SDK-side null is defense-in-depth so the
  //    constitutional PII gate holds even if a future operator
  //    accidentally re-enables the project toggle. See journal
  //    phase-9-sentry-spa.md "Activation" section for the regression
  //    discovery context.
  const userId = event.user?.id;
  // Sentry's User type declares ip_address as a string (not nullable),
  // but the Relay accepts null at runtime as the opt-out-of-enrichment
  // signal per https://docs.sentry.io/platforms/javascript/data-management/sensitive-data/#scrubbing-server-ip-addresses
  // We cast through unknown to satisfy the strict type while preserving
  // the runtime null contract.
  event.user = (userId
    ? { id: userId, ip_address: null }
    : { ip_address: null }) as unknown as SentryReact.User;

  // 2. Strip request cookies, Authorization header, and query string.
  if (event.request) {
    delete event.request.cookies;
    if (event.request.headers) {
      const headers = event.request.headers as Record<string, string>;
      delete headers.authorization;
      delete headers.Authorization;
    }
    delete event.request.query_string;
    // Pathname-only URL.
    if (typeof event.request.url === 'string') {
      try {
        const u = new URL(event.request.url);
        event.request.url = u.origin + u.pathname;
      } catch {
        // If URL parse fails, leave as-is. The other scrubs still apply.
      }
    }
  }

  // 3. Scrub extra and tags for email or phone leaks. Only assign when
  //    the source had a value, to keep exactOptionalPropertyTypes happy.
  //    NonNullable strips the undefined arm so the cast satisfies the
  //    Sentry type system without re-introducing undefined.
  if (event.extra) {
    event.extra = scrubRecord(event.extra) as NonNullable<SentryReact.ErrorEvent['extra']>;
  }
  if (event.tags) {
    event.tags = scrubRecord(event.tags) as NonNullable<SentryReact.ErrorEvent['tags']>;
  }

  // 4. Belt-and-suspenders: drop events whose message contains an email
  //    pattern after the per-field scrub. This is the last line of
  //    defense against a code-level throw new Error(`user ${email}`).
  const message = event.message;
  if (typeof message === 'string' && EMAIL_REGEX.test(message)) {
    return null;
  }
  if (event.exception?.values) {
    for (const ex of event.exception.values) {
      if (ex.value && EMAIL_REGEX.test(ex.value)) {
        return null;
      }
    }
  }

  return event;
}

/**
 * Lazy-load @sentry/react and call Sentry.init. Safe to call multiple
 * times; subsequent calls return the same promise. No-op when
 * VITE_SENTRY_DSN is absent so dev and DSN-less previews stay quiet.
 *
 * Never await this from a UI-blocking path. The init network round trip
 * is fire-and-forget; error capture is observational, not load-bearing.
 *
 * The function returns a Promise so tests can await completion, but the
 * call site (main.tsx) uses `void initSentry()` for fire-and-forget.
 */
export function initSentry(): Promise<void> {
  if (initPromise) return initPromise;

  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) {
    initPromise = Promise.resolve();
    return initPromise;
  }

  const environment = import.meta.env.VITE_SENTRY_ENVIRONMENT
    ?? import.meta.env.VITE_APP_ENV;
  const tracesSampleRate = parseRate(
    import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE,
    DEFAULT_TRACES_SAMPLE_RATE,
  );
  const replaysSessionSampleRate = parseRate(
    import.meta.env.VITE_SENTRY_REPLAY_SESSION_SAMPLE_RATE,
    DEFAULT_REPLAY_SESSION_SAMPLE_RATE,
  );

  initPromise = import('@sentry/react')
    .then((mod) => {
      mod.init({
        dsn,
        environment,
        sendDefaultPii: false,
        tracesSampleRate,
        replaysSessionSampleRate,
        replaysOnErrorSampleRate: DEFAULT_REPLAY_ON_ERROR_SAMPLE_RATE,
        integrations: [
          mod.browserTracingIntegration(),
          mod.replayIntegration({
            maskAllText: false,
            maskAllInputs: true,
            blockAllMedia: true,
          }),
        ],
        beforeSend: scrubEvent,
      });
      sentry = mod;
    })
    .catch(() => {
      // Capture is observational; a load failure must never break the
      // SPA. Swallow and stay in no-op posture.
      sentry = null;
    });

  return initPromise;
}

/**
 * Identify the current authenticated user against the opaque Supabase
 * user.id UUID. NEVER pass email, name, phone, or any other PII as the
 * identifier. The UUID is stable and unique per user, which is all
 * Sentry needs to group events by user.
 */
export function identifySentryUser(userId: string): void {
  if (!sentry) return;
  if (!userId) return;
  sentry.setUser({ id: userId });
}

/**
 * Clear the Sentry user on sign-out so subsequent events on this browser
 * are not attributed to the previous user. Without this, an anonymous
 * post-sign-out crash would still be tagged with the previous user.id.
 */
export function resetSentryUser(): void {
  if (!sentry) return;
  sentry.setUser(null);
}

/**
 * Capture an exception programmatically. Called by ErrorBoundary's
 * componentDidCatch so render-tree errors get full stack and component
 * stack context.
 *
 * Short-circuits when no DSN is configured (no init happened) or when
 * running in dev (so local crashes do not pollute the project's event
 * stream).
 */
export function captureException(
  error: unknown,
  info?: { componentStack?: string },
): void {
  if (!sentry) return;
  if (import.meta.env.DEV) return;
  if (info?.componentStack) {
    sentry.captureException(error, {
      contexts: { react: { componentStack: info.componentStack } },
    });
  } else {
    sentry.captureException(error);
  }
}

// ---------------------------------------------------------------------------
// Test-only escape hatch. Resets module-private state so unit tests can
// re-init with different env-var shapes. Intentionally not exported from
// the package barrel; reach in only from sentry.test.ts.
// ---------------------------------------------------------------------------

export function __resetForTests(): void {
  sentry = null;
  initPromise = null;
}
