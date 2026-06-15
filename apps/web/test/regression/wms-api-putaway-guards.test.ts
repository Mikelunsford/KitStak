// Regression suite for the WMS Body B Phase B3 putaway server-authority guards
// (wms-api /putaway). The SPA hides buttons; the server is authority. This file
// pins three load-bearing guards added on top of the B3 build:
//
//   (a) Cross-warehouse location guard. A putaway task in warehouse A must not
//       carry a dock / bin (source / suggested / actual) that physically lives
//       in warehouse B: that would upsert a bin_stock_levels row under the wrong
//       warehouse when the task completes. assertLocationInWarehouse 404s a
//       cross-warehouse location (NOT_FOUND, never 403, so no oracle leak).
//
//   (b) Terminal-state PATCH guard. A done or cancelled task has already posted
//       (or never will post) its immutable stock_movements; editing its
//       ledger-affecting fields out from under those rows returns 409
//       STATE_CONFLICT.
//
//   (c) lot capture (B4). The B3 fail-closed 422 guard is GONE. A non-null lot_id
//       on a putaway create / patch is now accepted when the lot is bound to the
//       task item, and 404s when the lot is cross-tenant, missing, or for a
//       different item (assertLotForItem).
//
//   (d) putaway lot auto-default (B4). When a create points at a receiving order
//       as its source and omits lot_id, the server defaults the lot from the
//       source receiving line iff EXACTLY ONE line matches the item and carries a
//       non-null lot; zero or multiple matches leave the lot null.
//
// The bundle gate (plugins.wms) is seeded ON so the dispatcher reaches the route
// table; we clear the 5-minute flag cache between cases with invalidateFlagCache,
// matching ops-api-receiving-transition-dock.test.ts.

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
import { invalidateFlagCache } from '../../../../supabase/functions/_shared/feature-flags.ts';

const ORG_A = '00000000-0000-4000-8000-0000000000a1';
const USER_A = '00000000-0000-4000-8000-0000000000b1';
const OWNER = { userId: USER_A, orgId: ORG_A, role: 'org_owner' as const };

const WAREHOUSE_ID = '00000000-0000-4000-8000-0000000000c1';
const OTHER_WAREHOUSE_ID = '00000000-0000-4000-8000-0000000000c2';
const ITEM_ID = '00000000-0000-4000-8000-0000000000d1';
// A second in-org item used to prove a lot bound to a DIFFERENT item 404s on a
// putaway whose item is ITEM_ID (the cross-item lot guard).
const OTHER_ITEM_ID = '00000000-0000-4000-8000-0000000000d2';
// A real, active, in-org location that lives in OTHER_WAREHOUSE_ID, not in the
// task's WAREHOUSE_ID, to exercise the cross-warehouse 404.
const FOREIGN_LOCATION_ID = '00000000-0000-4000-8000-0000000000f2';
// A real, active, in-org location that lives in the task's own WAREHOUSE_ID, used
// to seed a valid existing bin that a warehouse-moving PATCH must re-validate.
const HOME_LOCATION_ID = '00000000-0000-4000-8000-0000000000f1';
const DONE_TASK_ID = '00000000-0000-4000-8000-0000000000e9';
const ACTIVE_TASK_ID = '00000000-0000-4000-8000-0000000000e8';
// A real, active, in-org lot BOUND TO ITEM_ID, used to prove B4 lot capture is
// accepted when the lot's item matches the task / line item.
const LOT_ID = '00000000-0000-4000-8000-00000000a001';
// A real, active, in-org lot bound to OTHER_ITEM_ID, used to prove a lot for the
// WRONG item 404s (assertLotForItem) on a task whose item is ITEM_ID.
const OTHER_ITEM_LOT_ID = '00000000-0000-4000-8000-00000000a003';
// A lot id that does NOT exist in-org, used to prove the missing-lot 404.
const MISSING_LOT_ID = '00000000-0000-4000-8000-00000000a0ff';
// A receiving order plus a single line carrying LOT_ID for the auto-default.
const RECEIVING_ORDER_ID = '00000000-0000-4000-8000-0000000000aa';
const RECEIVING_ORDER_AMBIG_ID = '00000000-0000-4000-8000-0000000000ab';

