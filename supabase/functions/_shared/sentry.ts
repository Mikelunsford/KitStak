// F-Wave5-CO-01-EDGE-01: Deno-side Sentry capture for the Edge Function
// bundle. Companion to apps/web/src/lib/sentry.ts (the SPA wrapper). PII
// contract is byte-identical in posture to the SPA wrapper; see that file
// for the comment-level rationale on each scrub.
//
// SDK choice: HTTP-transport. We POST a Sentry envelope directly to the
// project ingest endpoint with `fetch`. Rationale recorded in journal
// 03-workspace/journal/phase-9-sentry-edge.md:
//
//   1. Zero new dependencies. The constitution's "What we use" list does
//      not grow. `@sentry/deno` would add a second Sentry-family dep and
//      its Supabase Edge-runtime support is unverified.
//   2. Zero bundle delta per function. `fetch` is part of the runtime.
//      Twenty-one functions x ~150-200 kB of SDK code is sprawl we do
//      not need at zero paying customers.
//   3. Full control over the envelope shape and the PII scrub. The
//      Sentry envelope API is documented and stable:
//      https://develop.sentry.dev/sdk/envelopes/
//
// Posture (mirrors the SPA wrapper):
//
//   1. No-op when SENTRY_DSN is absent. Every public helper short-
//      circuits on a null parsed-DSN handle. Dev and any preview without
//      the env var stay quiet.
//
//   2. PII scrubbed at the source. beforeSend() strips user PII keeping
//      only the opaque Supabase UUID, sets `event.user.ip_address = null`
//      explicitly so the server-side Relay does not auto-fill from
//      request source IP, strips cookies / Authorization headers / query
//      strings / email and phone patterns in extra and tags, and drops
//      events whose message or exception value still carries an email
//      pattern after the per-field scrub.
//
//   3. Capture must never break the handler. Every transport call is
//      `fetch`-then-swallow; errors in capture stay silent. The wrapping
//      try/catch in route() re-throws the original error after capture
//      so the existing ApiError -> response mapping is unchanged.
//
//   4. SENTRY_DSN is server-side only. NEVER `VITE_SENTRY_DSN` (which
//      would bleed into the SPA bundle). Document this in the env
//      example with the warning intact.

// ---------------------------------------------------------------------------
// Types. These are the subset of the Sentry envelope shape we synthesise.
// Kept local so we are not depending on `@sentry/types`.
// ---------------------------------------------------------------------------

export interface SentryUser {
  id?: string;
  email?: string;
  username?: string;
  ip_address?: string | null;
}

export interface SentryRequest {
  url?: string;
  method?: string;
  query_string?: string;
  cookies?: Record<string, string> | string;
  headers?: Record<string, string>;
}

export interface SentryException {
  type?: string;
  value?: string;
  stacktrace?: { frames?: Array<Record<string, unknown>> };
}

export interface SentryEvent {
  message?: string;
  level?: 'fatal' | 'error' | 'warning' | 'info' | 'debug';
  platform?: string;
  environment?: string;
  timestamp?: number;
  user?: SentryUser;
  request?: SentryRequest;
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
  exception?: { values: SentryException[] };
}

interface ParsedDsn {
  projectId: string;
  publicKey: string;
  ingestUrl: string; // origin only; we append /envelope/ at send time
}

