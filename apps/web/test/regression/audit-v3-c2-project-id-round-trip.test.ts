// Regression suite for F-Wave9-AUDIT-V3-WAVE-C2-01 — project_id round-trip
// on manufacturing_runs and shipments.
//
// Background (audit v3 Wave C / closeout journal
// 03-workspace/journal/2026-05-23-audit-v3-wave-A-B-C.md): migration 0063
// added manufacturing_runs.project_id (live structural change) and
// re-declared shipments.project_id (idempotent no-op carrying parity from
// 0046's G-SHIP-FK-01). The C2 PR wires the Zod schemas + Edge Function
// handlers so the column round-trips through the API.
//
// Parallel test: receiving-project-link.test.ts (UX-Q6) which protects
// the same shape for receiving_orders. This file mirrors its approach.
//
// This test asserts:
//   1. POST /manufacturing-runs with project_id persists the value on
//      the inserted row.
//   2. POST /manufacturing-runs without project_id inserts NULL (column
//      default), matching the legacy / unlinked case.
//   3. PATCH /manufacturing-runs/:id can link and unlink a project.
//   4. GET /manufacturing-runs/:id parses cleanly when the legacy row
//      carries no project_id field (forward-compat: optional + nullable).
//   5. POST /shipments with project_id persists the value (parity with
//      the manufacturing half; B4 already derives customer_id client-side).
//   6. POST /shipments without project_id inserts no project_id key
//      (DB default NULL applies).
//   7. PATCH /shipments/:id can link and unlink a project.
//
// Constitutional invariants protected:
//   * Byte-mirror parity: the two vendors_inventory_ops.ts halves stay
//     byte-identical; verified by pnpm test:contract. This test guards
//     the BEHAVIOUR; parity test guards the FILES.
//   * RLS Pattern A inherited: project_id is read / written under the
//     existing org_id gate; no new policies.
//   * Capabilities: no new caps. manufacturing.run.create / .update and
//     shipments.shipment.create / .update already cover the new field.
//   * Money rules untouched: no monetary columns added.

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

const RUN_ID = '00000000-0000-4000-8000-0000000000e1';
const SHIP_ID = '00000000-0000-4000-8000-0000000000e2';
const WAREHOUSE_ID = '00000000-0000-4000-8000-0000000000c1';
const PROJECT_ID = '00000000-0000-4000-8000-0000000000d1';

function authHeaders(): Record<string, string> {
  return {
    authorization: bearer(OWNER),
    'content-type': 'application/json',
    'idempotency-key': crypto.randomUUID(),
  };
}

// ---------------------------------------------------------------------------
// Manufacturing half
// ---------------------------------------------------------------------------

function makeMfgState(extra: Record<string, Array<Record<string, unknown>>> = {}) {
  return makeState({
    org_feature_flags: [
      {
        org_id: ORG_A,
        flag_key: 'plugins.manufacturing',
        is_enabled: true,
        config: {},
      },
    ],
    // FK validation parents for manufacturing-runs create (warehouse_id,
    // project_id) which assertRefInOrg now org-checks before insert.
    warehouses: [{ id: WAREHOUSE_ID, org_id: ORG_A }],
    projects: [{ id: PROJECT_ID, org_id: ORG_A }],
    doc_number_sequences: [],
    ...extra,
  });
}

function makeMfgStateWithRun(projectId: string | null) {
  return makeMfgState({
    manufacturing_runs: [{
      id: RUN_ID,
      org_id: ORG_A,
      run_number: 'TEST-MFG-001',
      status: 'draft',
      warehouse_id: WAREHOUSE_ID,
      project_id: projectId,
      planned_start_at: null,
      planned_complete_at: null,
      started_at: null,
      completed_at: null,
      cancelled_at: null,
      notes: null,
      payload: {},
      created_at: '2026-05-23T00:00:00.000Z',
      updated_at: '2026-05-23T00:00:00.000Z',
      deleted_at: null,
    }],
  });
}

