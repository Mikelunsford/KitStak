// Regression suite for ADR 0004 unit 3: quotes-api tier CRUD, exercised through
// the real quotes-api handler under the Supabase mock.
//
// Covers the four tier endpoints (create / update / delete / reorder) plus the
// new tier_id on the line create path:
//   - createTier: 201, inserts a quote_tiers row, appends sort_order after the
//     existing tiers, and recomputes (a new tier flips the quote to the tier
//     grain so the header total moves). Guards: 409 on a locked quote, 404 on a
//     missing / cross-org quote.
//   - updateTier: 200, patches only the sent metadata, and does NOT recompute
//     (per-tier totals are derived from lines, not metadata).
//   - deleteTier: 200, recomputes (cascade removes the tier's lines; the last
//     tier going flips the quote back to non-tiered).
//   - reorderTiers: 200, sets sort_order by index; 422 when the id set does not
//     match exactly the quote's tiers.
//   - addLineItem: carries a valid tier_id; rejects a tier from another quote
//     with 404 (quote-scoped, never a cross-quote leak).

import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
  installDenoShim,
  capturedHandler,
  resetCapturedHandler,
} from './_helpers/deno-shim.ts';
import { makeState, bearer, type MockState } from './_helpers/supabase-mock.ts';
import {
  setActiveMockState,
  clearActiveMockState,
} from './_helpers/supabase-stub.ts';
import { invalidateFlagCache } from '../../../../supabase/functions/_shared/feature-flags.ts';

const ORG_A = '00000000-0000-4000-8000-0000000000a1';
const USER_A = '00000000-0000-4000-8000-0000000000b1';
const OWNER = { userId: USER_A, orgId: ORG_A, role: 'org_owner' as const };

const QUOTE_ID = '00000000-0000-4000-8000-0000000000d1';
const OTHER_QUOTE = '00000000-0000-4000-8000-0000000000d2';
const TIER_1 = '00000000-0000-4000-8000-000000000c01';
const TIER_2 = '00000000-0000-4000-8000-000000000c02';
const TIER_3 = '00000000-0000-4000-8000-000000000c03';
const FOREIGN_TIER = '00000000-0000-4000-8000-000000000cff';

function idemHeaders(): Record<string, string> {
  return {
    authorization: bearer(OWNER),
    'content-type': 'application/json',
    'idempotency-key': crypto.randomUUID(),
  };
}

interface QuoteStateOpts {
  quoteState?: string;
  withQuote?: boolean;
  tiers?: Array<Record<string, unknown>>;
}

function makeQuoteState(opts: QuoteStateOpts = {}): MockState {
  const quotes = opts.withQuote === false
    ? []
    : [{ id: QUOTE_ID, org_id: ORG_A, state: opts.quoteState ?? 'draft' }];
  const state = makeState({
    org_feature_flags: [
      { org_id: ORG_A, flag_key: 'plugins.three_pl', is_enabled: true, config: {} },
    ],
    quotes,
    quote_tiers: opts.tiers ?? [],
    quote_line_items: [],
    taxes: [],
  });
  state.rpcResults['recompute_quote_totals'] = { data: null, error: null };
  return state;
}

function post(path: string, body: unknown): Request {
  return new Request(`https://example.test${path}`, {
    method: 'POST', headers: idemHeaders(), body: JSON.stringify(body),
  });
}
function patch(path: string, body: unknown): Request {
  return new Request(`https://example.test${path}`, {
    method: 'PATCH', headers: idemHeaders(), body: JSON.stringify(body),
  });
}
function del(path: string): Request {
  return new Request(`https://example.test${path}`, {
    method: 'DELETE', headers: idemHeaders(),
  });
}

async function readJson(res: Response): Promise<{
  status: number;
  json: { data?: unknown; error?: { code?: string } };
}> {
  return { status: res.status, json: JSON.parse(await res.text()) };
}

function recomputeCalls(state: MockState): number {
  return state.rpcCalls.filter((c) => c.name === 'recompute_quote_totals').length;
}
function tierInserts(state: MockState): Array<Record<string, unknown>> {
  return state.inserts.filter((i) => i.table === 'quote_tiers').map((i) => i.row);
}

