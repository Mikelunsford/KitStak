// Regression suite for WMS Body B receiving-to-dock server authority
// (F-Wave12-WMS-RECEIVE-DOCK-01). The dock (receiving_orders.dock_location_id)
// is accepted on EXACTLY ONE path: POST /receiving-orders/:id/transition, and
// ONLY when to === 'received', and ONLY when the caller's org has plugins.wms
// ON. It rides the SAME UPDATE that flips status -> received so the AFTER UPDATE
// OF status trigger (migration 0108) sees new.dock_location_id and stamps it
// onto every emitted movement.
//
// This file pins the load-bearing server-authority guarantee the constitution
// demands (the SPA hides buttons; the server is authority):
//
//   (a) plugins.wms OFF: a transition to 'received' that carries a VALID,
//       same-warehouse dock_location_id lands dock_location_id = NULL on the
//       row. The server forces NULL regardless of what the client sent, so a
//       wms-off org can never land a dock even with a real id.
//
//   (b) plugins.wms ON: a transition to 'received' with a valid same-warehouse
//       dock lands dock_location_id on the row.
//
// plugins.wms is read via getFlag, which the bundle gate also uses. We drive it
// by seeding org_feature_flags (the table getFlag reads) and clearing the
// 5-minute flag cache between cases with invalidateFlagCache, the established
// pattern in plugin-bundle-gate-three-pl.test.ts.

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

const RO_ID = '00000000-0000-4000-8000-0000000000e1';
const WAREHOUSE_ID = '00000000-0000-4000-8000-0000000000c1';
const OTHER_WAREHOUSE_ID = '00000000-0000-4000-8000-0000000000c2';
const DOCK_ID = '00000000-0000-4000-8000-0000000000f1';

// Build a state with the 3PL bundle gate on (so the bundle dispatcher reaches
// the route table) plus plugins.wms set to the requested value, an in_progress
// receiving order, and a dock living in dockWarehouseId (defaults to the order's
// own WAREHOUSE_ID so the assertDockInWarehouse same-warehouse check passes when
// WMS is on; pass a different warehouse to exercise the cross-warehouse 404).
function makeStateWithWms(wmsEnabled: boolean, dockWarehouseId: string = WAREHOUSE_ID) {
  return makeState({
    org_feature_flags: [
      {
        org_id: ORG_A,
        flag_key: 'plugins.three_pl',
        is_enabled: true,
        config: {},
      },
      {
        org_id: ORG_A,
        flag_key: 'plugins.wms',
        is_enabled: wmsEnabled,
        config: {},
      },
    ],
    // assertDockInWarehouse first calls assertRefInOrg('warehouse_locations'),
    // then re-reads warehouse_id with active = true; the dock must be active and
    // in WAREHOUSE_ID (same as the receiving order) for the same-warehouse check
    // to pass.
    warehouse_locations: [
      {
        id: DOCK_ID,
        org_id: ORG_A,
        warehouse_id: dockWarehouseId,
        active: true,
        deleted_at: null,
      },
    ],
    receiving_orders: [
      {
        id: RO_ID,
        org_id: ORG_A,
        receiving_number: 'WMS-RO-001',
        purchase_order_id: null,
        warehouse_id: WAREHOUSE_ID,
        vendor_id: null,
        project_id: null,
        dock_location_id: null,
        status: 'in_progress',
        expected_date: null,
        received_date: null,
        reference: null,
        notes: null,
        payload: {},
        created_at: '2026-06-15T00:00:00.000Z',
        updated_at: '2026-06-15T00:00:00.000Z',
        deleted_at: null,
      },
    ],
  });
}

function idemHeaders(): Record<string, string> {
  return {
    authorization: bearer(OWNER),
    'content-type': 'application/json',
    'idempotency-key': crypto.randomUUID(),
  };
}

