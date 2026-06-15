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
//   (c) lot_id fail-closed until B4. No lots table exists yet, so a non-null
//       lot_id on a putaway create / patch returns 422 VALIDATION_ERROR. B4
//       removes this guard when it wires lot capture.
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
// A real, active, in-org location that lives in OTHER_WAREHOUSE_ID, not in the
// task's WAREHOUSE_ID, to exercise the cross-warehouse 404.
const FOREIGN_LOCATION_ID = '00000000-0000-4000-8000-0000000000f2';
// A real, active, in-org location that lives in the task's own WAREHOUSE_ID, used
// to seed a valid existing bin that a warehouse-moving PATCH must re-validate.
const HOME_LOCATION_ID = '00000000-0000-4000-8000-0000000000f1';
const DONE_TASK_ID = '00000000-0000-4000-8000-0000000000e9';
const ACTIVE_TASK_ID = '00000000-0000-4000-8000-0000000000e8';
const LOT_ID = '00000000-0000-4000-8000-00000000a001';

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

  it('(c) POST /putaway with a non-null lot_id returns 422 (fail-closed until B4)', async () => {
    setActiveMockState(makeWmsState());

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
    const res = await handler(req);
    expect(res.status).toBe(422);
    const body = await readJson(res);
    expect(body.error).toMatchObject({ code: 'VALIDATION_ERROR' });
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

  it('(c) PATCH /putaway/:id with a non-null lot_id returns 422 (fail-closed until B4)', async () => {
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
      body: JSON.stringify({ lot_id: LOT_ID }),
    });
    const res = await handler(req);
    expect(res.status).toBe(422);
    const body = await readJson(res);
    expect(body.error).toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});
