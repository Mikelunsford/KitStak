// Regression suite for the Wave 13 / R-W13-WMS-01 set-destination route
// (wms-api POST /putaway/:id/destination). Pairs with migration 0114, which
// makes complete_putaway_task RAISE STATE_CONFLICT on a null destination instead
// of marking the task done with zero movements. This file pins the edge layer:
//
//   - a valid in-warehouse bin calls set_putaway_destination with the right
//     args and returns 200,
//   - a bin in a DIFFERENT warehouse 404s before the RPC (cross-warehouse guard),
//   - a missing actual_location_id is a 422 schema rejection,
//   - the RPC's STATE_CONFLICT (e.g. a done task) maps to 409,
//   - the RPC's NOT_FOUND (cross-tenant) maps to 404,
//   - a complete whose RPC raises the new null-destination STATE_CONFLICT maps
//     to 409 (the server-authority half of the fix; the SPA only hides buttons).
//
// The bundle gate (plugins.wms) is seeded ON; the 5-minute flag cache is cleared
// between cases, matching wms-api-putaway-guards.test.ts.

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
const HOME_BIN_ID = '00000000-0000-4000-8000-0000000000f1';
const FOREIGN_BIN_ID = '00000000-0000-4000-8000-0000000000f2';
const TASK_ID = '00000000-0000-4000-8000-0000000000e8';
const DONE_TASK_ID = '00000000-0000-4000-8000-0000000000e9';

function makeTaskRow(over: Record<string, unknown> = {}) {
  return {
    id: TASK_ID,
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
    ...over,
  };
}

function makeWmsState(extra: Record<string, Array<Record<string, unknown>>> = {}) {
  return makeState({
    org_feature_flags: [
      { org_id: ORG_A, flag_key: 'plugins.wms', is_enabled: true, config: {} },
    ],
    warehouses: [
      { id: WAREHOUSE_ID, org_id: ORG_A, deleted_at: null },
      { id: OTHER_WAREHOUSE_ID, org_id: ORG_A, deleted_at: null },
    ],
    items: [{ id: ITEM_ID, org_id: ORG_A, deleted_at: null }],
    warehouse_locations: [
      {
        id: HOME_BIN_ID,
        org_id: ORG_A,
        warehouse_id: WAREHOUSE_ID,
        active: true,
        deleted_at: null,
      },
      {
        id: FOREIGN_BIN_ID,
        org_id: ORG_A,
        warehouse_id: OTHER_WAREHOUSE_ID,
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

describe('wms-api set-destination route (WMS R-W13-WMS-01)', () => {
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

  it('an in-warehouse bin calls set_putaway_destination with the right args and returns 200', async () => {
    const state = makeWmsState({ putaway_tasks: [makeTaskRow()] });
    setActiveMockState(state);

    const req = new Request(`https://example.test/putaway/${TASK_ID}/destination`, {
      method: 'POST',
      headers: idemHeaders(),
      body: JSON.stringify({ actual_location_id: HOME_BIN_ID }),
    });
    const res = await handler(req);
    expect(res.status).toBe(200);
    const call = state.rpcCalls.find((c) => c.name === 'set_putaway_destination');
    expect(call).toBeTruthy();
    expect(call!.args).toMatchObject({
      p_putaway_task_id: TASK_ID,
      p_actual_location_id: HOME_BIN_ID,
      p_actor: USER_A,
      p_caller_org_id: ORG_A,
    });
  });

  it('a bin in a DIFFERENT warehouse 404s BEFORE the RPC (cross-warehouse guard)', async () => {
    const state = makeWmsState({ putaway_tasks: [makeTaskRow()] });
    setActiveMockState(state);

    const req = new Request(`https://example.test/putaway/${TASK_ID}/destination`, {
      method: 'POST',
      headers: idemHeaders(),
      body: JSON.stringify({ actual_location_id: FOREIGN_BIN_ID }),
    });
    const res = await handler(req);
    expect(res.status).toBe(404);
    const body = await readJson(res);
    expect(body.error).toMatchObject({ code: 'NOT_FOUND' });
    // the RPC must NOT have run (the guard is before it).
    expect(state.rpcCalls.find((c) => c.name === 'set_putaway_destination')).toBeUndefined();
  });

  it('a missing actual_location_id is rejected by the schema (422, no RPC)', async () => {
    const state = makeWmsState({ putaway_tasks: [makeTaskRow()] });
    setActiveMockState(state);

    const req = new Request(`https://example.test/putaway/${TASK_ID}/destination`, {
      method: 'POST',
      headers: idemHeaders(),
      body: JSON.stringify({}),
    });
    const res = await handler(req);
    expect(res.status).toBe(422);
    expect(state.rpcCalls.find((c) => c.name === 'set_putaway_destination')).toBeUndefined();
  });

  it("the RPC's STATE_CONFLICT (e.g. a done task) maps to 409", async () => {
    const state = makeWmsState({
      putaway_tasks: [makeTaskRow({ id: DONE_TASK_ID, status: 'done' })],
    });
    state.rpcResults['set_putaway_destination'] = {
      data: null,
      error: { message: 'STATE_CONFLICT: putaway destination cannot be set (was done)' },
    };
    setActiveMockState(state);

    const req = new Request(`https://example.test/putaway/${DONE_TASK_ID}/destination`, {
      method: 'POST',
      headers: idemHeaders(),
      body: JSON.stringify({ actual_location_id: HOME_BIN_ID }),
    });
    const res = await handler(req);
    expect(res.status).toBe(409);
    const body = await readJson(res);
    expect(body.error).toMatchObject({ code: 'STATE_CONFLICT' });
  });

  it("the RPC's NOT_FOUND (cross-tenant) maps to 404", async () => {
    const state = makeWmsState({ putaway_tasks: [makeTaskRow()] });
    state.rpcResults['set_putaway_destination'] = {
      data: null,
      error: { message: 'NOT_FOUND: putaway task not found' },
    };
    setActiveMockState(state);

    const req = new Request(`https://example.test/putaway/${TASK_ID}/destination`, {
      method: 'POST',
      headers: idemHeaders(),
      body: JSON.stringify({ actual_location_id: HOME_BIN_ID }),
    });
    const res = await handler(req);
    expect(res.status).toBe(404);
    const body = await readJson(res);
    expect(body.error).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('a complete whose RPC raises the new null-destination STATE_CONFLICT maps to 409', async () => {
    const state = makeWmsState({ putaway_tasks: [makeTaskRow()] });
    state.rpcResults['complete_putaway_task'] = {
      data: null,
      error: { message: 'STATE_CONFLICT: putaway requires a destination bin' },
    };
    setActiveMockState(state);

    const req = new Request(`https://example.test/putaway/${TASK_ID}/complete`, {
      method: 'POST',
      headers: idemHeaders(),
    });
    const res = await handler(req);
    expect(res.status).toBe(409);
    const body = await readJson(res);
    expect(body.error).toMatchObject({ code: 'STATE_CONFLICT' });
  });
});
