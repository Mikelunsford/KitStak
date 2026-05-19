// Shared handler helpers. One module for the boilerplate every edge bundle
// reuses: service-role client factory, request-body parsing, cursor
// pagination, expand-set parsing, and the idempotency wrapper that produces
// a uniform Response (CORS, x-request-id, Idempotent-Replay).
//
// RLS posture: service-role bypasses RLS. Every query in a handler MUST still
// combine with explicit `.eq('org_id', caller.orgId)` (Pattern A) per the
// constitution. The capability check (requireCap) is the per-route authority.

import { createClient } from '@supabase/supabase-js';
import { z, type ZodTypeAny } from 'zod';

import { ApiError, ok, fromApiError } from './responses.ts';
import { respondWithIdempotency as runWithIdempotency } from './idempotency.ts';
import { corsHeaders } from './cors.ts';
import { ERROR_CODES, HTTP_HEADERS } from './constants.ts';
import type { Caller } from './tenant.ts';
import { hasCap, type Capability } from './capabilities.ts';

export interface CursorPayload {
  created_at: string;
  id: string;
}

/**
 * Service-role Supabase client factory. Edge handlers use this to bypass
 * the gateway's authenticated-role; tenant scope is enforced by explicit
 * `.eq('org_id', caller.orgId)` filters in the handler, never by the client.
 */
export function admin() {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) {
    throw new ApiError(
      'INTERNAL_ERROR',
      500,
      'Missing service-role credentials',
    );
  }
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * JSON-parse the request body and run it through a Zod schema. Throws
 * VALIDATION_ERROR with flattened fieldErrors on failure.
 */
export async function parseBody<S extends ZodTypeAny>(
  req: Request,
  schema: S,
): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new ApiError(
      'VALIDATION_ERROR',
      422,
      'request body is not valid JSON',
    );
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new ApiError(
      'VALIDATION_ERROR',
      422,
      'request body failed schema validation',
      { fieldErrors: parsed.error.flatten().fieldErrors },
    );
  }
  return parsed.data;
}

/**
 * RFC 4122 UUID regex. Case-insensitive. Matches v1-v5 plus the nil UUID. The
 * variant nibble (`[89ab]`) is intentionally tolerant: probe-matrix fixtures
 * use `0000-4000-8000-...` shapes, and we accept any spec-compliant UUID
 * string. Used by `parseUuidParam` for defense-in-depth path-segment
 * validation at the handler boundary.
 *
 * F-Wave7-UUID-GUARD-01: before this guard, a SPA bug that routed
 * `GET /warehouses/new` (non-UUID id) into a `:id` handler reached the
 * Postgres layer, which threw `22P02 invalid input syntax for type uuid`.
 * That bubbled up as `INTERNAL_ERROR 500`. The guard converts those cases
 * to `BAD_REQUEST 400` before any DB call.
 */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validate a URL path parameter looks like a UUID. Throws
 * `ApiError('BAD_REQUEST', 400)` with structured `details` if not. Returns
 * the value unchanged on success so callers can keep the inline pattern:
 *
 *   const id = parseUuidParam(params.id);
 *
 * Or in-place, for handlers that already destructure `params`:
 *
 *   parseUuidParam(params.id);
 *   // ... .eq('id', params.id) ...
 *
 * The thrown error matches the canonical wire shape produced by
 * `fromApiError`: `{ error: { code: 'BAD_REQUEST', message, details } }`
 * with `details.param` and `details.got`. The `got` value is truncated to
 * 64 chars to avoid echoing arbitrarily long client input in error bodies.
 */
export function parseUuidParam(value: string, paramName: string = 'id'): string {
  if (typeof value === 'string' && UUID_RE.test(value)) return value;
  const got = typeof value === 'string' ? value.slice(0, 64) : String(value);
  throw new ApiError(
    'BAD_REQUEST',
    400,
    `Invalid UUID parameter: ${paramName}`,
    { param: paramName, got },
  );
}

/**
 * Read `?limit=` from the URL. Defaults to 50, clamped to [1, 200].
 * Per the constitution and the API contract pagination section.
 */
export function parseLimit(url: URL): number {
  const raw = url.searchParams.get('limit');
  if (!raw) return 50;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return 50;
  return Math.min(n, 200);
}

/**
 * Parse repeatable `?expand=` query params. Both `?expand=a&expand=b` and
 * `?expand=a,b` are accepted. Returns a Set the handler can membership-check.
 */
