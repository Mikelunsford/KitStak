// Idempotency helper. DB-backed.
//
// Contract (per constitution and migration 0001):
//   * Every non-GET handler enforces `Idempotency-Key` (UUID v4).
//   * Storage: public.idempotency_keys, PK (key, user_id, org_id, route_hash).
//   * Body hash: RFC 8785 canonical JSON, SHA-256.
//   * Same key + same body within 24h replays with `Idempotent-Replay: true`.
//   * Same key + different body returns 409 IDEMPOTENCY_CONFLICT.
//
// The PK shape is `(key, user_id, org_id, route_hash)`. Migration 0001 ships
// this directly (constitution decision D-010); we do not migrate from the
// reference codebase's deferred-org PK.

import { createClient } from '@supabase/supabase-js';

import { ApiError, ok, fromApiError } from './responses.ts';
import type { Caller } from './tenant.ts';
import { ERROR_CODES, HTTP_HEADERS } from './constants.ts';

type SupabaseLike = {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, value: string) => {
        eq: (col: string, value: string) => {
          eq: (col: string, value: string) => {
            eq: (col: string, value: string) => {
              maybeSingle: () => Promise<{
                data: IdempotencyRow | null;
                error: unknown;
              }>;
            };
          };
        };
      };
    };
    insert: (row: IdempotencyRow) => Promise<{ error: unknown }>;
  };
};

type IdempotencyRow = {
  key: string;
  user_id: string;
  org_id: string;
  route_hash: string;
  body_hash: string;
  status_code: number;
  response_jsonb: unknown;
  created_at?: string;
};

// UUID v4 (case-insensitive). RFC 4122 §4.4 variant + version bits.
const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const REPLAY_HEADER = HTTP_HEADERS.IDEMPOTENT_REPLAY;
const REPLAY_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Rich context passed by handler-helpers.respondWithIdempotency. Includes the
 * Request (for header propagation), the resolved Caller, and the optional
 * Supabase client for tests to inject a mock.
 */
export type IdempotencyContext = {
  req: Request;
  caller: Caller;
  bundle: string;
  route: string;
  body: unknown;
  client?: SupabaseLike;
};

async function sha256Hex(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Canonical JSON per RFC 8785 JCS: sorted object keys, no whitespace,
 * primitives via JSON.stringify. Sufficient for our request bodies.
 */
function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalize).join(',') + ']';
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return (
    '{' +
    keys
      .map(
        (k) =>
          JSON.stringify(k) +
          ':' +
          canonicalize((value as Record<string, unknown>)[k]),
      )
      .join(',') +
    '}'
  );
}

/**
 * Read and strictly validate the `Idempotency-Key` header. Returns the key
 * lower-cased. Throws ApiError on missing or malformed value.
 *
 * Rejection codes:
 *   IDEMPOTENCY_KEY_REQUIRED (400) when the header is missing.
 *   IDEMPOTENCY_INVALID_KEY (400) when the header is present but not UUID v4.
 *
 * The two codes are deliberately distinct so the SPA can surface a different
 * error to the user (a missing header is an SDK bug; a bad header is a caller
 * bug worth logging).
 */
export function readIdempotencyKey(req: Request): string {
  const raw = req.headers.get(HTTP_HEADERS.IDEMPOTENCY_KEY);
  if (!raw) {
    throw new ApiError(
      ERROR_CODES.IDEMPOTENCY_KEY_REQUIRED,
      400,
      'Idempotency-Key header required on state-changing requests.',
    );
  }
  if (!UUID_V4_RE.test(raw)) {
    throw new ApiError(
      ERROR_CODES.IDEMPOTENCY_INVALID_KEY,
      400,
      'Idempotency-Key must be a UUID v4.',
    );
  }
  return raw.toLowerCase();
}

function makeAdminClient(): SupabaseLike {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) {
    throw new ApiError(
      'INTERNAL_ERROR',
      500,
      'Missing service-role credentials',
    );
  }
  // deno-lint-ignore no-explicit-any
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  }) as any as SupabaseLike;
}

/**
 * Replay a cached response with `Idempotent-Replay: true`. Routed through
 * `ok()` or `fromApiError()` so CORS + x-request-id headers are identical to
 * a fresh handler response.
 */
