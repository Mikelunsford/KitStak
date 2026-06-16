import { supabase } from '@/lib/supabase';
import { HTTP_HEADERS } from '@/lib/constants';
import { ApiError, executeRequest } from '@/lib/apiClient.core';

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

export async function apiRequest<T>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<T> {
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

  // Bounded transient-failure auto-retry (R-W13-UX-03a). The same `init`
  // (and thus the same Idempotency-Key) is replayed, so a retry is safe.
  return executeRequest<T>(url, init, fetch);
}