// Build a mock state with the wms bundle gate ON plus the spine refs the create
// handler validates (warehouse, item) and a foreign-warehouse location. Extra
// row-sets (e.g. a seeded putaway_task) merge on top.
function makeWmsState(extra: Record<string, Array<Record<string, unknown>>> = {}) {
  return makeState({
    org_feature_flags: [
      { org_id: ORG_A, flag_key: 'plugins.wms', is_enabled: true, config: {} },
    ],
    warehouses: [
      { id: WAREHOUSE_ID, org_id: ORG_A, deleted_at: null },
      { id: OTHER_WAREHOUSE_ID, org_id: ORG_A, deleted_at: null },
    ],
    items: [
      { id: ITEM_ID, org_id: ORG_A, deleted_at: null },
      { id: OTHER_ITEM_ID, org_id: ORG_A, deleted_at: null },
    ],
    warehouse_locations: [
      {
        id: FOREIGN_LOCATION_ID,
        org_id: ORG_A,
        // belongs to OTHER_WAREHOUSE_ID, not the task's WAREHOUSE_ID.
        warehouse_id: OTHER_WAREHOUSE_ID,
        active: true,
        deleted_at: null,
      },
      {
        id: HOME_LOCATION_ID,
        org_id: ORG_A,
        warehouse_id: WAREHOUSE_ID,
        active: true,
        deleted_at: null,
      },
    ],
    // In-org active lots so a putaway create / patch can cite them (B4). LOT_ID
    // is bound to ITEM_ID (the task item); OTHER_ITEM_LOT_ID is bound to a
    // different item to exercise the cross-item lot 404 (assertLotForItem keys
    // on lots.item_id).
    lots: [
      { id: LOT_ID, org_id: ORG_A, item_id: ITEM_ID, status: 'active', deleted_at: null },
      { id: OTHER_ITEM_LOT_ID, org_id: ORG_A, item_id: OTHER_ITEM_ID, status: 'active', deleted_at: null },
    ],
    // A receiving order whose single line for ITEM_ID carries LOT_ID, plus an
    // ambiguous order with two lot-bearing lines for the same item.
    receiving_orders: [
      { id: RECEIVING_ORDER_ID, org_id: ORG_A, dock_location_id: null, deleted_at: null },
      { id: RECEIVING_ORDER_AMBIG_ID, org_id: ORG_A, dock_location_id: null, deleted_at: null },
    ],
    receiving_order_line_items: [
      {
        id: '00000000-0000-4000-8000-0000000000b8',
        org_id: ORG_A,
        receiving_order_id: RECEIVING_ORDER_ID,
        item_id: ITEM_ID,
        lot_id: LOT_ID,
      },
      // Ambiguous order: two lines for the same item with different lots, so the
      // auto-default leaves the lot null.
      {
        id: '00000000-0000-4000-8000-0000000000b9',
        org_id: ORG_A,
        receiving_order_id: RECEIVING_ORDER_AMBIG_ID,
        item_id: ITEM_ID,
        lot_id: LOT_ID,
      },
      {
        id: '00000000-0000-4000-8000-0000000000ba',
        org_id: ORG_A,
        receiving_order_id: RECEIVING_ORDER_AMBIG_ID,
        item_id: ITEM_ID,
        lot_id: '00000000-0000-4000-8000-00000000a002',
      },
    ],
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

describe('wms-api putaway server-authority guards (WMS Body B / B3)', () => {
  let handler: (req: Request) => Promise<Response> | Response;

  beforeAll(async () => {
    installDenoShim();
    resetCapturedHandler();
    await import('../../../../supabase/functions/wms-api/index.ts');
    handler = capturedHandler();
  });

  afterEach(() => {
    clearActiveMockState();
    invalidateFlagCache(ORG_A);
  });

  it('(a) POST /putaway with an actual_location in a DIFFERENT warehouse returns 404', async () => {
    setActiveMockState(makeWmsState());

    const req = new Request('https://example.test/putaway', {
      method: 'POST',
      headers: idemHeaders(),
      body: JSON.stringify({
        warehouse_id: WAREHOUSE_ID,
        item_id: ITEM_ID,
        quantity: '5',
        // the destination bin lives in OTHER_WAREHOUSE_ID: cross-warehouse.
        actual_location_id: FOREIGN_LOCATION_ID,
      }),
    });
    const res = await handler(req);
    expect(res.status).toBe(404);
    const body = await readJson(res);
    expect(body.error).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('(a) POST /putaway with a source_location in a DIFFERENT warehouse returns 404', async () => {
    setActiveMockState(makeWmsState());

    const req = new Request('https://example.test/putaway', {
      method: 'POST',
      headers: idemHeaders(),
      body: JSON.stringify({
        warehouse_id: WAREHOUSE_ID,
        item_id: ITEM_ID,
        quantity: '5',
        source_location_id: FOREIGN_LOCATION_ID,
      }),
    });
    const res = await handler(req);
    expect(res.status).toBe(404);
    const body = await readJson(res);
    expect(body.error).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('(b) PATCH /putaway/:id on a done task returns 409 STATE_CONFLICT', async () => {
    setActiveMockState(
      makeWmsState({
        putaway_tasks: [
          {
            id: DONE_TASK_ID,
            org_id: ORG_A,
            warehouse_id: WAREHOUSE_ID,
            item_id: ITEM_ID,
            quantity: '5',
            source_location_id: null,
            suggested_location_id: null,
            actual_location_id: null,
            lot_id: null,
            license_plate_id: null,
            source_entity_type: null,
            source_entity_id: null,
            status: 'done',
            started_at: '2026-06-15T00:00:00.000Z',
            completed_at: '2026-06-15T00:01:00.000Z',
            cancelled_at: null,
            notes: null,
            created_at: '2026-06-15T00:00:00.000Z',
            updated_at: '2026-06-15T00:01:00.000Z',
            deleted_at: null,
          },
        ],
      }),
    );

    const req = new Request(`https://example.test/putaway/${DONE_TASK_ID}`, {
      method: 'PATCH',
      headers: idemHeaders(),
      // an attempt to edit a ledger-affecting field on a posted task.
      body: JSON.stringify({ quantity: '9' }),
    });
    const res = await handler(req);
    expect(res.status).toBe(409);
    const body = await readJson(res);
    expect(body.error).toMatchObject({ code: 'STATE_CONFLICT' });
  });

  it('(c) POST /putaway with an in-org lot_id persists it (B4 lot capture, no 422)', async () => {
    const state = makeWmsState();
    setActiveMockState(state);

    const req = new Request('https://example.test/putaway', {
      method: 'POST',
      headers: idemHeaders(),
      body: JSON.stringify({
        warehouse_id: WAREHOUSE_ID,
        item_id: ITEM_ID,
        quantity: '5',
        lot_id: LOT_ID,
      }),
    });
    await handler(req);
    // Inspect the captured insert (the mock echoes the insert without DB
    // defaults, so the handler's PutawayTaskSchema.parse would not survive a
    // status assertion; this matches the receiving-project-link convention).
    const inserts = state.inserts.filter((u) => u.table === 'putaway_tasks');
    expect(inserts.length).toBe(1);
    expect(inserts[0]!.row.lot_id).toBe(LOT_ID);
  });

  it('(c) POST /putaway with a CROSS-TENANT lot_id returns 404 (assertRefInOrg)', async () => {
    setActiveMockState(makeWmsState());

    const req = new Request('https://example.test/putaway', {
      method: 'POST',
      headers: idemHeaders(),
      body: JSON.stringify({
        warehouse_id: WAREHOUSE_ID,
        item_id: ITEM_ID,
        quantity: '5',
        // a lot id with no in-org row: assertLotForItem 404s.
        lot_id: MISSING_LOT_ID,
      }),
    });
    const res = await handler(req);
    expect(res.status).toBe(404);
    const body = await readJson(res);
    expect(body.error).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('(c) POST /putaway with a lot bound to a DIFFERENT item returns 404 (assertLotForItem)', async () => {
    setActiveMockState(makeWmsState());

    const req = new Request('https://example.test/putaway', {
      method: 'POST',
      headers: idemHeaders(),
      body: JSON.stringify({
        warehouse_id: WAREHOUSE_ID,
        item_id: ITEM_ID,
        quantity: '5',
        // a real in-org lot, but bound to OTHER_ITEM_ID, not the task's ITEM_ID:
        // incoherent, so assertLotForItem 404s (never 403, no oracle leak).
        lot_id: OTHER_ITEM_LOT_ID,
      }),
    });
    const res = await handler(req);
    expect(res.status).toBe(404);
    const body = await readJson(res);
    expect(body.error).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('(d) POST /putaway from a receiving order auto-defaults the lot from the single matching line', async () => {
    const state = makeWmsState();
    setActiveMockState(state);

    const req = new Request('https://example.test/putaway', {
      method: 'POST',
      headers: idemHeaders(),
      body: JSON.stringify({
        warehouse_id: WAREHOUSE_ID,
        item_id: ITEM_ID,
        quantity: '5',
        // source a receiving order whose single line for ITEM_ID carries LOT_ID,
        // and omit lot_id so the server auto-defaults it.
        source_entity_type: 'receiving_order',
        source_entity_id: RECEIVING_ORDER_ID,
      }),
    });
    await handler(req);
    const inserts = state.inserts.filter((u) => u.table === 'putaway_tasks');
    expect(inserts.length).toBe(1);
    expect(inserts[0]!.row.lot_id).toBe(LOT_ID);
  });

  it('(d) POST /putaway from a receiving order with MULTIPLE lot lines leaves the lot null (ambiguous)', async () => {
    const state = makeWmsState();
    setActiveMockState(state);

    const req = new Request('https://example.test/putaway', {
      method: 'POST',
      headers: idemHeaders(),
      body: JSON.stringify({
        warehouse_id: WAREHOUSE_ID,
        item_id: ITEM_ID,
        quantity: '5',
        // two lines for ITEM_ID carry different lots: ambiguous, no default.
        source_entity_type: 'receiving_order',
        source_entity_id: RECEIVING_ORDER_AMBIG_ID,
      }),
    });
    await handler(req);
    const inserts = state.inserts.filter((u) => u.table === 'putaway_tasks');
    expect(inserts.length).toBe(1);
    expect(inserts[0]!.row.lot_id).toBeNull();
  });

  it('(d) a client-supplied lot_id wins over the auto-default', async () => {
    const state = makeWmsState();
    setActiveMockState(state);

    const req = new Request('https://example.test/putaway', {
      method: 'POST',
      headers: idemHeaders(),
      body: JSON.stringify({
        warehouse_id: WAREHOUSE_ID,
        item_id: ITEM_ID,
        quantity: '5',
        // an explicit lot plus an ambiguous receiving source: the explicit lot
        // is used and the ambiguous-source auto-default never runs.
        lot_id: LOT_ID,
        source_entity_type: 'receiving_order',
        source_entity_id: RECEIVING_ORDER_AMBIG_ID,
      }),
    });
    await handler(req);
    const inserts = state.inserts.filter((u) => u.table === 'putaway_tasks');
    expect(inserts.length).toBe(1);
    expect(inserts[0]!.row.lot_id).toBe(LOT_ID);
  });

  it('(a) PATCH /putaway/:id moving warehouse re-validates the EXISTING bin and 404s if it is now cross-warehouse', async () => {
    setActiveMockState(
      makeWmsState({
        putaway_tasks: [
          {
            id: ACTIVE_TASK_ID,
            org_id: ORG_A,
            warehouse_id: WAREHOUSE_ID,
            item_id: ITEM_ID,
            quantity: '5',
            source_location_id: null,
            suggested_location_id: null,
            // an existing valid bin in WAREHOUSE_ID (warehouse A).
            actual_location_id: HOME_LOCATION_ID,
            lot_id: null,
            license_plate_id: null,
            source_entity_type: null,
            source_entity_id: null,
            status: 'in_progress',
            started_at: '2026-06-15T00:00:00.000Z',
            completed_at: null,
            cancelled_at: null,
            notes: null,
            created_at: '2026-06-15T00:00:00.000Z',
            updated_at: '2026-06-15T00:00:00.000Z',
            deleted_at: null,
          },
        ],
      }),
    );

    const req = new Request(`https://example.test/putaway/${ACTIVE_TASK_ID}`, {
      method: 'PATCH',
      headers: idemHeaders(),
      // Move the task to OTHER_WAREHOUSE_ID without touching the bin. The existing
      // actual_location (in warehouse A) is now cross-warehouse and must 404, or it
      // would mis-file the bin row under the new warehouse on complete.
      body: JSON.stringify({ warehouse_id: OTHER_WAREHOUSE_ID }),
    });
    const res = await handler(req);
    expect(res.status).toBe(404);
    const body = await readJson(res);
    expect(body.error).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('(c) PATCH /putaway/:id with an in-org lot_id persists it (B4 lot capture, no 422)', async () => {
    const state = makeWmsState({
      putaway_tasks: [
        {
          id: ACTIVE_TASK_ID,
          org_id: ORG_A,
          warehouse_id: WAREHOUSE_ID,
          item_id: ITEM_ID,
          quantity: '5',
          source_location_id: null,
          suggested_location_id: null,
          actual_location_id: null,
          lot_id: null,
          license_plate_id: null,
          source_entity_type: null,
          source_entity_id: null,
          status: 'in_progress',
          started_at: '2026-06-15T00:00:00.000Z',
          completed_at: null,
          cancelled_at: null,
          notes: null,
          created_at: '2026-06-15T00:00:00.000Z',
          updated_at: '2026-06-15T00:00:00.000Z',
          deleted_at: null,
        },
      ],
    });
    setActiveMockState(state);

    const req = new Request(`https://example.test/putaway/${ACTIVE_TASK_ID}`, {
      method: 'PATCH',
      headers: idemHeaders(),
      body: JSON.stringify({ lot_id: LOT_ID }),
    });
    const res = await handler(req);
    expect(res.status).toBe(200);
    const updates = state.updates.filter((u) => u.table === 'putaway_tasks');
    expect(updates.length).toBeGreaterThan(0);
    expect(updates[updates.length - 1]!.patch.lot_id).toBe(LOT_ID);
  });

  it('(c) PATCH /putaway/:id with a CROSS-TENANT lot_id returns 404 (assertRefInOrg)', async () => {
    setActiveMockState(
      makeWmsState({
        putaway_tasks: [
          {
            id: ACTIVE_TASK_ID,
            org_id: ORG_A,
            warehouse_id: WAREHOUSE_ID,
            item_id: ITEM_ID,
            quantity: '5',
            source_location_id: null,
            suggested_location_id: null,
            actual_location_id: null,
            lot_id: null,
            license_plate_id: null,
            source_entity_type: null,
            source_entity_id: null,
            status: 'in_progress',
            started_at: '2026-06-15T00:00:00.000Z',
            completed_at: null,
            cancelled_at: null,
            notes: null,
            created_at: '2026-06-15T00:00:00.000Z',
            updated_at: '2026-06-15T00:00:00.000Z',
            deleted_at: null,
          },
        ],
      }),
    );

    const req = new Request(`https://example.test/putaway/${ACTIVE_TASK_ID}`, {
      method: 'PATCH',
      headers: idemHeaders(),
      body: JSON.stringify({ lot_id: MISSING_LOT_ID }),
    });
    const res = await handler(req);
    expect(res.status).toBe(404);
    const body = await readJson(res);
    expect(body.error).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('(c) PATCH /putaway/:id with a lot bound to a DIFFERENT item returns 404 (assertLotForItem)', async () => {
    setActiveMockState(
      makeWmsState({
        putaway_tasks: [
          {
            id: ACTIVE_TASK_ID,
            org_id: ORG_A,
            warehouse_id: WAREHOUSE_ID,
            // the task is for ITEM_ID; the patched lot belongs to OTHER_ITEM_ID.
            item_id: ITEM_ID,
            quantity: '5',
            source_location_id: null,
            suggested_location_id: null,
            actual_location_id: null,
            lot_id: null,
            license_plate_id: null,
            source_entity_type: null,
            source_entity_id: null,
            status: 'in_progress',
            started_at: '2026-06-15T00:00:00.000Z',
            completed_at: null,
            cancelled_at: null,
            notes: null,
            created_at: '2026-06-15T00:00:00.000Z',
            updated_at: '2026-06-15T00:00:00.000Z',
            deleted_at: null,
          },
        ],
      }),
    );

    const req = new Request(`https://example.test/putaway/${ACTIVE_TASK_ID}`, {
      method: 'PATCH',
      headers: idemHeaders(),
      body: JSON.stringify({ lot_id: OTHER_ITEM_LOT_ID }),
    });
    const res = await handler(req);
    expect(res.status).toBe(404);
    const body = await readJson(res);
    expect(body.error).toMatchObject({ code: 'NOT_FOUND' });
  });

  // -------------------------------------------------------------------------
  // POST /lots FSM-bypass guard (B4). The create schema OMITS status, so a
  // client-supplied status is dropped and the new lot always starts at the DB
  // default 'active'. Quarantine then flows only through quarantine_lot.
  // -------------------------------------------------------------------------
  it('POST /lots ignores a client-supplied status and creates an ACTIVE lot', async () => {
    const state = makeWmsState({ lots: [] });
    setActiveMockState(state);

    const req = new Request('https://example.test/lots', {
      method: 'POST',
      headers: idemHeaders(),
      body: JSON.stringify({
        item_id: ITEM_ID,
        lot_code: 'LOT-001',
        // an attempt to create a lot directly in quarantine: the schema omits
        // status, so this key is stripped and the insert carries no status (the
        // DB default 'active' applies).
        status: 'quarantined',
      }),
    });
    await handler(req);
    // Inspect the captured insert: the mock echoes the insert without DB
    // defaults, so we assert the handler did NOT thread a status onto the row
    // (the column is absent, leaving the DB default 'active'), matching the
    // putaway insert-inspection convention above.
    const inserts = state.inserts.filter((u) => u.table === 'lots');
    expect(inserts.length).toBe(1);
    expect(inserts[0]!.row.status).toBeUndefined();
    expect(inserts[0]!.row.lot_code).toBe('LOT-001');
    expect(inserts[0]!.row.item_id).toBe(ITEM_ID);
  });
});
