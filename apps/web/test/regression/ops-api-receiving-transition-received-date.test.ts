// Regression suite for B9 — receiving_orders.received_date must be stamped
// when transitioning to 'received' via the generic state-machine endpoint.
//
// Background (2026-05-21 E2E smoke walk, journal at
// 03-workspace/journal/2026-05-21-e2e-smoke-investigation.md): the SPA
// detail-page state-machine button posts to
//   POST /receiving-orders/:id/transition  (generic FSM transition)
// not the dedicated
//   POST /receiving-orders/:id/receive     (stamps received_date)
// endpoint. Before this fix, the generic /transition handler only updated
// `status`, leaving `received_date` NULL. The detail page rendered a blank
// "Received" date even though the row was in 'received' state.
//
// This test asserts:
//   1. /transition with to='received' stamps received_date (YYYY-MM-DD).
//   2. /transition with to='cancelled' (or any other terminal) does NOT
//      stamp received_date — only the received-state transition does.
//   3. The date format is YYYY-MM-DD to match the `date` column type in
//      migration 0032_ops_receiving_production_shipments.sql.

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
const WAREHOUSE_ID = '00000000-0000-4000-8000-0000000000c1';

function makeStateWithRO(status: 'created' | 'in_progress' | 'received' | 'cancelled') {
  return makeState({
    org_feature_flags: [
      {
        org_id: ORG_A,
        flag_key: 'plugins.three_pl',
        is_enabled: true,
        config: {},
      },
    ],
    receiving_orders: [
      {
        id: RO_ID,
        org_id: ORG_A,
        receiving_number: 'SMOKE-RO-002',
        purchase_order_id: null,
        warehouse_id: WAREHOUSE_ID,
        vendor_id: null,
        project_id: null,
        // WMS Body B receiving-to-dock (migration 0108): ReceivingOrderSchema now
        // carries the nullable dock header. Mock rows must include the key so the
        // handler's ReceivingOrderSchema.parse(returned_row) survives.
        dock_location_id: null,
        status,
        expected_date: null,
        received_date: null,
        reference: null,
        notes: null,
        payload: {},
        created_at: '2026-05-21T00:00:00.000Z',
        updated_at: '2026-05-21T00:00:00.000Z',
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

describe('ops-api — /receiving-orders/:id/transition stamps received_date on received (B9)', () => {
  let handler: (req: Request) => Promise<Response> | Response;

  beforeAll(async () => {
    installDenoShim();
    resetCapturedHandler();
    await import('../../../../supabase/functions/ops-api/index.ts');
    handler = capturedHandler();
  });

  afterEach(() => clearActiveMockState());

  it('stamps received_date (YYYY-MM-DD) when transitioning to received', async () => {
    const state = makeStateWithRO('in_progress');
    setActiveMockState(state);

    const req = new Request(`https://example.test/receiving-orders/${RO_ID}/transition`, {
      method: 'POST',
      headers: idemHeaders(),
      body: JSON.stringify({ to: 'received' }),
    });
    const res = await handler(req);

    expect(res.status).toBe(200);

    // The mock records every UPDATE patch on the receiving_orders table.
    // Exactly one update should have been emitted for this transition.
    const updates = state.updates.filter((u) => u.table === 'receiving_orders');
    expect(updates.length).toBeGreaterThanOrEqual(1);

    const transitionUpdate = updates.find(
      (u) => u.patch.status === 'received',
    );
    expect(transitionUpdate).toBeDefined();
    expect(transitionUpdate!.patch.received_date).toBeDefined();
    expect(transitionUpdate!.patch.received_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('does NOT stamp received_date when transitioning to a non-received state', async () => {
    const state = makeStateWithRO('in_progress');
    setActiveMockState(state);

    const req = new Request(`https://example.test/receiving-orders/${RO_ID}/transition`, {
      method: 'POST',
      headers: idemHeaders(),
      body: JSON.stringify({ to: 'cancelled' }),
    });
    const res = await handler(req);

    expect(res.status).toBe(200);

    const transitionUpdate = state.updates
      .filter((u) => u.table === 'receiving_orders')
      .find((u) => u.patch.status === 'cancelled');
    expect(transitionUpdate).toBeDefined();
    // received_date must not appear in the patch for non-received transitions.
    expect(transitionUpdate!.patch).not.toHaveProperty('received_date');
  });
});
