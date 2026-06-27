import { supabase } from '@/lib/supabase';
import { HTTP_HEADERS } from '@/lib/constants';
import {
  ApiError,
  executeRequest,
  parseResponseEnvelope,
  MAX_RETRIES,
  type ResponseEnvelope,
} from '@/lib/apiClient.core';

// Re-export ApiError so existing callers keep importing it from
// `@/lib/apiClient` unchanged. executeRequest and FetchImpl are intentionally
// NOT re-exported here: they stay in `@/lib/apiClient.core` (where the retry
// tests import them directly) so no service-layer caller can reach
// executeRequest off the public client surface and bypass the auth-header
// injection (bearer + apikey) that apiRequest applies.
export { ApiError };

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error('Missing Supabase environment variables');
}

const FUNCTIONS_BASE = `${SUPABASE_URL.replace(/\/$/, '')}/functions/v1`;

type ApiRequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
};

async function prepareRequest(
  path: string,
  options: ApiRequestOptions,
): Promise<{ url: string; init: RequestInit }> {
  const method = options.method ?? 'GET';

  const { data: { session } } = await supabase.auth.getSession();
  const bearer = session?.access_token ?? SUPABASE_ANON_KEY;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    [HTTP_HEADERS.API_KEY]: SUPABASE_ANON_KEY,
    [HTTP_HEADERS.AUTHORIZATION]: `Bearer ${bearer}`,
    ...options.headers,
  };
  if (method !== 'GET') {
    // Minted once. Every retry inside executeRequest reuses this same header
    // value so a replayed non-GET request dedupes server-side instead of
    // double-applying (server idempotency contract).
    headers[HTTP_HEADERS.IDEMPOTENCY_KEY] = crypto.randomUUID();
  }

  const url = path.startsWith('http')
    ? path
    : `${FUNCTIONS_BASE}${path.startsWith('/') ? '' : '/'}${path}`;

  const init: RequestInit = { method, headers };
  if (options.body !== undefined) init.body = JSON.stringify(options.body);

  return { url, init };
}

export async function apiRequest<T>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<T> {
  const { url, init } = await prepareRequest(path, options);
  // Bounded transient-failure auto-retry (R-W13-UX-03a) plus Retry-After-aware
  // 429 backoff (F-Wave13-RETRY-AFTER-429-01). The same `init` (and thus the
  // same Idempotency-Key) is replayed, so a retry is safe.
  return executeRequest<T>(url, init, fetch);
}

/**
 * Like apiRequest but returns the raw response Blob instead of parsing a JSON
 * envelope. For endpoints that stream a file body (e.g. exports-api CSV) which
 * must still go through the same authenticated request path: a top-level
 * browser navigation cannot attach the bearer + apikey headers, so the only way
 * to reach an auth-guarded function host is an authenticated fetch like this.
 * Reuses prepareRequest so the bearer + apikey injection stays centralized; it
 * deliberately bypasses executeRequest (no envelope parsing, no retry) because
 * the body is an opaque blob, not a { data, meta } envelope.
 */
export async function apiRequestBlob(
  path: string,
  options: ApiRequestOptions = {},
): Promise<Blob> {
  const { url, init } = await prepareRequest(path, options);
  const res = await fetch(url, init);
  if (!res.ok) {
    // Surface the server's error code/message when the failure body is a JSON
    // envelope; fall back to an HTTP_<status> code otherwise. Never swallow it.
    let code = `HTTP_${res.status}`;
    let message = `Request failed with status ${res.status}`;
    try {
      const body = (await res.json()) as {
        error?: { code?: string; message?: string };
      };
      if (body?.error?.code) code = body.error.code;
      if (body?.error?.message) message = body.error.message;
    } catch {
      // Non-JSON error body (or empty); keep the HTTP_<status> defaults.
    }
    throw new ApiError(code, res.status, message);
  }
  return res.blob();
}

/**
 * Like apiRequest but returns the full { data, meta } envelope. The keyset list
 * endpoints that carry next_cursor in meta (invoices, customers) use this; the
 * ones that carry it in data (quotes, items) use apiRequest. Same auth headers,
 * retry, and idempotency contract as apiRequest.
 */
export async function apiRequestWithMeta<T>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<ResponseEnvelope<T>> {
  const { url, init } = await prepareRequest(path, options);
  return executeRequest<ResponseEnvelope<T>>(
    url,
    init,
    fetch,
    MAX_RETRIES,
    undefined,
    parseResponseEnvelope,
  );
}
