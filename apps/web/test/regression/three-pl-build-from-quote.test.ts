// Regression suite for build-from-quote (ADR 0006 P2b-2): an approved quote
// becomes a buildable job by reusing the 3PL chain plus the run-scoped build
// artifacts (migration 0145). Exercised through the real three-pl-api handler
// under the Supabase mock (gated-bundle pattern).
//
// Invariants protected:
//   * Bundle gate: plugins.three_pl off -> 404 on /build-from-quote.
//   * Convert relay: the convert_quote_to_project RPC owns the approved-state
//     guard and the cross-tenant boundary; STATE_CONFLICT -> 409, NOT_FOUND ->
//     404 are relayed (the "quote must be approved" decision lives in the RPC).
//   * Chain: a successful build mints a draft supply_plan, a job_run inheriting
//     the project's frozen template snapshot, and (operator default) a draft
//     receiving_order exploded from the job BOM.
//   * BOM explosion: required qty = quantity_per * line quantity, aggregated by
//     component across parent lines; free-text lines (no item_id) contribute
//     nothing.
//   * Receiving order guards: skipped (null) when create_receiving_order is
//     false, when the org has no default warehouse (warehouse_id NOT NULL), or
//     when the BOM resolves to no components.
//   * Gating: a draft job_run_jacket + a job_run_timeline (mabd = project due
//     date) are seeded so the run lands gated.
//   * Idempotency: a re-run reuses the existing plan / run / receiving order /
//     jacket / timeline and mints no duplicates.
//
// The Supabase mock does not generate ids on insert (documented harness limit),
// so create-path assertions check state.inserts (shape / key presence) while the
// idempotent path seeds known ids to assert the returned ids.

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
const PROJECT_ID = '00000000-0000-4000-8000-0000000000e1';
const WAREHOUSE_ID = '00000000-0000-4000-8000-0000000000f1';
const SRC_TPL = '00000000-0000-4000-8000-000000000a01';
const FIN_1 = '00000000-0000-4000-8000-000000001001';
const FIN_2 = '00000000-0000-4000-8000-000000001002';
const COMP_A = '00000000-0000-4000-8000-000000002001';
const COMP_B = '00000000-0000-4000-8000-000000002002';

// Existing-chain ids for the idempotent re-run.
const EXIST_PLAN = '00000000-0000-4000-8000-000000009001';
const EXIST_RUN = '00000000-0000-4000-8000-000000009002';
const EXIST_RO = '00000000-0000-4000-8000-000000009003';

const SNAPSHOT = { template_id: SRC_TPL, name: 'Kitting build', lines: [] };

interface BuildStateOpts {
  flagOn?: boolean;
  withDefaultWarehouse?: boolean;
  lineItems?: Array<Record<string, unknown>>;
  bomItems?: Array<Record<string, unknown>>;
  existingSupplyPlans?: Array<Record<string, unknown>>;
  existingJobRuns?: Array<Record<string, unknown>>;
  existingReceivingOrders?: Array<Record<string, unknown>>;
  existingJackets?: Array<Record<string, unknown>>;
  existingTimelines?: Array<Record<string, unknown>>;
  convertResult?: { data: unknown; error: { message: string } | null };
}

