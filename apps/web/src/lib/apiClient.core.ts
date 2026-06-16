// Env-independent core of the single fetch wrapper.
//
// `apiClient.ts` reads Supabase env vars and imports the Supabase client at
// module load, which throws when those env vars are absent (e.g. under Vitest
// with no setup file). To keep the request/parse/retry contract unit-testable
// without standing up env or a Supabase session, the pure pieces live here and
// `apiClient.ts` re-exports them. Nothing in this module touches
// `import.meta.env` or the Supabase client.

import { z } from 'zod';

import { ERROR_CODES, HTTP_HEADERS } from '@/lib/constants';

export const EnvelopeSchema = z.object({
  data: z.unknown(),
  meta: z.record(z.unknown()).optional(),
});

export const ErrorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.unknown()).optional(),
    request_id: z.string().optional(),
  }),
});

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: Record<string, unknown> | undefined;
  readonly requestId?: string | undefined;

  constructor(
    code: string,
    status: number,
    message: string,
    details?: Record<string, unknown>,
    requestId?: string,
  ) {
    super(message);
    this.code = code;
    this.status = status;
    if (details !== undefined) this.details = details;
    if (requestId !== undefined) this.requestId = requestId;
  }
}

/**
 * R-W13-UX-03(a): bounded idempotent auto-retry on transient failures.
 *
 * A single retry covers the common transient blip (DNS hiccup, dropped
 * keep-alive socket, a 5xx from a cold edge instance) without surfacing a
 * spurious error to the operator. Two properties keep the retry safe:
 *
 *   1. We retry the SAME `init` object. For non-GET requests the
 *      Idempotency-Key was minted once before the first attempt and lives
 *      inside `init.headers`, so the retry carries the identical key. The
 *      server idempotency contract dedupes a replayed key (same key plus
 *      same body hash returns the stored result, never a second write), so
 *      a non-GET retry can never double-apply.
 *
 *   2. We retry only on transient signals: a thrown fetch error (network
 *      layer, the browser never got an HTTP response), a 5xx server status,
 *      or a 429 rate limit. A non-429 4xx is a deterministic client error
 *      (validation, auth, not-found, idempotency conflict); retrying it would
 *      only repeat the same failure, so we let it through on the first
 *      response. A 429 IS retried, but unlike a network error or 5xx (which
 *      replay immediately) it first waits out the server Retry-After
 *      (delay-seconds or HTTP-date, capped) so the replay never amplifies the
 *      overload (F-Wave13-RETRY-AFTER-429-01).
 */
export const MAX_RETRIES = 1;

/** 429 Too Many Requests: retried after honoring Retry-After, not immediately. */
export const TOO_MANY_REQUESTS = 429;

/**
 * Retry-After backoff bounds for a 429 replay. When the server sends no
 * Retry-After (or an unparseable one) we wait a short default before the single
 * bounded retry; we never block the UI longer than the cap even if the server
 * asks for more.
 */
export const RETRY_AFTER_DEFAULT_MS = 1_000;
export const RETRY_AFTER_MAX_MS = 60_000;

/**
 * HTTP statuses safe to replay IMMEDIATELY (no backoff): 5xx server errors only.
 * 429 is excluded here on purpose because it is retried on a separate path that
 * first waits out the server Retry-After (see executeRequest).
 */
export function isRetryableStatus(status: number): boolean {
  return status >= 500 && status <= 599;
}

/**
 * Parse an HTTP Retry-After header value into a wait in milliseconds, or null
 * when absent/unparseable so the caller can fall back to a default. Supports
 * both RFC 7231 §7.1.3 forms: delay-seconds (a non-negative integer count of
 * seconds) and HTTP-date (an absolute time, taken relative to `nowMs`, never
 * negative). Pure (takes `nowMs`) so the date branch is deterministically
 * testable.
 */
export function parseRetryAfterMs(value: string | null, nowMs: number): number | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  // delay-seconds: an integer number of seconds (no sign, no fraction).
  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed) * 1000;
  }
  // A numeric-looking value that is not a bare integer (a fraction like "1.5",
  // a sign, a stray dot) is a malformed delay-seconds, never an HTTP-date.
  // Reject it so the caller applies the default backoff, rather than letting
  // Date.parse misread it (Date.parse("1.5") yields a year-2001 instant, which
  // clamps to a 0ms wait and defeats the backoff).
  if (/^[\d.+-]+$/.test(trimmed)) return null;
  // HTTP-date: wait until that instant (clamped at zero for an already-past date).
  const dateMs = Date.parse(trimmed);
  if (Number.isNaN(dateMs)) return null;
  return Math.max(0, dateMs - nowMs);
}