describe('ops-api receiving-to-dock server authority on /transition (WMS Body B)', () => {
  let handler: (req: Request) => Promise<Response> | Response;

  beforeAll(async () => {
    installDenoShim();
    resetCapturedHandler();
    await import('../../../../supabase/functions/ops-api/index.ts');
    handler = capturedHandler();
  });

  afterEach(() => {
    clearActiveMockState();
    // getFlag caches per (org_id, flag_key) for 5 minutes; clear between the
    // wms-off and wms-on cases so a prior read does not leak across tests.
    invalidateFlagCache(ORG_A);
  });

  it('plugins.wms OFF: a valid same-warehouse dock is forced to NULL (server no-op)', async () => {
    const state = makeStateWithWms(false);
    setActiveMockState(state);

    const req = new Request(`https://example.test/receiving-orders/${RO_ID}/transition`, {
      method: 'POST',
      headers: idemHeaders(),
      body: JSON.stringify({ to: 'received', dock_location_id: DOCK_ID }),
    });
    const res = await handler(req);
    expect(res.status).toBe(200);

    const update = state.updates
      .filter((u) => u.table === 'receiving_orders')
      .find((u) => u.patch.status === 'received');
    expect(update).toBeDefined();
    // The dock is present in the patch and FORCED to null: the wms-off org can
    // never land a dock even with a valid same-warehouse id.
    expect(update!.patch).toHaveProperty('dock_location_id');
    expect(update!.patch.dock_location_id).toBeNull();
    // received_date still stamped (the B9 behaviour is unaffected).
    expect(update!.patch.received_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('plugins.wms ON: a valid same-warehouse dock lands on the row', async () => {
    const state = makeStateWithWms(true);
    setActiveMockState(state);

    const req = new Request(`https://example.test/receiving-orders/${RO_ID}/transition`, {
      method: 'POST',
      headers: idemHeaders(),
      body: JSON.stringify({ to: 'received', dock_location_id: DOCK_ID }),
    });
    const res = await handler(req);
    expect(res.status).toBe(200);

    const update = state.updates
      .filter((u) => u.table === 'receiving_orders')
      .find((u) => u.patch.status === 'received');
    expect(update).toBeDefined();
    expect(update!.patch.dock_location_id).toBe(DOCK_ID);
    expect(update!.patch.received_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('plugins.wms ON: a non-received transition never writes a dock', async () => {
    const state = makeStateWithWms(true);
    setActiveMockState(state);

    const req = new Request(`https://example.test/receiving-orders/${RO_ID}/transition`, {
      method: 'POST',
      headers: idemHeaders(),
      // dock supplied but the transition is to cancelled, not received.
      body: JSON.stringify({ to: 'cancelled', dock_location_id: DOCK_ID }),
    });
    const res = await handler(req);
    expect(res.status).toBe(200);

    const update = state.updates
      .filter((u) => u.table === 'receiving_orders')
      .find((u) => u.patch.status === 'cancelled');
    expect(update).toBeDefined();
    // No dock and no received_date on a non-received transition.
    expect(update!.patch).not.toHaveProperty('dock_location_id');
    expect(update!.patch).not.toHaveProperty('received_date');
  });

  it('plugins.wms ON: a dock in a different warehouse is rejected 404', async () => {
    // The dock is a real, active, in-org warehouse_location, but it belongs to
    // OTHER_WAREHOUSE_ID, not the receiving order's WAREHOUSE_ID. The same-warehouse
    // guard must 404 so a dock can never mis-file the bin row under the wrong
    // warehouse, and the transition to received must not be written.
    const state = makeStateWithWms(true, OTHER_WAREHOUSE_ID);
    setActiveMockState(state);

    const req = new Request(`https://example.test/receiving-orders/${RO_ID}/transition`, {
      method: 'POST',
      headers: idemHeaders(),
      body: JSON.stringify({ to: 'received', dock_location_id: DOCK_ID }),
    });
    const res = await handler(req);
    expect(res.status).toBe(404);

    const update = state.updates
      .filter((u) => u.table === 'receiving_orders')
      .find((u) => u.patch.status === 'received');
    expect(update).toBeUndefined();
  });
});