function replayResponse(
  status: number,
  body: unknown,
  requestId: string,
): Response {
  // Pull a fresh response with the canonical envelope, then attach the
  // replay header. We do not mint a new request id; we echo the caller's
  // if present so logs correlate.
  const envelope = body as
    | { data?: unknown; error?: { code: string; message?: string; details?: Record<string, unknown> } }
    | null;

  let base: Response;
  if (envelope && envelope.error) {
    const e = envelope.error;
    base = fromApiError(
      new ApiError(
        e.code,
        status,
        e.message ?? e.code,
        e.details,
      ),
    );
  } else {
    const data = envelope && 'data' in envelope ? envelope.data : envelope;
    base = ok(data);
  }

  // Layer the replay header and the original status (`ok()` always returns
  // 200; the cached call may have been a 201).
  const headers = new Headers(base.headers);
  headers.set(REPLAY_HEADER, 'true');
  if (requestId) headers.set(HTTP_HEADERS.X_REQUEST_ID, requestId);
  return new Response(base.body, { status, headers });
}

/**
 * Run a handler with full idempotency semantics. Returns a Response.
 *
 * Hot path:
 *  1. Read + validate Idempotency-Key.
 *  2. route_hash = sha256(`${method} ${bundle} ${route}`).
 *  3. body_hash = sha256(canonicalJson(body)).
 *  4. Lookup (key, user, org, route_hash). On hit + same body, replay.
 *     On hit + different body, throw IDEMPOTENCY_CONFLICT.
 *  5. On miss, invoke handler, persist (status_code, response_jsonb), return.
 */
export async function respondWithIdempotency(
  ctx: IdempotencyContext,
  handler: () => Promise<Response>,
): Promise<Response> {
  const key = readIdempotencyKey(ctx.req);
  const routeHash = await sha256Hex(
    `${ctx.req.method} ${ctx.bundle} ${ctx.route}`,
  );
  const bodyHash = await sha256Hex(canonicalize(ctx.body));

  const client = ctx.client ?? makeAdminClient();
  const requestId =
    ctx.req.headers.get(HTTP_HEADERS.X_REQUEST_ID) ?? crypto.randomUUID();

  const lookup = await client
    .from('idempotency_keys')
    .select('*')
    .eq('key', key)
    .eq('user_id', ctx.caller.userId)
    .eq('org_id', ctx.caller.orgId)
    .eq('route_hash', routeHash)
    .maybeSingle();

  if (lookup.error) {
    throw new ApiError(
      'INTERNAL_ERROR',
      500,
      `idempotency lookup failed: ${String((lookup.error as { message?: string }).message ?? lookup.error)}`,
    );
  }

  const existing = lookup.data;
  if (existing) {
    // 24h replay window. Older rows fall through and are overwritten.
    const createdAt = existing.created_at
      ? new Date(existing.created_at).getTime()
      : Date.now();
    const expired = Date.now() - createdAt > REPLAY_WINDOW_MS;
    if (!expired) {
      if (existing.body_hash !== bodyHash) {
        throw new ApiError(
          ERROR_CODES.IDEMPOTENCY_CONFLICT,
          409,
          'Idempotency-Key already used with a different request body.',
        );
      }
      return replayResponse(
        existing.status_code,
        existing.response_jsonb,
        requestId,
      );
    }
  }

  // Cache miss. Run the real handler and persist.
  const response = await handler();
  const cloned = response.clone();
  const text = await cloned.text();
  const parsed = (() => {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  })();

  const insertRes = await client.from('idempotency_keys').insert({
    key,
    user_id: ctx.caller.userId,
    org_id: ctx.caller.orgId,
    route_hash: routeHash,
    body_hash: bodyHash,
    status_code: response.status,
    response_jsonb: parsed,
  });

  if (insertRes.error) {
    // Persist failure is non-fatal: the handler ran. Log so an operator can
    // investigate, but do not retract the response the caller already sees
    // as semantically complete.
    console.warn(
      'idempotency persist failed',
      String((insertRes.error as { message?: string }).message ?? insertRes.error),
    );
  }

  return response;
}
