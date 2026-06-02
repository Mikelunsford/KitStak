// Idempotency helper. DB-backed.
//
// Contract (per constitution and migration 0001 + 0086):
//   * Every non-GET handler enforces `Idempotency-Key` (UUID v4).
//   * Storage: public.idempotency_keys, PK (key, user_id, org_id, route_hash).
//   * Body hash: RFC 8785 canonical JSON, SHA-256.
//   * Same key + same body within 24h replays with `Idempotent-Replay: true`.
//   * Same key + different body returns 409 IDEMPOTENCY_CONFLICT.
//
// The PK shape is `(key, user_id, org_id, route_hash)`. Migration 0001 ships
// this directly (constitution decision D-010); we do not migrate from the
// reference codebase's deferred-org PK.
//
// Concurrency model (migration 0086, RESERVE-BEFORE-EXECUTE):
//   The wrapper first RESERVES a pending row via INSERT ... ON CONFLICT DO
//   NOTHING on the PK. Exactly one concurrent caller wins the reservation and
//   runs the handler; the others observe the existing row. This makes the
//   "exactly-once under concurrent same-key" guarantee hold at the database
//   level rather than relying on a lookup/insert race window.
//
//   * Reservation WON  -> run handler, then UPDATE the row to completed
//     (status_code + response_jsonb + state='completed'). If that persist
//     fails, we FAIL CLOSED with INTERNAL_ERROR rather than returning a 200
//     that was never recorded, because a swallowed persist breaks the
//     at-most-once replay guarantee on retry.
//   * Reservation LOST + row completed + same body_hash  -> replay.
//   * Reservation LOST + different body_hash             -> 409 CONFLICT.
//   * Reservation LOST + row still pending (in-flight)   -> 409 IN_PROGRESS.

import { createClient } from '@supabase/supabase-js';

import { ApiError, ok, fromApiError } from './responses.ts';
import type { Caller } from './tenant.ts';
import { ERROR_CODES, HTTP_HEADERS } from './constants.ts';

type ReservationRow = {
  key: string;
  user_id: string;
  org_id: string;
  route_hash: string;
  body_hash: string;
  state: 'pending' | 'completed';
};

type CompletionPatch = {
  status_code: number;
  response_jsonb: unknown;
  state: 'completed';
};

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
    // RESERVE: INSERT ... ON CONFLICT DO NOTHING. `ignoreDuplicates: true`
    // maps PostgREST onto `ON CONFLICT DO NOTHING`. The returned select tells
    // us whether the row was actually inserted (won) or skipped (lost).
    upsert: (
      row: ReservationRow,
      opts: { onConflict: string; ignoreDuplicates: boolean },
    ) => {
      select: (cols: string) => Promise<{
        data: IdempotencyRow[] | null;
        error: unknown;
      }>;
    };
    // COMPLETE: stamp the reserved row with the real response.
    update: (patch: CompletionPatch) => {
      eq: (col: string, value: string) => {
        eq: (col: string, value: string) => {
          eq: (col: string, value: string) => {
            eq: (col: string, value: string) => Promise<{ error: unknown }>;
          };
        };
      };
    };
  };
};