describe('manufacturing-api — manufacturing_runs.project_id round-trip (C2)', () => {
  let handler: (req: Request) => Promise<Response> | Response;

  beforeAll(async () => {
    installDenoShim();
    resetCapturedHandler();
    await import('../../../../supabase/functions/manufacturing-api/index.ts');
    handler = capturedHandler();
  });

  afterEach(() => {
    clearActiveMockState();
    invalidateFlagCache();
  });

  it('POST /manufacturing-runs persists project_id on the inserted row', async () => {
    const state = makeMfgState();
    setActiveMockState(state);

    const req = new Request('https://example.test/manufacturing-runs', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        run_number: 'TEST-MFG-001',
        warehouse_id: WAREHOUSE_ID,
        project_id: PROJECT_ID,
      }),
    });
    await handler(req);

    const inserts = state.inserts.filter((u) => u.table === 'manufacturing_runs');
    expect(inserts.length).toBe(1);
    expect(inserts[0]!.row.project_id).toBe(PROJECT_ID);
  });

  it('POST /manufacturing-runs without project_id inserts NULL (legacy / unlinked)', async () => {
    const state = makeMfgState();
    setActiveMockState(state);

    const req = new Request('https://example.test/manufacturing-runs', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        run_number: 'TEST-MFG-002',
        warehouse_id: WAREHOUSE_ID,
      }),
    });
    await handler(req);

    const inserts = state.inserts.filter((u) => u.table === 'manufacturing_runs');
    expect(inserts.length).toBe(1);
    // Handler explicitly writes project_id: body.project_id ?? null so the
    // DB sees an explicit NULL rather than relying on the column default.
    expect(inserts[0]!.row.project_id).toBeNull();
  });

  it('PATCH /manufacturing-runs/:id can link a draft run to a project', async () => {
    const state = makeMfgStateWithRun(null);
    setActiveMockState(state);

    const req = new Request(`https://example.test/manufacturing-runs/${RUN_ID}`, {
      method: 'PATCH',
      headers: authHeaders(),
      body: JSON.stringify({ project_id: PROJECT_ID }),
    });
    const res = await handler(req);
    expect(res.status).toBe(200);

    const update = state.updates
      .filter((u) => u.table === 'manufacturing_runs')
      .find((u) => u.patch.project_id === PROJECT_ID);
    expect(update).toBeDefined();
  });

  it('PATCH /manufacturing-runs/:id can unlink (project_id = null)', async () => {
    const state = makeMfgStateWithRun(PROJECT_ID);
    setActiveMockState(state);

    const req = new Request(`https://example.test/manufacturing-runs/${RUN_ID}`, {
      method: 'PATCH',
      headers: authHeaders(),
      body: JSON.stringify({ project_id: null }),
    });
    const res = await handler(req);
    expect(res.status).toBe(200);

    const update = state.updates
      .filter((u) => u.table === 'manufacturing_runs')
      .find((u) => 'project_id' in u.patch && u.patch.project_id === null);
    expect(update).toBeDefined();
  });

  it('GET /manufacturing-runs/:id parses a legacy row with no project_id field (forward-compat)', async () => {
    // Simulate a row that pre-dates the column (the supabase mock returns
    // the row verbatim; we intentionally omit project_id to mirror the
    // shape a row from a not-yet-migrated branch would carry).
    const state = makeMfgState({
      manufacturing_runs: [{
        id: RUN_ID,
        org_id: ORG_A,
        run_number: 'LEGACY-MFG-001',
        status: 'draft',
        warehouse_id: WAREHOUSE_ID,
        // project_id intentionally omitted
        planned_start_at: null,
        planned_complete_at: null,
        started_at: null,
        completed_at: null,
        cancelled_at: null,
        notes: null,
        payload: {},
        created_at: '2026-05-23T00:00:00.000Z',
        updated_at: '2026-05-23T00:00:00.000Z',
        deleted_at: null,
      }],
    });
    setActiveMockState(state);

    const req = new Request(`https://example.test/manufacturing-runs/${RUN_ID}`, {
      method: 'GET',
      headers: { authorization: bearer(OWNER) },
    });
    const res = await handler(req);
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Shipments half
// ---------------------------------------------------------------------------

function makeShipState(extra: Record<string, Array<Record<string, unknown>>> = {}) {
  return makeState({
    org_feature_flags: [
      {
        org_id: ORG_A,
        flag_key: 'plugins.three_pl',
        is_enabled: true,
        config: {},
      },
    ],
    // FK validation parents for shipments create (warehouse_id, project_id)
    // which assertRefInOrg now org-checks before insert.
    warehouses: [{ id: WAREHOUSE_ID, org_id: ORG_A }],
    projects: [{ id: PROJECT_ID, org_id: ORG_A }],
    doc_number_sequences: [],
    ...extra,
  });
}

function makeShipStateWithShipment(projectId: string | null) {
  return makeShipState({
    shipments: [{
      id: SHIP_ID,
      org_id: ORG_A,
      shipment_number: 'TEST-SHP-001',
      warehouse_id: WAREHOUSE_ID,
      customer_id: null,
      sales_order_id: null,
      project_id: projectId,
      status: 'created',
      ship_date: null,
      carrier: null,
      tracking_number: null,
      notes: null,
      payload: {},
      created_at: '2026-05-23T00:00:00.000Z',
      updated_at: '2026-05-23T00:00:00.000Z',
      deleted_at: null,
    }],
  });
}

describe('ops-api — shipments.project_id round-trip (C2)', () => {
  let handler: (req: Request) => Promise<Response> | Response;

  beforeAll(async () => {
    installDenoShim();
    resetCapturedHandler();
    await import('../../../../supabase/functions/ops-api/index.ts');
    handler = capturedHandler();
  });

  afterEach(() => {
    clearActiveMockState();
    invalidateFlagCache();
  });

  it('POST /shipments persists project_id on the inserted row', async () => {
    const state = makeShipState();
    setActiveMockState(state);

    const req = new Request('https://example.test/shipments', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        // shipment_number supplied so the handler skips the
        // next_doc_number RPC chassis call (matches receiving-project-link
        // and auto-numbering-b8 conventions).
        shipment_number: 'TEST-SHP-001',
        warehouse_id: WAREHOUSE_ID,
        project_id: PROJECT_ID,
      }),
    });
    await handler(req);

    const inserts = state.inserts.filter((u) => u.table === 'shipments');
    expect(inserts.length).toBe(1);
    expect(inserts[0]!.row.project_id).toBe(PROJECT_ID);
  });

  it('POST /shipments without project_id inserts no project_id (DB default NULL applies)', async () => {
    const state = makeShipState();
    setActiveMockState(state);

    const req = new Request('https://example.test/shipments', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        shipment_number: 'TEST-SHP-002',
        warehouse_id: WAREHOUSE_ID,
      }),
    });
    await handler(req);

    const inserts = state.inserts.filter((u) => u.table === 'shipments');
    expect(inserts.length).toBe(1);
    // ops-api spreads `...body` into the insert, so a missing field is
    // simply absent — the DB column default NULL applies.
    expect(inserts[0]!.row.project_id).toBeUndefined();
  });

  it('PATCH /shipments/:id can link a shipment to a project', async () => {
    const state = makeShipStateWithShipment(null);
    setActiveMockState(state);

    const req = new Request(`https://example.test/shipments/${SHIP_ID}`, {
      method: 'PATCH',
      headers: authHeaders(),
      body: JSON.stringify({ project_id: PROJECT_ID }),
    });
    const res = await handler(req);
    expect(res.status).toBe(200);

    const update = state.updates
      .filter((u) => u.table === 'shipments')
      .find((u) => u.patch.project_id === PROJECT_ID);
    expect(update).toBeDefined();
  });

  it('PATCH /shipments/:id can unlink (project_id = null)', async () => {
    const state = makeShipStateWithShipment(PROJECT_ID);
    setActiveMockState(state);

    const req = new Request(`https://example.test/shipments/${SHIP_ID}`, {
      method: 'PATCH',
      headers: authHeaders(),
      body: JSON.stringify({ project_id: null }),
    });
    const res = await handler(req);
    expect(res.status).toBe(200);

    const update = state.updates
      .filter((u) => u.table === 'shipments')
      .find((u) => 'project_id' in u.patch && u.patch.project_id === null);
    expect(update).toBeDefined();
  });
});