/**
 * The bounded wait before a 429 replay: the parsed Retry-After (or the default
 * when missing/unparseable), capped so a hostile or buggy header can never
 * freeze the UI.
 */
export function retryAfterDelayMs(value: string | null, nowMs: number): number {
  const parsed = parseRetryAfterMs(value, nowMs);
  const base = parsed ?? RETRY_AFTER_DEFAULT_MS;
  return Math.min(base, RETRY_AFTER_MAX_MS);
}

export type SleepImpl = (ms: number) => Promise<void>;

const defaultSleep: SleepImpl = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export type FetchImpl = (
  input: string,
  init: RequestInit,
) => Promise<Response>;

/**
 * Parse a single fetch Response into the unwrapped envelope payload, or throw
 * an ApiError. Shared by both the first attempt and any retry so the parsing
 * contract cannot drift between them.
 */
export async function parseResponse<T>(response: Response): Promise<T> {
  const requestId = response.headers.get(HTTP_HEADERS.X_REQUEST_ID) ?? undefined;
  const json = (await response.json()) as unknown;

  if (!response.ok) {
    const parsed = ErrorEnvelopeSchema.safeParse(json);
    if (parsed.success) {
      const detailsArg =
        parsed.data.error.details !== undefined ? parsed.data.error.details : undefined;
      const requestIdArg = parsed.data.error.request_id ?? requestId;
      throw new ApiError(
        parsed.data.error.code,
        response.status,
        parsed.data.error.message,
        detailsArg,
        requestIdArg,
      );
    }
    throw new ApiError(
      ERROR_CODES.INTERNAL_ERROR,
      response.status,
      'Unexpected error',
      undefined,
      requestId,
    );
  }

  const parsed = EnvelopeSchema.safeParse(json);
  if (!parsed.success) {
    throw new ApiError('INVALID_ENVELOPE', 500, 'Invalid response envelope');
  }
  return parsed.data.data as T;
}

/**
 * Run a prepared request through `fetchImpl` with a bounded transient-failure
 * retry. The `init` (and thus its Idempotency-Key header) is reused verbatim
 * on every attempt, so a non-GET replay dedupes server-side instead of
 * double-applying. Network errors and 5xx replay immediately; a 429 replays
 * after waiting out Retry-After. `sleep` is injectable so the 429 backoff is
 * testable without a real timer. Exported for unit testing the retry contract;
 * production callers go through `apiRequest`.
 */
export async function executeRequest<T>(
  url: string,
  init: RequestInit,
  fetchImpl: FetchImpl,
  maxRetries: number = MAX_RETRIES,
  sleep: SleepImpl = defaultSleep,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    let response: Response;
    try {
      response = await fetchImpl(url, init);
    } catch (networkError) {
      // No HTTP response reached us (network / connection failure). Retry
      // with the same init (same Idempotency-Key) if budget remains.
      lastError = networkError;
      if (attempt < maxRetries) continue;
      throw networkError;
    }

    if (isRetryableStatus(response.status) && attempt < maxRetries) {
      // Transient server-side failure. Discard this body and replay the
      // same request; the idempotency contract guarantees no double-apply.
      lastError = new ApiError(
        ERROR_CODES.INTERNAL_ERROR,
        response.status,
        'Transient upstream failure',
      );
      // Release the discarded body's stream lock before replaying.
      void response.body?.cancel();
      continue;
    }

    if (response.status === TOO_MANY_REQUESTS && attempt < maxRetries) {
      // Rate limited. Unlike a 5xx, wait out the server Retry-After (capped)
      // before replaying the SAME init (same Idempotency-Key), so we honor the
      // limit instead of replaying at 0ms and amplifying the overload.
      lastError = new ApiError(
        ERROR_CODES.RATE_LIMITED,
        response.status,
        'Rate limited',
      );
      // Release the discarded body's stream lock before we wait, then replay.
      void response.body?.cancel();
      await sleep(
        retryAfterDelayMs(response.headers.get(HTTP_HEADERS.RETRY_AFTER), Date.now()),
      );
      continue;
    }

    return parseResponse<T>(response);
  }

  // Unreachable in practice: the loop either returns or throws on the final
  // attempt. Present so the function is total for the type checker.
  throw lastError instanceof Error
    ? lastError
    : new ApiError(ERROR_CODES.INTERNAL_ERROR, 0, 'Request failed');
}
