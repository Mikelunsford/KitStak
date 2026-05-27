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

// In-memory row store stand-in for the idempotency_keys table. The lookup
// chain in idempotency.ts is .from(table).select(...).eq().eq().eq().eq()
// .maybeSingle(); inserts call .from(table).insert(row). We reproduce only
// what the wrapper actually exercises.
type IdRow = {
  key: string;
  user_id: string;
  org_id: string;
  route_hash: string;
  body_hash: string;
  status_code: number;
  response_jsonb: unknown;
  created_at?: string;
};

function makeIdempotencyClient(rows: IdRow[]) {
  return {
    from: (_table: string) => {
      let toInsert: IdRow | null = null;
      const filters: Array<{ col: string; val: string }> = [];

      const builder = {
        select: (_cols: string) => builder,
        eq: (col: string, val: string) => {
          filters.push({ col, val });
          return builder;
        },
        maybeSingle: async () => {
          const hit = rows.find((r) =>
            filters.every((f) => (r as unknown as Record<string, unknown>)[f.col] === f.val),
          );
          return { data: hit ?? null, error: null };
        },
        insert: async (row: IdRow) => {
          toInsert = row;
          rows.push({ ...row, created_at: new Date().toISOString() });
          return { error: null };
        },
      };

      // The wrapper invokes .insert(row) (no chained .maybeSingle) and then
      // awaits the returned thenable; the no-op chain above already returns
      // {error: null} from the insert call directly, which matches the
      // SupabaseLike contract in _shared/idempotency.ts.
      void toInsert;
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
        // deno-lint-ignore no-explicit-any
        client: makeIdempotencyClient(rows) as any,
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
        // deno-lint-ignore no-explicit-any
        client: makeIdempotencyClient(rows) as any,
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
        // deno-lint-ignore no-explicit-any
        client: makeIdempotencyClient(rows) as any,
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
          // deno-lint-ignore no-explicit-any
          client: makeIdempotencyClient(rows) as any,
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
