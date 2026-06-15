// Regression suite for the WMS Body B Phase B4 cross-item lot guard on the
// ops-api receiving line-item endpoints. A lot is bound to exactly one item
// (lots.item_id NOT NULL), so a lot_id on a receiving line whose lot.item_id
// differs from the line item_id is incoherent and must be rejected. The server
// is the authority (assertLotForItem); the SPA item-change reset is a
// convenience surface, not the gate.
//
//   * a receiving line POST with a lot bound to the SAME item is accepted
//     (the lot persists onto the line).
//   * a receiving line POST with a lot bound to a DIFFERENT item 404s
//     (NOT_FOUND, never 403, no cross-item oracle leak).
//   * a PATCH that changes ONLY the item on a lot-bearing line re-validates the
//     retained lot against the new item and 404s when it no longer matches (the
//     symmetric guard: the lot guard fires on lot change OR item change).
//   * a PATCH lot bound to a different item 404s via the current-line snapshot;
//     a same-item lot patch persists.
//
// The bundle gate (plugins.three_pl) is seeded ON so the dispatcher reaches the
// route table, matching ops-api-line-validation.test.ts.

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

const ITEM_ID = '00000000-0000-4000-8000-0000000000d1';
const OTHER_ITEM_ID = '00000000-0000-4000-8000-0000000000d2';
const RECEIVING_ORDER_ID = '00000000-0000-4000-8000-0000000000aa';
// A lot bound to ITEM_ID (matches the line item) and a lot bound to a different
// item (the cross-item 404 case).
const LOT_ID = '00000000-0000-4000-8000-00000000a001';
const OTHER_ITEM_LOT_ID = '00000000-0000-4000-8000-00000000a003';
const LINE_ID = '00000000-0000-4000-8000-0000000000b8';

// plugins.three_pl on for ORG_A (ops-api's dispatcher 404s if the gate is off),
// plus the spine refs the line POST validates and the two lots.
function makeStateWithFlag(extra: Record<string, Array<Record<string, unknown>>> = {}) {
  return makeState({
    org_feature_flags: [
      { org_id: ORG_A, flag_key: 'plugins.three_pl', is_enabled: true, config: {} },
    ],
    receiving_orders: [
      { id: RECEIVING_ORDER_ID, org_id: ORG_A, deleted_at: null },
    ],
    items: [
      { id: ITEM_ID, org_id: ORG_A, deleted_at: null },
      { id: OTHER_ITEM_ID, org_id: ORG_A, deleted_at: null },
    ],
    lots: [
      { id: LOT_ID, org_id: ORG_A, item_id: ITEM_ID, status: 'active', deleted_at: null },
      { id: OTHER_ITEM_LOT_ID, org_id: ORG_A, item_id: OTHER_ITEM_ID, status: 'active', deleted_at: null },
    ],
    receiving_order_line_items: [],
    ...extra,
  });
}

function idemHeaders(): Record<string, string> {
  return {
    authorization: bearer(OWNER),
    'content-type': 'application/json',
    'idempotency-key': crypto.randomUUID(),
  };
}

async function readJson(res: Response): Promise<{ error?: { code?: string } }> {
  return JSON.parse(await res.text());
}

