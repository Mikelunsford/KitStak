// CORS helpers.
//
// The existing responses.ts bakes a permissive `Access-Control-Allow-Origin: *`
// into every success and error response. This module exposes the same headers
// as a function for handlers that want to set CORS on bespoke responses
// (preflight responses, 204s, streamed responses) without taking a dependency
// on responses.ts internals.
//
// Allowed headers include the worker secret used by the scheduled functions
// (audit-chain-verify, idempotency-gc) so OPTIONS preflights from a SPA proxy
// do not strip it.

export function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers':
      'authorization, content-type, x-request-id, idempotency-key, x-worker-secret',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
    'Access-Control-Expose-Headers':
      'x-request-id, idempotent-replay, retry-after',
    'Access-Control-Max-Age': '86400',
    Vary: 'origin',
  };
}

/**
 * If the request is an OPTIONS preflight, return a 204 with CORS headers.
 * Otherwise return null so the caller can continue dispatch.
 */
export function handlePreflight(req: Request): Response | null {
  if (req.method !== 'OPTIONS') return null;
  return new Response(null, { status: 204, headers: corsHeaders() });
}
