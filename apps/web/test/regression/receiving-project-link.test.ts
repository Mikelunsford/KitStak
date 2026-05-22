// Regression suite for UX-Q6 — receiving_orders.project_id round-trip.
//
// Background (2026-05-22 UX revision walk-back, journal at
// 03-workspace/journal/2026-05-21-e2e-smoke-investigation.md): the
// operator's smoke walk surfaced that "New receiving order" launched
// from a project page never linked back to the project. Migration 0046
// had added the column + FK, but the ops-api ReceivingCreate schema
// stripped project_id silently (the dropped field never reached the
// INSERT), and the GET list endpoint had no ?project_id= filter to let
// ProjectDetailPage ask the server for only its own receiving orders.
//
// This test asserts:
//   1. POST /receiving-orders with project_id persists the value on the
//      inserted row (covering the ReceivingCreate schema extension).
//   2. GET /receiving-orders?project_id=<uuid> filters server-side
//      (covering the new where-clause on the list handler).
//   3. PATCH /receiving-orders/:id supports linking and unlinking the
//      project (covering the ReceivingUpdate partial schema).

import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
  installDenoShim,
  capturedHandler,
  resetCapturedHandler,
} from './_helpers/deno-shim.ts';
import { makeState, bearer } from './_helpers/supabase-mock.ts';
import {
  setActiveMockState,
  clearActiveMockState,
} from './_helpers/supabase-stub.ts';

const ORG_A = '00000000-0000-4000-8000-0000000000a1';
const USER_A = '00000000-0000-4000-8000-0000000000b1';
const OWNER = { userId: USER_A, orgId: ORG_A, role: 'org_owner' as const };

const RO_ID = '00000000-0000-4000-8000-0000000000e1';
const RO_ID_OTHER = '00000000-0000-4000-8000-0000000000e2';
const WAREHOUSE_ID = '00000000-0000-4000-8000-0000000000c1';
const PROJECT_ID = '00000000-0000-4000-8000-0000000000d1';
const PROJECT_ID_OTHER = '00000000-0000-4000-8000-0000000000d2';

function makeBaseState() {
  return makeState({
    org_feature_flags: [
      {
        org_id: ORG_A,
        flag_key: 'plugins.three_pl',
        is_enabled: true,
        config: {},
      },
    ],
    // Numbering chassis lookup expected by POST /receiving-orders. The
    // shim's next_doc_number RPC returns a deterministic stub when no
    // sequence row is present.
    doc_number_sequences: [],
  });
}

function makeStateWithReceiving(rows: Array<{
  id: string;
  project_id: string | null;
  status?: 'created' | 'in_progress' | 'received' | 'cancelled';
}>) {
  return makeState({
    org_feature_flags: [
      {
        org_id: ORG_A,
        flag_key: 'plugins.three_pl',
        is_enabled: true,
        config: {},
      },
    ],
    receiving_orders: rows.map((r) => ({
      id: r.id,
      org_id: ORG_A,
      receiving_number: `SMOKE-RO-${r.id.slice(-4)}`,
      purchase_order_id: null,
      warehouse_id: WAREHOUSE_ID,
      vendor_id: null,
      project_id: r.project_id,
      status: r.status ?? 'created',
      expected_date: null,
      received_date: null,
      reference: null,
      notes: null,
      payload: {},
      created_at: '2026-05-22T00:00:00.000Z',
      updated_at: '2026-05-22T00:00:00.000Z',
      deleted_at: null,
    })),
  });
}

function authHeaders(): Record<string, string> {
  return {
    authorization: bearer(OWNER),
    'content-type': 'application/json',
    'idempotency-key': crypto.randomUUID(),
  };
}

function getHeaders(): Record<string, string> {
  return {
    authorization: bearer(OWNER),
  };
}