describe('quotes-api tier CRUD (ADR 0004)', () => {
  let handler: (req: Request) => Promise<Response> | Response;

  beforeAll(async () => {
    installDenoShim();
    resetCapturedHandler();
    await import('../../../../supabase/functions/quotes-api/index.ts');
    handler = capturedHandler();
  });

  afterEach(() => {
    clearActiveMockState();
    invalidateFlagCache(ORG_A);
  });

  it('creates a tier on a draft quote, sort_order 0, and recomputes', async () => {
    const state = makeQuoteState();
    setActiveMockState(state);

    const res = await handler(post(`/quotes/${QUOTE_ID}/tiers`, { label: 'Tier A' }));
    const { status } = await readJson(res);
    expect(status).toBe(201);

    const inserts = tierInserts(state);
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({
      quote_id: QUOTE_ID, label: 'Tier A', sort_order: 0,
      created_by: USER_A, updated_by: USER_A,
    });
    expect(recomputeCalls(state)).toBe(1);
  });

  it('appends a new tier after the existing tiers (sort_order = max + 1)', async () => {
    const state = makeQuoteState({
      tiers: [
        { id: TIER_1, quote_id: QUOTE_ID, label: 'A', sort_order: 0 },
        { id: TIER_2, quote_id: QUOTE_ID, label: 'B', sort_order: 1 },
      ],
    });
    setActiveMockState(state);

    await handler(post(`/quotes/${QUOTE_ID}/tiers`, { label: 'C' }));
    const inserts = tierInserts(state);
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({ label: 'C', sort_order: 2 });
  });

  it('honours an explicit sort_order on create', async () => {
    const state = makeQuoteState();
    setActiveMockState(state);

    await handler(post(`/quotes/${QUOTE_ID}/tiers`, { label: 'A', sort_order: 5, break_quantity_e3: 600000 }));
    const inserts = tierInserts(state);
    expect(inserts[0]).toMatchObject({ sort_order: 5, break_quantity_e3: 600000 });
  });

  it('rejects creating a tier on a non-editable quote with 409', async () => {
    const state = makeQuoteState({ quoteState: 'approved' });
    setActiveMockState(state);

    const res = await handler(post(`/quotes/${QUOTE_ID}/tiers`, { label: 'A' }));
    const { status, json } = await readJson(res);
    expect(status).toBe(409);
    expect(json.error?.code).toBe('STATE_CONFLICT');
    expect(tierInserts(state)).toHaveLength(0);
    expect(recomputeCalls(state)).toBe(0);
  });

  it('returns 404 creating a tier on a missing or cross-org quote', async () => {
    const state = makeQuoteState({ withQuote: false });
    setActiveMockState(state);

    const res = await handler(post(`/quotes/${QUOTE_ID}/tiers`, { label: 'A' }));
    expect((await readJson(res)).status).toBe(404);
    expect(tierInserts(state)).toHaveLength(0);
  });

  it('updates a tier label without recomputing', async () => {
    const state = makeQuoteState({
      tiers: [{ id: TIER_1, quote_id: QUOTE_ID, label: 'A', sort_order: 0 }],
    });
    setActiveMockState(state);

    const res = await handler(patch(`/quotes/${QUOTE_ID}/tiers/${TIER_1}`, { label: 'Renamed' }));
    expect((await readJson(res)).status).toBe(200);

    const tierUpdate = state.updates.find((u) => u.table === 'quote_tiers');
    expect(tierUpdate?.patch).toMatchObject({ label: 'Renamed', updated_by: USER_A });
    expect(recomputeCalls(state)).toBe(0);
  });

  it('deletes a tier and recomputes (cascade clears its lines)', async () => {
    const state = makeQuoteState({
      tiers: [{ id: TIER_1, quote_id: QUOTE_ID, label: 'A', sort_order: 0 }],
    });
    setActiveMockState(state);

    const res = await handler(del(`/quotes/${QUOTE_ID}/tiers/${TIER_1}`));
    const { status, json } = await readJson(res);
    expect(status).toBe(200);
    expect((json.data as { deleted?: boolean })?.deleted).toBe(true);
    expect(recomputeCalls(state)).toBe(1);
  });

  it('reorders tiers by index and does not recompute', async () => {
    const state = makeQuoteState({
      tiers: [
        { id: TIER_1, quote_id: QUOTE_ID, label: 'A', sort_order: 0 },
        { id: TIER_2, quote_id: QUOTE_ID, label: 'B', sort_order: 1 },
        { id: TIER_3, quote_id: QUOTE_ID, label: 'C', sort_order: 2 },
      ],
    });
    setActiveMockState(state);

    const res = await handler(
      post(`/quotes/${QUOTE_ID}/tiers/reorder`, { tier_ids: [TIER_3, TIER_1, TIER_2] }),
    );
    expect((await readJson(res)).status).toBe(200);

    const orderUpdates = state.updates.filter((u) => u.table === 'quote_tiers');
    const byTier = new Map(
      orderUpdates.map((u) => [u.filters.find((f) => f.col === 'id')?.val, u.patch.sort_order]),
    );
    expect(byTier.get(TIER_3)).toBe(0);
    expect(byTier.get(TIER_1)).toBe(1);
    expect(byTier.get(TIER_2)).toBe(2);
    expect(recomputeCalls(state)).toBe(0);
  });

  it('rejects a reorder whose id set does not match the quote tiers (422)', async () => {
    const state = makeQuoteState({
      tiers: [
        { id: TIER_1, quote_id: QUOTE_ID, label: 'A', sort_order: 0 },
        { id: TIER_2, quote_id: QUOTE_ID, label: 'B', sort_order: 1 },
      ],
    });
    setActiveMockState(state);

    const res = await handler(
      post(`/quotes/${QUOTE_ID}/tiers/reorder`, { tier_ids: [TIER_1] }),
    );
    const { status, json } = await readJson(res);
    expect(status).toBe(422);
    expect(json.error?.code).toBe('VALIDATION_ERROR');
  });

  it('adds a line carrying a valid tier_id of the same quote', async () => {
    const state = makeQuoteState({
      tiers: [{ id: TIER_1, quote_id: QUOTE_ID, label: 'A', sort_order: 0 }],
    });
    setActiveMockState(state);

    const res = await handler(
      post(`/quotes/${QUOTE_ID}/line-items`, { name: 'Widget', tier_id: TIER_1 }),
    );
    expect((await readJson(res)).status).toBe(201);

    const lineInsert = state.inserts.find((i) => i.table === 'quote_line_items');
    expect(lineInsert?.row).toMatchObject({ quote_id: QUOTE_ID, name: 'Widget', tier_id: TIER_1 });
    expect(recomputeCalls(state)).toBe(1);
  });

  it('rejects a line whose tier_id belongs to another quote with 404', async () => {
    const state = makeQuoteState({
      tiers: [{ id: FOREIGN_TIER, quote_id: OTHER_QUOTE, label: 'X', sort_order: 0 }],
    });
    setActiveMockState(state);

    const res = await handler(
      post(`/quotes/${QUOTE_ID}/line-items`, { name: 'Widget', tier_id: FOREIGN_TIER }),
    );
    expect((await readJson(res)).status).toBe(404);
    expect(state.inserts.filter((i) => i.table === 'quote_line_items')).toHaveLength(0);
  });
});
