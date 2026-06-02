// Regression suite for D-IDEMP-01 — POST /pdf/render enforces the
// constitutional Idempotency-Key invariant on every non-GET handler.
//
// The 2026-05-27 drift audit surfaced pdf-worker as the last bundle still
// shipping a state-changing handler that was not wrapped in
// respondWithIdempotency. This suite locks the three required semantics:
//
//   (a) Missing Idempotency-Key header on POST /pdf/render returns
//       400 IDEMPOTENCY_KEY_REQUIRED.
//   (b) Same key + same body within the 24h replay window returns the cached
//       response with the Idempotent-Replay: true header.
//   (c) Same key + different body returns 409 IDEMPOTENCY_CONFLICT.
//
// (a) is exercised end-to-end through the captured Deno.serve handler so a
// regression in the handler wiring (missing wrapper, wrong arg order) breaks
// this test loudly. (b) and (c) exercise respondWithIdempotency directly
// because the shared supabase-mock harness does not persist inserts back into
// the row store, so a replay assertion through the captured handler would
// always fail on a harness limitation rather than on real handler behaviour.
// The auth-api members-invite suite carries the same note (line 303-309).

import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
  installDenoShim,
  capturedHandler,
  resetCapturedHandler,
} from './_helpers/deno-shim.ts';
import { bearer, makeState } from './_helpers/supabase-mock.ts';
import {
  setActiveMockState,
  clearActiveMockState,
} from './_helpers/supabase-stub.ts';
import { respondWithIdempotency } from '../../../../supabase/functions/_shared/idempotency.ts';
import { ok } from '../../../../supabase/functions/_shared/responses.ts';

// SupabaseLike client shape the wrapper actually consumes. We cast the
// in-memory mock through this alias to satisfy ESLint's no-explicit-any
// without dragging the full SupabaseClient type surface into a regression
// test.
type IdempotencyClient = Parameters<typeof respondWithIdempotency>[0]['client'];

const ORG_A = '00000000-0000-4000-8000-0000000000a1';
const USER_A = '00000000-0000-4000-8000-0000000000b1';
const OWNER = { userId: USER_A, orgId: ORG_A, role: 'org_owner' as const };

const MINIMAL_INVOICE_PAYLOAD = {
  customer_display_name: 'Acme Logistics',
  invoice_number: 'INV-0001',
  issue_date: '2026-05-19',
  due_date: '2026-06-18',
  lines: [
    {
      description: 'Pallet receiving',
      quantity: '2',
      unit_price_cents: '12500',
      line_total_cents: '25000',
    },
  ],
  subtotal_cents: '25000',
  tax_cents: '0',
  total_cents: '25000',
  currency: 'USD',
};

async function readJson(
  res: Response,
): Promise<{
  data?: { url?: string };
  error?: { code: string; message: string };
}> {
  return JSON.parse(await res.text());
}

