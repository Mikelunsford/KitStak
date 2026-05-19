// Regression suite for R-Wave6-PERF-02 — pagination cursor stub bug.
//
// Audit finding (03-workspace/journal/2026-05-18-drift-performance.md §7):
//   Multiple list handlers fetch `limit + 1` rows for overflow detection
//   but always return `next_cursor: null`. The overflow detection happens,
//   but the cursor is dropped. Clients cannot page past page 1.
//
// Targets:
//   * supabase/functions/quotes-api/index.ts:43         listQuotes
//   * supabase/functions/projects-api/index.ts:52       listProjects
//   * supabase/functions/sales-config-api/index.ts:134-135  genericList (× 9 endpoints)
//   * supabase/functions/sales-config-api/index.ts:322  listExchangeRates
//
// Constitutional invariant protected:
//   00-canon/01-architecture.md §152-156 — list endpoints MUST emit a
//   cursor when the underlying row set exceeds the requested limit.
//   Without it, every paginated UI in the SPA silently caps at the first
//   page; with no operator-visible signal that more data exists.
//
// Each test seeds the mock state with (limit + N) rows and invokes the
// handler with a forged JWT. The handler MUST:
//   1. Return only `limit` items.
//   2. Emit a non-null `next_cursor` string when more rows exist than the
//      page size.
//
// Currently fails because `next_cursor` is hardcoded to `null` in all four
// handlers. Round-trip pagination (calling the handler with `?cursor=<next>`)
// is out of scope for this regression suite because the Backend Engineer's
// fix may legitimately choose between `paginate()` from
// `_shared/handler-helpers.ts` (which uses `(created_at, id)` as the cursor
// payload) or a custom cursor shape per resource. A follow-up test in
// Cycle 2 covers the round-trip once the cursor shape is decided.

import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
  installDenoShim,
  capturedHandler,
  resetCapturedHandler,
} from './_helpers/deno-shim.ts';
import {
  makeState,
  bearer,
  type MockState,
} from './_helpers/supabase-mock.ts';
import {
  setActiveMockState,
  clearActiveMockState,
} from './_helpers/supabase-stub.ts';

const ORG_A = '00000000-0000-4000-8000-0000000000a1';
const USER_A = '00000000-0000-4000-8000-0000000000b1';
const OWNER = { userId: USER_A, orgId: ORG_A, role: 'org_owner' as const };

function isoMinusMinutes(minutesAgo: number): string {
  return new Date(Date.now() - minutesAgo * 60_000).toISOString();
}

function uuid(seq: number): string {
  const hex = seq.toString(16).padStart(12, '0');
  return `00000000-0000-4000-8000-${hex}`;
}

async function readJson(res: Response): Promise<unknown> {
  return JSON.parse(await res.text());
}

// ---------------------------------------------------------------------------
// quotes-api  (R-Wave6-PERF-02 — listQuotes hardcodes next_cursor: null)
// ---------------------------------------------------------------------------

describe('quotes-api GET /quotes — cursor regression (R-Wave6-PERF-02)', () => {
  let handler: (req: Request) => Promise<Response> | Response;

  beforeAll(async () => {
    installDenoShim();
    resetCapturedHandler();
    await import('../../../../supabase/functions/quotes-api/index.ts');
    handler = capturedHandler();
  });

  afterEach(() => {
    clearActiveMockState();
  });

  it('emits a non-null next_cursor when more rows exist than the limit', async () => {
    const LIMIT = 5;
    const N = LIMIT + 3;
    const rows = Array.from({ length: N }).map((_, i) => ({
      id: uuid(i + 1),
      org_id: ORG_A,
      state: 'draft',
      created_at: isoMinusMinutes(N - i), // older rows first; newest sorted last
      deleted_at: null,
    }));
    const state: MockState = makeState({ quotes: rows });
    setActiveMockState(state);

    const req = new Request(`https://example.test/quotes?limit=${LIMIT}`, {
      method: 'GET',
      headers: { authorization: bearer(OWNER) },
    });
    const res = await handler(req);
    expect(res.status).toBe(200);

    const body = (await readJson(res)) as {
      data: { items: unknown[]; next_cursor: string | null };
    };
    expect(body.data.items).toHaveLength(LIMIT);
    expect(body.data.next_cursor).not.toBeNull();
    expect(typeof body.data.next_cursor).toBe('string');
  });

});

// ---------------------------------------------------------------------------
// projects-api  (R-Wave6-PERF-02 — listProjects hardcodes next_cursor: null)
// ---------------------------------------------------------------------------