function makeBuildState(opts: BuildStateOpts = {}): MockState {
  const lineItems = opts.lineItems ?? [
    { org_id: ORG_A, project_id: PROJECT_ID, item_id: FIN_1, quantity: 2, position: 0 },
    { org_id: ORG_A, project_id: PROJECT_ID, item_id: FIN_2, quantity: 3, position: 1 },
    { org_id: ORG_A, project_id: PROJECT_ID, item_id: null, quantity: 9, position: 2 },
  ];
  // FIN_1 -> 4x COMP_A + 1x COMP_B ; FIN_2 -> 2x COMP_A. COMP_A is shared.
  // Expected: COMP_A = 4*2 + 2*3 = 14 ; COMP_B = 1*2 = 2.
  const bomItems = opts.bomItems ?? [
    { org_id: ORG_A, parent_item_id: FIN_1, component_item_id: COMP_A, quantity_per: 4, unit_of_measure: 'ea' },
    { org_id: ORG_A, parent_item_id: FIN_1, component_item_id: COMP_B, quantity_per: 1, unit_of_measure: 'ea' },
    { org_id: ORG_A, parent_item_id: FIN_2, component_item_id: COMP_A, quantity_per: 2, unit_of_measure: 'ea' },
  ];
  const warehouses = opts.withDefaultWarehouse === false
    ? []
    : [{ id: WAREHOUSE_ID, org_id: ORG_A, is_default: true }];
  const state = makeState({
    org_feature_flags: [
      { org_id: ORG_A, flag_key: 'plugins.three_pl', is_enabled: opts.flagOn !== false, config: {} },
    ],
    projects: [{
      id: PROJECT_ID, org_id: ORG_A, deleted_at: null,
      job_template_snapshot: SNAPSHOT, source_job_template_id: SRC_TPL,
      due_date: '2026-09-01',
    }],
    project_line_items: lineItems,
    bom_items: bomItems,
    warehouses,
    supply_plans: opts.existingSupplyPlans ?? [],
    supply_plan_lines: [],
    job_runs: opts.existingJobRuns ?? [],
    receiving_orders: opts.existingReceivingOrders ?? [],
    receiving_order_line_items: [],
    job_run_jacket: opts.existingJackets ?? [],
    job_run_timeline: opts.existingTimelines ?? [],
  });
  state.rpcResults['convert_quote_to_project'] =
    opts.convertResult ?? { data: PROJECT_ID, error: null };
  state.rpcResults['next_doc_number'] = { data: 'DOC-0001', error: null };
  return state;
}

function idemHeaders(): Record<string, string> {
  return {
    authorization: bearer(OWNER),
    'content-type': 'application/json',
    'idempotency-key': crypto.randomUUID(),
  };
}

function build(handler: (r: Request) => Promise<Response> | Response, body: unknown = {}) {
  return handler(new Request(`https://example.test/build-from-quote/${QUOTE_ID}`, {
    method: 'POST', headers: idemHeaders(), body: JSON.stringify(body),
  }));
}

function inserted(state: MockState, table: string): Array<Record<string, unknown>> {
  return state.inserts.filter((r) => r.table === table).map((r) => r.row);
}

async function readJson(res: Response): Promise<{ data?: Record<string, unknown>; error?: { code?: string } }> {
  return JSON.parse(await res.text());
}