// In-memory row store stand-in for the idempotency_keys table, modelling the
// RESERVE-BEFORE-EXECUTE flow the wrapper now uses (migration 0086):
//
//   reserve:  .from(t).upsert(row, { ignoreDuplicates: true }).select('*')
//             -> ON CONFLICT DO NOTHING: returns the inserted row only when it
//                was actually written (reservation won), [] otherwise.
//   lookup:   .from(t).select('*').eq().eq().eq().eq().maybeSingle()
//   complete: .from(t).update(patch).eq().eq().eq().eq()
//
// We reproduce only what the wrapper exercises. A `failComplete` hook lets a
// test force the completion UPDATE to error so the fail-closed path is
// exercised.
type IdRow = {
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

type IdClientOpts = { failComplete?: boolean };

function pkMatch(r: IdRow, row: { key: string; user_id: string; org_id: string; route_hash: string }): boolean {
  return (
    r.key === row.key &&
    r.user_id === row.user_id &&
    r.org_id === row.org_id &&
    r.route_hash === row.route_hash
  );
}

function makeIdempotencyClient(rows: IdRow[], opts: IdClientOpts = {}) {
  return {
    from: (_table: string) => {
      const filters: Array<{ col: string; val: string }> = [];
      let pendingPatch: Partial<IdRow> | null = null;

      const builder = {
        // ----- reserve -----
        // The exists-check and push happen synchronously in upsert() so the
        // reservation is atomic the way `INSERT ... ON CONFLICT DO NOTHING` is
        // at the database. Deferring the mutation into the async select() would
        // open a microtask gap that two concurrent callers could both pass,
        // which the real DB does not allow.
        upsert: (
          row: IdRow,
          _opts: { onConflict: string; ignoreDuplicates: boolean },
        ) => {
          const exists = rows.some((r) => pkMatch(r, row));
          let inserted: IdRow | null = null;
          if (!exists) {
            inserted = {
              ...row,
              status_code: null,
              response_jsonb: null,
              state: row.state ?? 'pending',
              created_at: new Date().toISOString(),
            };
            rows.push(inserted);
          }
          return {
            // ON CONFLICT DO NOTHING: skipped insert returns no row.
            select: async (_cols: string) => ({
              data: inserted ? [inserted] : [],
              error: null,
            }),
          };
        },

        // ----- lookup + completion share .eq() accumulation -----
        select: (_cols: string) => builder,
        update: (patch: Partial<IdRow>) => {
          pendingPatch = patch;
          return builder;
        },
        eq: (col: string, val: string) => {
          filters.push({ col, val });
          // The completion UPDATE terminates on the fourth .eq() (the wrapper
          // awaits the chain directly, no .maybeSingle()). Model that here so
          // the await resolves to { error }.
          if (pendingPatch && filters.length === 4) {
            if (opts.failComplete) {
              return Promise.resolve({ error: { message: 'simulated persist failure' } });
            }
            const target = rows.find((r) =>
              filters.every((f) => (r as unknown as Record<string, unknown>)[f.col] === f.val),
            );
            if (target) Object.assign(target, pendingPatch);
            return Promise.resolve({ error: null });
          }
          return builder;
        },
        maybeSingle: async () => {
          const hit = rows.find((r) =>
            filters.every((f) => (r as unknown as Record<string, unknown>)[f.col] === f.val),
          );
          return { data: hit ?? null, error: null };
        },
      };

      return builder as unknown as ReturnType<
        Parameters<typeof respondWithIdempotency>[0]['client'] extends infer C
          ? C extends { from: (t: string) => infer R }
            ? () => R
            : never
          : never
      >;
    },
  };
}

describe('pdf-worker — POST /pdf/render idempotency (D-IDEMP-01)', () => {
  let handler: (req: Request) => Promise<Response> | Response;

  beforeAll(async () => {
    installDenoShim();
    resetCapturedHandler();
    await import('../../../../supabase/functions/pdf-worker/index.ts');
    handler = capturedHandler();
  });

  afterEach(() => clearActiveMockState());

  it('(a) missing Idempotency-Key header returns 400 IDEMPOTENCY_KEY_REQUIRED', async () => {
    setActiveMockState(makeState({}));

    const req = new Request('https://example.test/pdf/render', {
      method: 'POST',
      headers: {
        authorization: bearer(OWNER),
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        template: 'invoice',
        data: MINIMAL_INVOICE_PAYLOAD,
      }),
    });

    const res = await handler(req);
    expect(res.status).toBe(400);
    const body = await readJson(res);
    expect(body.error?.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });

  it('(b) same key + same body returns cached response with Idempotent-Replay: true', async () => {
    const rows: IdRow[] = [];
    // Use a deterministic UUID v4 so both calls share the same key.
    const key = '11111111-1111-4111-8111-111111111111';
    const body = { template: 'invoice', data: MINIMAL_INVOICE_PAYLOAD };

    const makeReq = () =>
      new Request('https://example.test/pdf/render', {
        method: 'POST',
        headers: {
          authorization: bearer(OWNER),
          'content-type': 'application/json',
          'idempotency-key': key,
        },
        body: JSON.stringify(body),
      });

    let handlerCallCount = 0;
    const fakeHandler = async () => {
      handlerCallCount += 1;
      return ok({ url: 'data:application/pdf;base64,JVBERi0=' });
    };

    const first = await respondWithIdempotency(
      {
        req: makeReq(),
        caller: OWNER,
        bundle: 'pdf-worker',
        route: '/pdf/render',
        body,
        client: makeIdempotencyClient(rows) as unknown as IdempotencyClient,
      },
      fakeHandler,
    );
    expect(first.status).toBe(200);
    expect(first.headers.get('idempotent-replay')).toBeNull();
    expect(handlerCallCount).toBe(1);

    const second = await respondWithIdempotency(
      {
        req: makeReq(),
        caller: OWNER,
        bundle: 'pdf-worker',
        route: '/pdf/render',
        body,
        client: makeIdempotencyClient(rows) as unknown as IdempotencyClient,
      },
      fakeHandler,
    );
    expect(second.status).toBe(200);
    expect(second.headers.get('idempotent-replay')).toBe('true');
    // Replay must NOT re-invoke the inner render handler.
    expect(handlerCallCount).toBe(1);

    // Both responses carry the same body payload.
    const firstJson = JSON.parse(await first.clone().text());
    const secondJson = JSON.parse(await second.clone().text());
    expect(secondJson).toEqual(firstJson);
  });

  it('(c) same key + different body returns 409 IDEMPOTENCY_CONFLICT', async () => {
    const rows: IdRow[] = [];
    const key = '22222222-2222-4222-8222-222222222222';
    const bodyOne = { template: 'invoice', data: MINIMAL_INVOICE_PAYLOAD };
    const bodyTwo = {
      template: 'invoice',
      data: { ...MINIMAL_INVOICE_PAYLOAD, invoice_number: 'INV-0002' },
    };

    const fakeHandler = async () =>
      ok({ url: 'data:application/pdf;base64,JVBERi0=' });

    const first = await respondWithIdempotency(
      {
        req: new Request('https://example.test/pdf/render', {
          method: 'POST',
          headers: { 'idempotency-key': key },
        }),
        caller: OWNER,
        bundle: 'pdf-worker',
        route: '/pdf/render',
        body: bodyOne,
        client: makeIdempotencyClient(rows) as unknown as IdempotencyClient,
      },
      fakeHandler,
    );
    expect(first.status).toBe(200);

    // Second call: same key, different body. Wrapper throws ApiError; capture
    // it via try/catch since the wrapper does not catch internally.
    let caught: unknown = null;
    try {
      await respondWithIdempotency(
        {
          req: new Request('https://example.test/pdf/render', {
            method: 'POST',
            headers: { 'idempotency-key': key },
          }),
          caller: OWNER,
          bundle: 'pdf-worker',
          route: '/pdf/render',
          body: bodyTwo,
          client: makeIdempotencyClient(rows) as unknown as IdempotencyClient,
        },
        fakeHandler,
      );
    } catch (e) {
      caught = e;
    }

    expect(caught).not.toBeNull();
    const err = caught as { code?: string; status?: number };
    expect(err.code).toBe('IDEMPOTENCY_CONFLICT');
    expect(err.status).toBe(409);
  });
});

// RESERVE-BEFORE-EXECUTE + fail-closed persist (WS-B / B2). These exercise the
// shared wrapper directly against the in-memory row store, matching the same
// harness-limitation note as the replay assertions above.
describe('respondWithIdempotency reserve-before-execute (WS-B / B2)', () => {
  const BODY = { template: 'invoice', data: MINIMAL_INVOICE_PAYLOAD };

  function makeCtx(
    key: string,
    rows: IdRow[],
    opts: IdClientOpts = {},
    body: unknown = BODY,
  ) {
    return {
      req: new Request('https://example.test/pdf/render', {
        method: 'POST',
        headers: { 'idempotency-key': key },
      }),
      caller: OWNER,
      bundle: 'pdf-worker',
      route: '/pdf/render',
      body,
      client: makeIdempotencyClient(rows, opts) as unknown as IdempotencyClient,
    };
  }

  it('exactly-once: two parallel same-key calls invoke the handler once', async () => {
    const rows: IdRow[] = [];
    const key = '33333333-3333-4333-8333-333333333333';

    let handlerCalls = 0;
    // A handler that yields the event loop so both reservations are attempted
    // before either completes, mimicking true concurrency.
    const slowHandler = async () => {
      handlerCalls += 1;
      await Promise.resolve();
      return ok({ url: 'data:application/pdf;base64,JVBERi0=' });
    };

    const settled = await Promise.allSettled([
      respondWithIdempotency(makeCtx(key, rows), slowHandler),
      respondWithIdempotency(makeCtx(key, rows), slowHandler),
    ]);

    // The core exactly-once guarantee: the handler ran exactly once across
    // both concurrent same-key callers. This is the reservation closing the
    // lookup/insert race.
    expect(handlerCalls).toBe(1);

    // Exactly one row was reserved/persisted under the PK.
    expect(rows).toHaveLength(1);

    // The loser never re-executes. Depending on microtask ordering it either
    // sees the row still pending (-> 409 in-flight) or already completed
    // (-> 200 replay). Both are valid exactly-once outcomes; what is NOT valid
    // is a second handler invocation, asserted above.
    const fulfilled = settled.filter(
      (s) => s.status === 'fulfilled',
    ) as PromiseFulfilledResult<Response>[];
    const rejected = settled.filter(
      (s) => s.status === 'rejected',
    ) as PromiseRejectedResult[];

    // At least one caller got a successful 200.
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);
    for (const f of fulfilled) {
      expect(f.value.status).toBe(200);
    }
    // Any rejection must be a deterministic 409 in-flight conflict.
    for (const r of rejected) {
      const reason = r.reason as { code?: string; status?: number };
      expect(reason.status).toBe(409);
      expect(reason.code).toBe('IDEMPOTENCY_CONFLICT');
    }
  });

  it('in-flight: a same-key call while the reservation is pending returns 409', async () => {
    const rows: IdRow[] = [];
    const key = '44444444-4444-4444-8444-444444444444';

    let secondResult: { code?: string; status?: number } | null = null;

    // The first handler, while its own reservation is still pending (the
    // completion UPDATE has not run yet), fires a second same-key call. That
    // second call must observe the pending row and reject with a 409 rather
    // than executing a second time.
    const firstHandler = async () => {
      try {
        await respondWithIdempotency(makeCtx(key, rows), async () =>
          ok({ url: 'second-should-not-run' }),
        );
      } catch (e) {
        secondResult = e as { code?: string; status?: number };
      }
      return ok({ url: 'data:application/pdf;base64,JVBERi0=' });
    };

    const first = await respondWithIdempotency(makeCtx(key, rows), firstHandler);
    expect(first.status).toBe(200);

    expect(secondResult).not.toBeNull();
    expect(secondResult!.status).toBe(409);
    expect(secondResult!.code).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('fail-closed: a failed completion persist surfaces 5xx, not a swallowed 200', async () => {
    const rows: IdRow[] = [];
    const key = '55555555-5555-4555-8555-555555555555';

    let caught: unknown = null;
    try {
      await respondWithIdempotency(
        makeCtx(key, rows, { failComplete: true }),
        async () => ok({ url: 'data:application/pdf;base64,JVBERi0=' }),
      );
    } catch (e) {
      caught = e;
    }

    expect(caught).not.toBeNull();
    const err = caught as { code?: string; status?: number };
    expect(err.status).toBe(500);
    expect(err.code).toBe('INTERNAL_ERROR');
  });

  it('replay: a completed same-key/same-body call returns the stored response', async () => {
    const rows: IdRow[] = [];
    const key = '66666666-6666-4666-8666-666666666666';

    let handlerCalls = 0;
    const handler = async () => {
      handlerCalls += 1;
      return ok({ url: 'data:application/pdf;base64,STORED=' });
    };

    const first = await respondWithIdempotency(makeCtx(key, rows), handler);
    expect(first.status).toBe(200);
    expect(handlerCalls).toBe(1);

    const second = await respondWithIdempotency(makeCtx(key, rows), handler);
    expect(second.status).toBe(200);
    expect(second.headers.get('idempotent-replay')).toBe('true');
    // Replay must not re-invoke the handler.
    expect(handlerCalls).toBe(1);

    const firstJson = JSON.parse(await first.clone().text());
    const secondJson = JSON.parse(await second.clone().text());
    expect(secondJson).toEqual(firstJson);
  });
});
