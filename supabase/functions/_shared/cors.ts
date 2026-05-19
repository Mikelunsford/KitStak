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
//
// Header names sourced from `_shared/constants.ts HTTP_HEADERS` so the
// allow-list cannot drift from the names the SPA apiClient writes or the
// handlers read (F-Wave6-CORS-01, F-Wave7-LITDRIFT-01).

import { HTTP_HEADERS } from './constants.ts';

const ALLOWED_REQUEST_HEADERS = [
  HTTP_HEADERS.API_KEY,
  HTTP_HEADERS.AUTHORIZATION,
  HTTP_HEADERS.CONTENT_TYPE,
  HTTP_HEADERS.X_REQUEST_ID,
  HTTP_HEADERS.IDEMPOTENCY_KEY,
  HTTP_HEADERS.X_WORKER_SECRET,
].join(', ');

const EXPOSED_RESPONSE_HEADERS = [
  HTTP_HEADERS.X_REQUEST_ID,
  HTTP_HEADERS.IDEMPOTENT_REPLAY,
  HTTP_HEADERS.RETRY_AFTER,
].join(', ');

export function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': ALLOWED_REQUEST_HEADERS,
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
    'Access-Control-Expose-Headers': EXPOSED_RESPONSE_HEADERS,
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
