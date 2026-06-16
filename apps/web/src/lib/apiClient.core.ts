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
 *      layer, the browser never got an HTTP response) or a 5xx server
 *      status. A 4xx is a deterministic client error (validation, auth,
 *      not-found, idempotency conflict); retrying it would only repeat the
 *      same failure, so we let it through on the first response. A 429 is
 *      NOT auto-retried either: a rate limit must honor the server
 *      Retry-After rather than replay at 0ms and amplify the overload, so it
 *      surfaces to the caller (Retry-After-aware backoff is a follow-up,
 *      F-Wave13-RETRY-AFTER-429-01).
 */
export const MAX_RETRIES = 1;

/**
 * HTTP statuses safe to auto-retry: 5xx server errors only. 429 is excluded on
 * purpose (a rate limit needs Retry-After backoff, not an immediate replay).
 */
export function isRetryableStatus(status: number): boolean {
  return status >= 500 && status <= 599;
}

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
 * on every attempt. Exported for unit testing the retry contract; production
 * callers go through `apiRequest`.
 */
export async function executeRequest<T>(
  url: string,
  init: RequestInit,
  fetchImpl: FetchImpl,
  maxRetries: number = MAX_RETRIES,
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