describe('three-pl-api build-from-quote (P2b-2)', () => {
  let handler: (req: Request) => Promise<Response> | Response;

  beforeAll(async () => {
    installDenoShim();
    resetCapturedHandler();
    await import('../../../../supabase/functions/three-pl-api/index.ts');
    handler = capturedHandler();
  });

  afterEach(() => {
    clearActiveMockState();
    invalidateFlagCache(ORG_A);
  });

  it('bundle gate off -> 404', async () => {
    setActiveMockState(makeBuildState({ flagOn: false }));
    const res = await build(handler);
    expect(res.status).toBe(404);
  });

  it('builds the full chain from an approved quote', async () => {
    const state = makeBuildState();
    setActiveMockState(state);
    const res = await build(handler);
    expect(res.status).toBe(200);
    expect((await readJson(res)).data?.project_id).toBe(PROJECT_ID);

    // convert RPC called with the org-gated args.
    const convert = state.rpcCalls.find((c) => c.name === 'convert_quote_to_project');
    expect(convert?.args).toMatchObject({ p_quote_id: QUOTE_ID, p_caller_org_id: ORG_A, p_actor: USER_A });

    // supply plan + lines.
    const plans = inserted(state, 'supply_plans');
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({ org_id: ORG_A, project_id: PROJECT_ID, warehouse_id: WAREHOUSE_ID, status: 'draft' });
    expect(inserted(state, 'supply_plan_lines')).toHaveLength(2);

    // job run inherits the project's frozen template snapshot.
    const runs = inserted(state, 'job_runs');
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      org_id: ORG_A, project_id: PROJECT_ID, status: 'planned',
      job_template_id: SRC_TPL, run_number: 'DOC-0001',
    });
    expect(runs[0].job_template_snapshot).toEqual(SNAPSHOT);

    // gate artifacts.
    expect(inserted(state, 'job_run_jacket')[0]).toMatchObject({ org_id: ORG_A, status: 'draft' });
    expect(inserted(state, 'job_run_timeline')[0]).toMatchObject({ org_id: ORG_A, mabd: '2026-09-01' });
  });

  it('explodes the BOM into aggregated receiving-order lines', async () => {
    const state = makeBuildState();
    setActiveMockState(state);
    await build(handler);

    const ros = inserted(state, 'receiving_orders');
    expect(ros).toHaveLength(1);
    expect(ros[0]).toMatchObject({
      org_id: ORG_A, project_id: PROJECT_ID, warehouse_id: WAREHOUSE_ID,
      status: 'created', receiving_number: 'DOC-0001',
    });

    const lines = inserted(state, 'receiving_order_line_items');
    expect(lines).toHaveLength(2);
    // Sorted by component id: COMP_A (14) then COMP_B (2).
    expect(lines[0]).toMatchObject({ item_id: COMP_A, quantity: 14, uom: 'ea', position: 0 });
    expect(lines[1]).toMatchObject({ item_id: COMP_B, quantity: 2, uom: 'ea', position: 1 });
  });

  it('relays a non-approved quote as STATE_CONFLICT 409', async () => {
    setActiveMockState(makeBuildState({
      convertResult: { data: null, error: { message: 'STATE_CONFLICT: quote not in approved state (was draft)' } },
    }));
    const res = await build(handler);
    expect(res.status).toBe(409);
  });

  it('relays a missing / cross-tenant quote as NOT_FOUND 404', async () => {
    setActiveMockState(makeBuildState({
      convertResult: { data: null, error: { message: 'NOT_FOUND: quote' } },
    }));
    const res = await build(handler);
    expect(res.status).toBe(404);
  });

  it('skips the receiving order when the org has no default warehouse', async () => {
    const state = makeBuildState({ withDefaultWarehouse: false });
    setActiveMockState(state);
    const res = await build(handler);
    expect(res.status).toBe(200);
    expect((await readJson(res)).data?.receiving_order_id).toBeNull();
    expect(inserted(state, 'receiving_orders')).toHaveLength(0);
    // The supply plan still lands (null warehouse) and the run is still gated.
    expect(inserted(state, 'supply_plans')[0]).toMatchObject({ warehouse_id: null });
    expect(inserted(state, 'job_runs')).toHaveLength(1);
    expect(inserted(state, 'job_run_jacket')[0]).toMatchObject({ status: 'draft' });
  });

  it('skips the receiving order when create_receiving_order is false', async () => {
    const state = makeBuildState();
    setActiveMockState(state);
    const res = await build(handler, { create_receiving_order: false });
    expect(res.status).toBe(200);
    expect((await readJson(res)).data?.receiving_order_id).toBeNull();
    expect(inserted(state, 'receiving_orders')).toHaveLength(0);
  });

  it('skips the receiving order when the BOM resolves to nothing', async () => {
    const state = makeBuildState({ bomItems: [] });
    setActiveMockState(state);
    const res = await build(handler);
    expect(res.status).toBe(200);
    expect((await readJson(res)).data?.receiving_order_id).toBeNull();
    expect(inserted(state, 'receiving_orders')).toHaveLength(0);
  });

  it('is idempotent: reuses the existing chain and mints no duplicates', async () => {
    const state = makeBuildState({
      existingSupplyPlans: [{ id: EXIST_PLAN, org_id: ORG_A, project_id: PROJECT_ID, status: 'draft', deleted_at: null }],
      existingJobRuns: [{ id: EXIST_RUN, org_id: ORG_A, project_id: PROJECT_ID, deleted_at: null, created_at: '2026-06-29T00:00:00Z' }],
      existingReceivingOrders: [{ id: EXIST_RO, org_id: ORG_A, project_id: PROJECT_ID, deleted_at: null }],
      existingJackets: [{ id: 'jk', org_id: ORG_A, job_run_id: EXIST_RUN, status: 'draft' }],
      existingTimelines: [{ id: 'tl', org_id: ORG_A, job_run_id: EXIST_RUN, mabd: '2026-09-01' }],
    });
    setActiveMockState(state);
    const res = await build(handler);
    expect(res.status).toBe(200);
    expect((await readJson(res)).data).toMatchObject({
      project_id: PROJECT_ID,
      supply_plan_id: EXIST_PLAN,
      job_run_id: EXIST_RUN,
      receiving_order_id: EXIST_RO,
    });
    for (const t of ['supply_plans', 'job_runs', 'receiving_orders', 'job_run_jacket', 'job_run_timeline']) {
      expect(inserted(state, t)).toHaveLength(0);
    }
  });
});
