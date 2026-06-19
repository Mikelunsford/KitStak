// Regression suite for the ops-api server-driven list toolbar (Workstream C of
// the 2026-06-17 UI scan). The shipments and receiving-orders list handlers
// were converted to the shared keyset pattern (parseSort/parseSearch +
// .order(sortCol).order('id').limit(limit + 1) + paginateSorted), returning
// next_cursor in the response meta block.
//
// These tests lock the next_cursor plumbing only: that the handler fetches
// limit + 1 rows for overflow detection, returns exactly `limit` items, and
// emits a non-null next_cursor string in meta when more rows exist than the
// page size. The pure query-building logic (search ILIKE, the keyset .or()
// predicate, cursor encode/decode) is locked separately in list-query.test.ts,
// because the Supabase mock does not reproduce .or()/.ilike(). So these tests
// deliberately seed without ?search or ?cursor.

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
// ops-api is bundle-gated on plugins.three_pl. Tests must seed the flag row or
// the dispatcher returns 404 NOT_FOUND before any handler runs.
const THREE_PL_ON: Array<Record<string, unknown>> = [
  { org_id: ORG_A, flag_key: 'plugins.three_pl', is_enabled: true, config: {} },
];
const USER_A = '00000000-0000-4000-8000-0000000000b1';
const OWNER = { userId: USER_A, orgId: ORG_A, role: 'org_owner' as const };
const WAREHOUSE_ID = '00000000-0000-4000-8000-0000000000c1';

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

let handler: (req: Request) => Promise<Response> | Response;

beforeAll(async () => {
  installDenoShim();
  resetCapturedHandler();
  await import('../../../../supabase/functions/ops-api/index.ts');
  handler = capturedHandler();
});

afterEach(() => {
  clearActiveMockState();
  invalidateFlagCache(ORG_A);
});

// ---------------------------------------------------------------------------
// ops-api GET /shipments — keyset cursor in meta
// ---------------------------------------------------------------------------

describe('ops-api GET /shipments — list toolbar keyset cursor (Workstream C)', () => {
  it('emits a non-null meta.next_cursor when more shipments exist than the limit', async () => {
    const LIMIT = 5;
    const N = LIMIT + 3;
    const rows = Array.from({ length: N }).map((_, i) => ({
      id: uuid(i + 1),
      org_id: ORG_A,
      shipment_number: `SHP-2026-${(i + 1).toString().padStart(5, '0')}`,
      warehouse_id: WAREHOUSE_ID,
      customer_id: null,
      sales_order_id: null,
      project_id: null,
      status: 'created',
      ship_date: null,
      carrier: null,
      tracking_number: null,
      notes: null,
      payload: {},
      created_at: isoMinusMinutes(N - i),
      updated_at: isoMinusMinutes(N - i),
      deleted_at: null,
    }));
    const state: MockState = makeState({ shipments: rows, org_feature_flags: THREE_PL_ON });
    setActiveMockState(state);

    const req = new Request(`https://example.test/shipments?limit=${LIMIT}`, {
      method: 'GET',
      headers: { authorization: bearer(OWNER) },
    });
    const res = await handler(req);
    expect(res.status).toBe(200);

    const body = (await readJson(res)) as {
      data: unknown[];
      meta?: { next_cursor: string | null };
    };
    expect(body.data).toHaveLength(LIMIT);
    expect(body.meta?.next_cursor).not.toBeNull();
    expect(typeof body.meta?.next_cursor).toBe('string');
  });

  it('emits a null meta.next_cursor when the row set fits in one page', async () => {
    const LIMIT = 10;
    const N = 2;
    const rows = Array.from({ length: N }).map((_, i) => ({
      id: uuid(i + 1),
      org_id: ORG_A,
      shipment_number: `SHP-2026-${(i + 1).toString().padStart(5, '0')}`,
      warehouse_id: WAREHOUSE_ID,
      customer_id: null,
      sales_order_id: null,
      project_id: null,
      status: 'created',
      ship_date: null,
      carrier: null,
      tracking_number: null,
      notes: null,
      payload: {},
      created_at: isoMinusMinutes(N - i),
      updated_at: isoMinusMinutes(N - i),
      deleted_at: null,
    }));
    setActiveMockState(makeState({ shipments: rows, org_feature_flags: THREE_PL_ON }));

    const req = new Request(`https://example.test/shipments?limit=${LIMIT}`, {
      method: 'GET',
      headers: { authorization: bearer(OWNER) },
    });
    const res = await handler(req);
    expect(res.status).toBe(200);

    const body = (await readJson(res)) as {
      data: unknown[];
      meta?: { next_cursor: string | null };
    };
    expect(body.data).toHaveLength(N);
    expect(body.meta?.next_cursor ?? null).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// ops-api GET /receiving-orders — keyset cursor in meta
// ---------------------------------------------------------------------------

describe('ops-api GET /receiving-orders — list toolbar keyset cursor (Workstream C)', () => {
  it('emits a non-null meta.next_cursor when more receiving orders exist than the limit', async () => {
    const LIMIT = 4;
    const N = LIMIT + 5;
    const rows = Array.from({ length: N }).map((_, i) => ({
      id: uuid(i + 1),
      org_id: ORG_A,
      receiving_number: `RCV-2026-${(i + 1).toString().padStart(5, '0')}`,
      purchase_order_id: null,
      warehouse_id: WAREHOUSE_ID,
      vendor_id: null,
      project_id: null,
      dock_location_id: null,
      status: 'created',
      expected_date: null,
      received_date: null,
      reference: null,
      notes: null,
      payload: {},
      created_at: isoMinusMinutes(N - i),
      updated_at: isoMinusMinutes(N - i),
      deleted_at: null,
    }));
    setActiveMockState(makeState({ receiving_orders: rows, org_feature_flags: THREE_PL_ON }));

    const req = new Request(`https://example.test/receiving-orders?limit=${LIMIT}`, {
      method: 'GET',
      headers: { authorization: bearer(OWNER) },
    });
    const res = await handler(req);
    expect(res.status).toBe(200);

    const body = (await readJson(res)) as {
      data: unknown[];
      meta?: { next_cursor: string | null };
    };
    expect(body.data).toHaveLength(LIMIT);
    expect(body.meta?.next_cursor).not.toBeNull();
    expect(typeof body.meta?.next_cursor).toBe('string');
  });
});