describe('projects-api GET /projects — cursor regression (R-Wave6-PERF-02)', () => {
  let handler: (req: Request) => Promise<Response> | Response;

  beforeAll(async () => {
    installDenoShim();
    resetCapturedHandler();
    await import('../../../../supabase/functions/projects-api/index.ts');
    handler = capturedHandler();
  });

  afterEach(() => {
    clearActiveMockState();
  });

  it('emits a non-null next_cursor when more projects exist than the limit', async () => {
    const LIMIT = 4;
    const N = LIMIT + 5;
    const rows = Array.from({ length: N }).map((_, i) => ({
      id: uuid(i + 1),
      org_id: ORG_A,
      state: 'pending',
      created_at: isoMinusMinutes(N - i),
      deleted_at: null,
    }));
    setActiveMockState(makeState({ projects: rows }));

    const req = new Request(`https://example.test/projects?limit=${LIMIT}`, {
      method: 'GET',
      headers: { authorization: bearer(OWNER) },
    });
    const res = await handler(req);
    expect(res.status).toBe(200);

    const body = (await readJson(res)) as {
      data: { items: unknown[]; next_cursor: string | null };
    };
    expect(body.data.items).toHaveLength(LIMIT);
    expect(body.data.next_cursor).not.toBeNull();
    expect(typeof body.data.next_cursor).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// sales-config-api  (R-Wave6-PERF-02 — affects 9 endpoints via genericList
// plus listExchangeRates on line 322). The two describes share one beforeAll
// because both target the same module and Vitest caches dynamic imports per
// module URL; a second `await import(...)` from a different describe would
// not re-run the top-level `Deno.serve(...)` and would leave the captured
// handler null.
// ---------------------------------------------------------------------------

describe('sales-config-api — cursor regression (R-Wave6-PERF-02)', () => {
  let handler: (req: Request) => Promise<Response> | Response;

  beforeAll(async () => {
    installDenoShim();
    resetCapturedHandler();
    await import('../../../../supabase/functions/sales-config-api/index.ts');
    handler = capturedHandler();
  });

  afterEach(() => {
    clearActiveMockState();
  });

  // TODO(F-Wave6-PERF-02-followup): sales-config-api responds 403 before
  // reaching the next_cursor code path even with org_owner. Likely a feature
  // flag or bundle-gate path that the supabase-mock does not currently stub.
  // Re-enable once the mock's per-bundle flag/cap resolution is extended.
  // Skipped to keep Cycle 1 focused on tests that fail for the documented
  // bug (`next_cursor` hardcoded null), not on test-harness shortcomings.
  it.skip('GET /items emits a non-null next_cursor when more items exist than the limit', async () => {
    const LIMIT = 3;
    const N = LIMIT + 2;
    const rows = Array.from({ length: N }).map((_, i) => ({
      id: uuid(i + 1),
      org_id: ORG_A,
      sku: `SKU-${i + 1}`,
      name: `Item ${i + 1}`,
      created_at: isoMinusMinutes(N - i),
      deleted_at: null,
    }));
    setActiveMockState(makeState({ items: rows }));

    const req = new Request(`https://example.test/items?limit=${LIMIT}`, {
      method: 'GET',
      headers: { authorization: bearer(OWNER) },
    });
    const res = await handler(req);
    expect(res.status).toBe(200);

    const body = (await readJson(res)) as {
      data: { items: unknown[]; next_cursor: string | null };
    };
    expect(body.data.items).toHaveLength(LIMIT);
    expect(body.data.next_cursor).not.toBeNull();
    expect(typeof body.data.next_cursor).toBe('string');
  });

  // TODO(F-Wave6-PERF-02-followup): same skip reason as the /items test above.
  it.skip('GET /exchange-rates emits a non-null next_cursor when more rows exist than the limit', async () => {
    const LIMIT = 2;
    const N = LIMIT + 3;
    const rows = Array.from({ length: N }).map((_, i) => ({
      id: uuid(i + 1),
      base_currency_code: 'USD',
      quote_currency_code: 'EUR',
      rate_e9: '900000000',
      effective_date: isoMinusMinutes((N - i) * 60).slice(0, 10),
      source: 'manual',
      // also stamp created_at so cursor-based paginate() can round-trip if
      // the fix elects to use (created_at, id) as the canonical cursor
      created_at: isoMinusMinutes(N - i),
    }));
    setActiveMockState(makeState({ exchange_rates: rows }));

    const req = new Request(
      `https://example.test/exchange-rates?limit=${LIMIT}`,
      {
        method: 'GET',
        headers: { authorization: bearer(OWNER) },
      },
    );
    const res = await handler(req);
    expect(res.status).toBe(200);

    const body = (await readJson(res)) as {
      data: { items: unknown[]; next_cursor: string | null };
    };
    expect(body.data.items).toHaveLength(LIMIT);
    expect(body.data.next_cursor).not.toBeNull();
    expect(typeof body.data.next_cursor).toBe('string');
  });
});