export function parseExpand(url: URL): Set<string> {
  const out = new Set<string>();
  for (const raw of url.searchParams.getAll('expand')) {
    for (const part of raw.split(',')) {
      const trimmed = part.trim();
      if (trimmed) out.add(trimmed);
    }
  }
  return out;
}

export function encodeCursor(p: CursorPayload): string {
  return btoa(JSON.stringify(p));
}

/**
 * Decode an opaque cursor. An invalid or absent cursor throws
 * VALIDATION_ERROR rather than silently treating it as "start", so a
 * client bug never quietly drops back to page-1 reads.
 *
 * Callers that want the start-of-list to be valid should not pass the
 * cursor at all (or pass null).
 */
export function decodeCursor(raw: string | null): CursorPayload | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(atob(raw)) as Partial<CursorPayload>;
    if (
      typeof parsed.created_at !== 'string' ||
      typeof parsed.id !== 'string'
    ) {
      throw new ApiError('VALIDATION_ERROR', 422, 'invalid cursor');
    }
    return { created_at: parsed.created_at, id: parsed.id };
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError('VALIDATION_ERROR', 422, 'invalid cursor');
  }
}

/**
 * Build the canonical `{ items, next_cursor }` shape from a query that asks
 * for `limit + 1` rows ordered by `(created_at desc, id desc)`.
 */
export function paginate<T extends { id: string; created_at: string }>(
  rows: T[],
  limit: number,
): { items: T[]; next_cursor: string | null } {
  if (rows.length <= limit) return { items: rows, next_cursor: null };
  const items = rows.slice(0, limit);
  const overflow = rows[limit];
  return {
    items,
    next_cursor: encodeCursor({
      created_at: overflow.created_at,
      id: overflow.id,
    }),
  };
}

/**
 * 201 Created helper. Mirrors `ok()` shape but with status 201 and the same
 * CORS/x-request-id headers, so handlers can return a uniform creation
 * response without hand-rolling Response objects.
 */
export function created<T>(data: T, meta?: Record<string, unknown>): Response {
  const body = meta !== undefined ? { data, meta } : { data };
  return new Response(JSON.stringify(body), {
    status: 201,
    headers: {
      'Content-Type': 'application/json',
      [HTTP_HEADERS.X_REQUEST_ID]: crypto.randomUUID(),
      ...corsHeaders(),
    },
  });
}

/**
 * Run a state-changing handler under idempotency semantics and produce a
 * Response with consistent headers.
 *
 * Flow:
 *  1. Validate Idempotency-Key header (UUID v4) and lookup
 *     (key, user_id, org_id, route_hash) row.
 *  2. Replay on hit (same body_hash) with `Idempotent-Replay: true`. Replay
 *     goes through `ok()` or `fromApiError()` so CORS + x-request-id are
 *     identical to a live response.
 *  3. On miss, invoke `handler`, persist the response, then return it.
 *
 * The `body` argument is the parsed request body. Pass `null` for
 * DELETE / no-body routes.
 */
export async function respondWithIdempotency(
  req: Request,
  caller: Caller,
  bundle: string,
  route: string,
  body: unknown,
  handler: () => Promise<Response>,
): Promise<Response> {
  return runWithIdempotency(
    {
      req,
      caller,
      bundle,
      route,
      body,
    },
    handler,
  );
}

/**
 * Capability check at handler entry. Throws ApiError('FORBIDDEN', 403) when
 * the caller's role does not carry the cap. The matrix in capabilities.ts is
 * the authority; the SPA's button-hiding mirror is advisory.
 *
 * Lives in handler-helpers.ts (not capabilities.ts) because
 * `supabase/functions/_shared/capabilities.ts` is byte-mirrored to
 * `apps/web/src/lib/capabilities.ts` and the SPA mirror cannot import from
 * Deno-only response helpers. Drift is enforced by parity.test.ts.
 */
export function requireCap(caller: Caller, cap: Capability): void {
  if (hasCap(caller.role, cap)) return;
  throw new ApiError(
    ERROR_CODES.FORBIDDEN,
    403,
    `caller lacks capability: ${cap}`,
  );
}

/**
 * Re-export of `ok` and `fromApiError` so handlers can pull every wire-shape
 * helper from one module without juggling import paths.
 */
export { ok, fromApiError };