describe('ops-api receiving line cross-item lot guard (WMS Body B / B4)', () => {
  let handler: (req: Request) => Promise<Response> | Response;

  beforeAll(async () => {
    installDenoShim();
    resetCapturedHandler();
    await import('../../../../supabase/functions/ops-api/index.ts');
    handler = capturedHandler();
  });

  afterEach(() => clearActiveMockState());

  it('POST line-items with a lot bound to the SAME item persists the lot', async () => {
    const state = makeStateWithFlag();
    setActiveMockState(state);

    const req = new Request(
      `https://example.test/receiving-orders/${RECEIVING_ORDER_ID}/line-items`,
      {
        method: 'POST',
        headers: idemHeaders(),
        body: JSON.stringify({ item_id: ITEM_ID, quantity: '3', lot_id: LOT_ID }),
      },
    );
    await handler(req);
    // The mock echoes the insert without DB defaults, so we assert against the
    // captured insert rather than the parsed response (same convention as the
    // wms-api putaway suite).
    const inserts = state.inserts.filter((u) => u.table === 'receiving_order_line_items');
    expect(inserts.length).toBe(1);
    expect(inserts[0]!.row.lot_id).toBe(LOT_ID);
    expect(inserts[0]!.row.item_id).toBe(ITEM_ID);
  });

  it('POST line-items with a lot bound to a DIFFERENT item returns 404 (assertLotForItem)', async () => {
    setActiveMockState(makeStateWithFlag());

    const req = new Request(
      `https://example.test/receiving-orders/${RECEIVING_ORDER_ID}/line-items`,
      {
        method: 'POST',
        headers: idemHeaders(),
        body: JSON.stringify({
          item_id: ITEM_ID,
          quantity: '3',
          // a real in-org lot, but bound to OTHER_ITEM_ID, not the line's
          // ITEM_ID: incoherent, so assertLotForItem 404s (never 403).
          lot_id: OTHER_ITEM_LOT_ID,
        }),
      },
    );
    const res = await handler(req);
    expect(res.status).toBe(404);
    const body = await readJson(res);
    expect(body.error).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('PATCH changing ONLY the item on a lot-bearing line 404s the now-incoherent lot', async () => {
    // The line already carries LOT_ID (bound to ITEM_ID). Patching the item to
    // OTHER_ITEM_ID with no lot_id in the body must re-validate the RETAINED lot
    // against the new item via the snapshot and 404 (the symmetric guard).
    setActiveMockState(
      makeStateWithFlag({
        receiving_order_line_items: [
          { id: LINE_ID, org_id: ORG_A, receiving_order_id: RECEIVING_ORDER_ID, item_id: ITEM_ID, lot_id: LOT_ID },
        ],
      }),
    );
    const req = new Request(
      `https://example.test/receiving-orders/${RECEIVING_ORDER_ID}/line-items/${LINE_ID}`,
      { method: 'PATCH', headers: idemHeaders(), body: JSON.stringify({ item_id: OTHER_ITEM_ID }) },
    );
    const res = await handler(req);
    expect(res.status).toBe(404);
    expect((await readJson(res)).error).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('PATCH with a lot bound to a different item 404s via the line snapshot', async () => {
    setActiveMockState(
      makeStateWithFlag({
        receiving_order_line_items: [
          { id: LINE_ID, org_id: ORG_A, receiving_order_id: RECEIVING_ORDER_ID, item_id: ITEM_ID, lot_id: null },
        ],
      }),
    );
    const req = new Request(
      `https://example.test/receiving-orders/${RECEIVING_ORDER_ID}/line-items/${LINE_ID}`,
      { method: 'PATCH', headers: idemHeaders(), body: JSON.stringify({ lot_id: OTHER_ITEM_LOT_ID }) },
    );
    const res = await handler(req);
    expect(res.status).toBe(404);
    expect((await readJson(res)).error).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('PATCH with a same-item lot persists it', async () => {
    const state = makeStateWithFlag({
      receiving_order_line_items: [
        { id: LINE_ID, org_id: ORG_A, receiving_order_id: RECEIVING_ORDER_ID, item_id: ITEM_ID, lot_id: null },
      ],
    });
    setActiveMockState(state);
    const req = new Request(
      `https://example.test/receiving-orders/${RECEIVING_ORDER_ID}/line-items/${LINE_ID}`,
      { method: 'PATCH', headers: idemHeaders(), body: JSON.stringify({ lot_id: LOT_ID }) },
    );
    await handler(req);
    const updates = state.updates.filter((u) => u.table === 'receiving_order_line_items');
    expect(updates.length).toBe(1);
    expect(updates[0]!.patch.lot_id).toBe(LOT_ID);
  });
});