describe('ops-api — receiving_orders.project_id round-trip (UX-Q6)', () => {
  let handler: (req: Request) => Promise<Response> | Response;

  beforeAll(async () => {
    installDenoShim();
    resetCapturedHandler();
    await import('../../../../supabase/functions/ops-api/index.ts');
    handler = capturedHandler();
  });

  afterEach(() => clearActiveMockState());

  it('POST /receiving-orders persists project_id on the inserted row', async () => {
    const state = makeBaseState();
    setActiveMockState(state);

    const req = new Request('https://example.test/receiving-orders', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        warehouse_id: WAREHOUSE_ID,
        project_id: PROJECT_ID,
      }),
    });
    await handler(req);

    // We inspect the captured insert row rather than the response body.
    // The supabase mock returns the freshly-inserted row from `insert()`
    // without filling DB-derived defaults (id, created_at, updated_at),
    // so the handler's ReceivingOrderSchema.parse(returned_row) would
    // not survive a status-code assertion. The insert side of the
    // contract is what UX-Q6 actually changes; matching the
    // auto-numbering-b8.test.ts pattern keeps the test honest.
    const inserts = state.inserts.filter((u) => u.table === 'receiving_orders');
    expect(inserts.length).toBe(1);
    expect(inserts[0]!.row.project_id).toBe(PROJECT_ID);
  });

  it('POST /receiving-orders without project_id inserts a row with no linkage', async () => {
    const state = makeBaseState();
    setActiveMockState(state);

    const req = new Request('https://example.test/receiving-orders', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        warehouse_id: WAREHOUSE_ID,
      }),
    });
    await handler(req);

    const inserts = state.inserts.filter((u) => u.table === 'receiving_orders');
    expect(inserts.length).toBe(1);
    // The inserted row spreads `...body` so a missing field is just absent.
    // The DB column default is NULL, which is the intended state.
    expect(inserts[0]!.row.project_id).toBeUndefined();
  });

  it('GET /receiving-orders?project_id=<uuid> filters to the matching project', async () => {
    const state = makeStateWithReceiving([
      { id: RO_ID, project_id: PROJECT_ID },
      { id: RO_ID_OTHER, project_id: PROJECT_ID_OTHER },
    ]);
    setActiveMockState(state);

    const req = new Request(
      `https://example.test/receiving-orders?project_id=${PROJECT_ID}`,
      {
        method: 'GET',
        headers: getHeaders(),
      },
    );
    const res = await handler(req);
    expect(res.status).toBe(200);

    const payload = (await res.json()) as Array<{ id: string; project_id: string | null }>;
    expect(payload.length).toBe(1);
    expect(payload[0]!.id).toBe(RO_ID);
    expect(payload[0]!.project_id).toBe(PROJECT_ID);
  });

  it('GET /receiving-orders without project_id returns both rows (no filter applied)', async () => {
    const state = makeStateWithReceiving([
      { id: RO_ID, project_id: PROJECT_ID },
      { id: RO_ID_OTHER, project_id: null },
    ]);
    setActiveMockState(state);

    const req = new Request('https://example.test/receiving-orders', {
      method: 'GET',
      headers: getHeaders(),
    });
    const res = await handler(req);
    expect(res.status).toBe(200);

    const payload = (await res.json()) as Array<{ id: string }>;
    expect(payload.length).toBe(2);
  });

  it('PATCH /receiving-orders/:id can link an existing receiving order to a project', async () => {
    const state = makeStateWithReceiving([
      { id: RO_ID, project_id: null },
    ]);
    setActiveMockState(state);

    const req = new Request(`https://example.test/receiving-orders/${RO_ID}`, {
      method: 'PATCH',
      headers: authHeaders(),
      body: JSON.stringify({ project_id: PROJECT_ID }),
    });
    const res = await handler(req);

    expect(res.status).toBe(200);

    const update = state.updates
      .filter((u) => u.table === 'receiving_orders')
      .find((u) => u.patch.project_id === PROJECT_ID);
    expect(update).toBeDefined();
  });

  it('PATCH /receiving-orders/:id can unlink (project_id = null)', async () => {
    const state = makeStateWithReceiving([
      { id: RO_ID, project_id: PROJECT_ID },
    ]);
    setActiveMockState(state);

    const req = new Request(`https://example.test/receiving-orders/${RO_ID}`, {
      method: 'PATCH',
      headers: authHeaders(),
      body: JSON.stringify({ project_id: null }),
    });
    const res = await handler(req);

    expect(res.status).toBe(200);

    const update = state.updates
      .filter((u) => u.table === 'receiving_orders')
      .find((u) => 'project_id' in u.patch && u.patch.project_id === null);
    expect(update).toBeDefined();
  });
});
