// CORS helpers.
//
// D6 (F-Wave10-REVIEW-REMEDIATION): the previous implementation baked a
// permissive `Access-Control-Allow-Origin: *` into every success and error
// response. We now echo the request Origin only when it matches the
// `ALLOWED_ORIGINS` env allow-list; otherwise we fall back to the primary prod
// origin (the first entry in the list). When no Request is available (the
// success / error helpers in responses.ts build a Response without one) we
// emit the primary origin so the wire still carries a concrete, non-wildcard
// value. Browser CORS negotiation happens on the preflight, where the Origin
// header is present, so the SPA flow stays intact.
//
// Server-only workers (notifications-worker, audit-chain-verify, idempotency-gc)
// are not browser-reachable. They never send a browser Origin, so they receive
// the empty non-browser CORS origin via `serverCorsHeaders()`.
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

// Hardcoded fallback primary origin. Used only when ALLOWED_ORIGINS is unset
// (e.g. local dev before the operator wires the env var). Production sets
// ALLOWED_ORIGINS explicitly so this default never ships to the wire there.
const DEFAULT_PRIMARY_ORIGIN = 'https://app.kitstak.com';

/**
 * Parse the `ALLOWED_ORIGINS` env allow-list. Comma or whitespace separated.
 * The first entry is treated as the primary prod origin (the fallback echoed
 * when the request Origin is absent or not allow-listed).
 */
function allowedOrigins(): string[] {
  const raw = Deno.env.get('ALLOWED_ORIGINS') ?? '';
  const out: string[] = [];
  for (const part of raw.split(/[,\s]+/)) {
    const trimmed = part.trim();
    if (trimmed) out.push(trimmed);
  }
  return out;
}

/**
 * Resolve the `Access-Control-Allow-Origin` value for a browser-facing
 * response. Echoes the request Origin when allow-listed; otherwise returns the
 * primary prod origin.
 */
function resolveAllowOrigin(req?: Request): string {
  const list = allowedOrigins();
  const primary = list[0] ?? DEFAULT_PRIMARY_ORIGIN;
  if (!req) return primary;
  const origin = req.headers.get('origin');
  if (origin && list.includes(origin)) return origin;
  return primary;
}

/**
 * Browser-facing CORS headers. Pass the Request to echo an allow-listed Origin;
 * omit it (responses.ts success/error helpers) to emit the primary origin.
 */
export function corsHeaders(req?: Request): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': resolveAllowOrigin(req),
    'Access-Control-Allow-Headers': ALLOWED_REQUEST_HEADERS,
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
    'Access-Control-Expose-Headers': EXPOSED_RESPONSE_HEADERS,
    'Access-Control-Max-Age': '86400',
    Vary: 'origin',
  };
}

/**
 * CORS headers for server-only workers that are never reached by a browser.
 * Emits an empty allow-origin so no cross-origin browser context is granted
 * access, while keeping the method/header advertisement for any proxy that
 * inspects it. Use in notifications-worker, audit-chain-verify, idempotency-gc.
 */
export function serverCorsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': ALLOWED_REQUEST_HEADERS,
    Vary: 'origin',
  };
}

/**
 * If the request is an OPTIONS preflight, return a 204 with CORS headers.
 * Otherwise return null so the caller can continue dispatch. The request is
 * threaded into `corsHeaders` so the preflight echoes an allow-listed Origin.
 */
export function handlePreflight(req: Request): Response | null {
  if (req.method !== 'OPTIONS') return null;
  return new Response(null, { status: 204, headers: corsHeaders(req) });
}