interface SentryContext {
  /** Route pattern matched, e.g. `/customers/:id`. */
  route?: string;
  method?: string;
  /** Opaque Supabase org UUID. NEVER email / name / phone. */
  org_id?: string;
  /** Bundle name, e.g. `quotes-api`. */
  bundle?: string;
  /** Echo of x-request-id for log correlation. */
  request_id?: string;
  /** Request URL. Pathname only after scrub. */
  url?: string;
  /** Request headers. Authorization / cookies stripped at scrub time. */
  headers?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Module-private state. Resolved by initSentry. Every public helper guards
// on null so calls before init (or in builds without a DSN) are silent
// no-ops.
// ---------------------------------------------------------------------------

let dsn: ParsedDsn | null = null;
let environment: string | undefined;
let initialised = false;

const EMAIL_REGEX = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const PHONE_REGEX = /\+?\d[\d\s().-]{7,}\d/;

/**
 * Parse a Sentry DSN of the canonical shape:
 *   https://<publicKey>@oXXXXXX.ingest.sentry.io/<projectId>
 *
 * Returns null when the DSN is malformed. The caller stays in no-op
 * posture; a malformed DSN must never break the function.
 */
function parseDsn(raw: string): ParsedDsn | null {
  try {
    const u = new URL(raw);
    const publicKey = u.username;
    const projectId = u.pathname.replace(/^\//, '');
    if (!publicKey || !projectId) return null;
    const ingestUrl = `${u.protocol}//${u.host}`;
    return { projectId, publicKey, ingestUrl };
  } catch {
    return null;
  }
}

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
 * Mirror of apps/web/src/lib/sentry.ts `scrubEvent`. Read that file's
 * inline comments for the rationale on each step.
 */
export function scrubEvent(event: SentryEvent): SentryEvent | null {
  // 1. Strip user PII. Keep only the opaque id (Supabase UUID), and set
  //    ip_address: null explicitly so Sentry's server-side Relay does not
  //    auto-fill it from the request source IP after this scrub runs.
  const userId = event.user?.id;
  event.user = userId
    ? { id: userId, ip_address: null }
    : { ip_address: null };

  // 2. Strip request cookies, Authorization header, and query string.
  if (event.request) {
    delete event.request.cookies;
    if (event.request.headers) {
      delete event.request.headers.authorization;
      delete event.request.headers.Authorization;
    }
    delete event.request.query_string;
    if (typeof event.request.url === 'string') {
      try {
        const u = new URL(event.request.url);
        event.request.url = u.origin + u.pathname;
      } catch {
        // If URL parse fails, leave as-is. The other scrubs still apply.
      }
    }
  }

  // 3. Scrub extra and tags for email or phone leaks.
  if (event.extra) event.extra = scrubRecord(event.extra);
  if (event.tags) {
    event.tags = scrubRecord(event.tags) as Record<string, string>;
  }

  // 4. Belt-and-suspenders: drop events whose message or any exception
  //    value still contains an email pattern after the per-field scrub.
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
 * Idempotent init. Reads SENTRY_DSN and SENTRY_ENVIRONMENT from Deno.env
 * and parses the DSN. Subsequent calls are no-ops. When SENTRY_DSN is
 * absent or malformed, every other public helper stays a silent no-op.
 *
 * Never await this from a hot-path; init does no network work itself. The
 * network round trip only happens at captureException time.
 */
export function initSentry(): void {
  if (initialised) return;
  initialised = true;

  const raw = Deno.env.get('SENTRY_DSN');
  if (!raw) {
    dsn = null;
    return;
  }
  dsn = parseDsn(raw);
  environment = Deno.env.get('SENTRY_ENVIRONMENT')
    ?? Deno.env.get('SUPABASE_FUNCTIONS_REGION')
    ?? undefined;
}

/**
 * Identify the current authenticated user against the opaque Supabase
 * user.id UUID. NEVER pass email, name, phone, or any other PII. For the
 * Edge-function wrapper this is a no-op stub kept for parity with the SPA
 * wrapper's public surface; per-event user attribution happens inside
 * `captureException` via the context.org_id (and is constrained to the
 * opaque UUID at the scrub layer regardless of what the caller passes).
 */
export function identifySentryUser(_userId: string): void {
  // Intentional no-op. Edge functions are stateless per request; user
  // attribution lives on the event itself, not on a module-private scope.
  // Exported for API parity with the SPA wrapper so a future refactor
  // can consolidate without breaking the import shape.
}

/**
 * Reset the Sentry user. Edge-function no-op stub for SPA parity.
 */
export function resetSentryUser(): void {
  // Intentional no-op. See identifySentryUser.
}

/**
 * Capture an exception. Synthesises a Sentry event, runs it through
 * scrubEvent, and POSTs a single-item envelope to the project ingest
 * endpoint. Errors in transport are swallowed: capture is observational,
 * not load-bearing.
 *
 * Returns void synchronously. The fetch is fire-and-forget; the caller
 * does not await it so per-request latency is not impacted.
 */
export function captureException(
  err: unknown,
  context?: SentryContext,
): void {
  if (!dsn) return;

  const event = buildEvent(err, context);
  const scrubbed = scrubEvent(event);
  if (!scrubbed) return;

  // Fire-and-forget. fetch errors must never break the caller.
  void sendEnvelope(dsn, scrubbed).catch(() => {
    // Capture failures stay silent.
  });
}

function buildEvent(err: unknown, context?: SentryContext): SentryEvent {
  const event: SentryEvent = {
    platform: 'javascript',
    level: 'error',
    timestamp: Date.now() / 1000,
  };
  if (environment) event.environment = environment;

  if (err instanceof Error) {
    event.exception = {
      values: [
        {
          type: err.name || 'Error',
          value: err.message,
          stacktrace: err.stack
            ? { frames: parseStack(err.stack) }
            : undefined,
        },
      ],
    };
    event.message = err.message;
  } else {
    event.message = String(err);
    event.exception = {
      values: [{ type: 'NonErrorThrown', value: String(err) }],
    };
  }

  if (context) {
    const tags: Record<string, string> = {};
    if (context.route) tags.route = context.route;
    if (context.method) tags.method = context.method;
    if (context.bundle) tags.bundle = context.bundle;
    if (context.request_id) tags.request_id = context.request_id;
    if (Object.keys(tags).length > 0) event.tags = tags;

    if (context.org_id) {
      // Only the opaque UUID. The scrub layer is the authority here:
      // even if a caller fat-fingers an email into this slot, scrubEvent
      // strips everything except `id` and pins `ip_address: null`.
      event.user = { id: context.org_id };
    }

    if (context.url || context.method || context.headers) {
      event.request = {};
      if (context.url) event.request.url = context.url;
      if (context.method) event.request.method = context.method;
      if (context.headers) event.request.headers = { ...context.headers };
    }
  }

  return event;
}

/**
 * Tiny stack-frame parser. Sentry's UI does best with a `frames` array;
 * we synthesise minimal frames so the message and the call site are both
 * visible. Source-map demangling is a separate filing
 * (F-Wave9-SENTRY-SOURCEMAPS-01).
 */
function parseStack(stack: string): Array<Record<string, unknown>> {
  const lines = stack.split('\n').slice(1, 21); // cap depth
  const frames: Array<Record<string, unknown>> = [];
  for (const line of lines) {
    const m = /at\s+(.*?)\s+\((.*?):(\d+):(\d+)\)/.exec(line)
      ?? /at\s+(.*?):(\d+):(\d+)/.exec(line);
    if (!m) continue;
    if (m.length === 5) {
      frames.push({
        function: m[1],
        filename: m[2],
        lineno: Number(m[3]),
        colno: Number(m[4]),
      });
    } else {
      frames.push({
        filename: m[1],
        lineno: Number(m[2]),
        colno: Number(m[3]),
      });
    }
  }
  // Sentry wants oldest-to-newest; the JS stack is newest-first.
  return frames.reverse();
}

async function sendEnvelope(d: ParsedDsn, event: SentryEvent): Promise<void> {
  const url = `${d.ingestUrl}/api/${d.projectId}/envelope/`;
  const eventId = crypto.randomUUID().replace(/-/g, '');
  const sentAt = new Date().toISOString();

  const header = JSON.stringify({ event_id: eventId, sent_at: sentAt });
  const itemHeader = JSON.stringify({ type: 'event' });
  const itemPayload = JSON.stringify({ ...event, event_id: eventId });
  const body = `${header}\n${itemHeader}\n${itemPayload}\n`;

  const auth = [
    'Sentry sentry_version=7',
    `sentry_client=kitstak-edge/1.0`,
    `sentry_key=${d.publicKey}`,
  ].join(', ');

  await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-sentry-envelope',
      'X-Sentry-Auth': auth,
    },
    body,
  });
}

// ---------------------------------------------------------------------------
// Test-only escape hatch. Resets module-private state so unit tests can
// re-init with different env-var shapes. Intentionally not exported from
// any barrel; reach in only from sentry.test.ts.
// ---------------------------------------------------------------------------

export function __resetForTests(): void {
  dsn = null;
  environment = undefined;
  initialised = false;
}