type IdempotencyRow = {
  key: string;
  user_id: string;
  org_id: string;
  route_hash: string;
  body_hash: string;
  status_code: number | null;
  response_jsonb: unknown;
  state?: 'pending' | 'completed';
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
 * Canonical JSON for body hashing. This is a deliberate NARROWING of RFC 8785
 * JCS, not a full implementation, and that narrowing is safe for our inputs:
 *
 *   * Every body passed here has already been through Zod safeParse at the
 *     handler boundary, so the value space is constrained to JSON the schema
 *     admits (no NaN/Infinity, no undefined fields, no functions, no class
 *     instances, no cyclic graphs).
 *   * We sort object keys and emit no whitespace, which is the property the
 *     body_hash actually depends on (stable serialization across calls).
 *   * The SAME serializer runs on both store and compare. Replay correctness
 *     only requires self-consistency, not byte-for-byte agreement with a
 *     reference JCS encoder. We do not need RFC 8785 number canonicalization
 *     (shortest round-trip form, exponent rules) because the same Zod-coerced
 *     numeric values serialize identically on both sides via JSON.stringify.
 *
 * If a future caller feeds raw, un-validated JSON here, revisit this: full
 * JCS number/string canonicalization would then matter.
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
 * Flow (RESERVE-BEFORE-EXECUTE, fail-closed persist):
 *  1. Read + validate Idempotency-Key.
 *  2. route_hash = sha256(`${method} ${bundle} ${route}`).
 *  3. body_hash = sha256(canonicalJson(body)).
 *  4. RESERVE: INSERT ... ON CONFLICT DO NOTHING a pending row on the PK.
 *     - WON the reservation: run handler, UPDATE the row to completed. If the
 *       UPDATE fails, FAIL CLOSED (INTERNAL_ERROR) instead of returning an
 *       unrecorded 200.
 *     - LOST the reservation: read the existing row.
 *         * completed + same body_hash within window -> replay.
 *         * any body_hash mismatch                    -> 409 CONFLICT.
 *         * still pending (in-flight)                 -> 409 in-progress.
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

  // -------------------------------------------------------------------------
  // Step 4: RESERVE. INSERT ... ON CONFLICT DO NOTHING. Exactly one concurrent
  // caller with the same PK inserts a pending row; everyone else gets an empty
  // returned set (the conflict was skipped). This closes the lookup/insert
  // race the previous implementation had.
  // -------------------------------------------------------------------------
  const reserve = await client
    .from('idempotency_keys')
    .upsert(
      {
        key,
        user_id: ctx.caller.userId,
        org_id: ctx.caller.orgId,
        route_hash: routeHash,
        body_hash: bodyHash,
        state: 'pending',
      },
      { onConflict: 'key,user_id,org_id,route_hash', ignoreDuplicates: true },
    )
    .select('*');

  if (reserve.error) {
    throw new ApiError(
      'INTERNAL_ERROR',
      500,
      `idempotency reserve failed: ${String((reserve.error as { message?: string }).message ?? reserve.error)}`,
    );
  }

  const reservedRows = reserve.data ?? [];
  const wonReservation = reservedRows.length > 0;

  if (!wonReservation) {
    // -----------------------------------------------------------------------
    // Reservation LOST: a row already exists. Read it and decide replay vs
    // conflict vs in-flight.
    // -----------------------------------------------------------------------
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
    if (!existing) {
      // Reservation reported a conflict but the row vanished (GC raced the
      // read). Fail closed rather than guess.
      throw new ApiError(
        'INTERNAL_ERROR',
        500,
        'idempotency row missing after conflict',
      );
    }

    // Different body under the same key is always a conflict, regardless of
    // state. This is checked before the replay window so a divergent retry is
    // never silently accepted.
    if (existing.body_hash !== bodyHash) {
      throw new ApiError(
        ERROR_CODES.IDEMPOTENCY_CONFLICT,
        409,
        'Idempotency-Key already used with a different request body.',
      );
    }

    // Same body, but the original request has not finished persisting yet.
    // We return a deterministic 409. Rationale: a 200 here would have no
    // recorded response to echo, and re-running the handler would violate
    // exactly-once. The IDEMPOTENCY_CONFLICT code is reused (no SPA error-map
    // change) with an in-flight message so the caller can safely retry once
    // the original settles.
    if (existing.state === 'pending' || existing.status_code === null) {
      throw new ApiError(
        ERROR_CODES.IDEMPOTENCY_CONFLICT,
        409,
        'Idempotency-Key request is still in progress. Retry shortly.',
      );
    }

    // Completed. Honour the 24h replay window; an expired completed row is
    // treated as a conflict rather than re-executed, because the reservation
    // path no longer overwrites rows in place.
    const createdAt = existing.created_at
      ? new Date(existing.created_at).getTime()
      : Date.now();
    const expired = Date.now() - createdAt > REPLAY_WINDOW_MS;
    if (expired) {
      throw new ApiError(
        ERROR_CODES.IDEMPOTENCY_CONFLICT,
        409,
        'Idempotency-Key has expired. Use a fresh key.',
      );
    }

    return replayResponse(
      existing.status_code ?? 200,
      existing.response_jsonb,
      requestId,
    );
  }

  // -------------------------------------------------------------------------
  // Reservation WON. Run the real handler, then persist the completion. The
  // pending row guarantees concurrent same-key callers see in-flight, not a
  // second execution.
  // -------------------------------------------------------------------------
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

  const completion = await client
    .from('idempotency_keys')
    .update({
      status_code: response.status,
      response_jsonb: parsed,
      state: 'completed',
    })
    .eq('key', key)
    .eq('user_id', ctx.caller.userId)
    .eq('org_id', ctx.caller.orgId)
    .eq('route_hash', routeHash);

  if (completion.error) {
    // FAIL CLOSED. The handler ran but we could not record its result. A
    // swallowed persist would leave a permanently-pending row and break the
    // replay/exactly-once contract on the caller's retry, so we surface the
    // failure instead of returning a 200 that was never durably recorded.
    throw new ApiError(
      'INTERNAL_ERROR',
      500,
      `idempotency persist failed: ${String((completion.error as { message?: string }).message ?? completion.error)}`,
    );
  }

  return response;
}
