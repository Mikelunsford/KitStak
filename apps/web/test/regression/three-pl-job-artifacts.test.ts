// Regression suite for the Job Builder run-scoped build artifacts (ADR 0006
// P2b): job_run_labels / job_run_sow_steps / job_run_timeline / job_run_jacket,
// plus the jacket transitions and the jacket start-gate on start_job_run.
//
// Invariants protected:
//   * Bundle gate: plugins.three_pl off -> 404 for the artifact routes.
//   * RLS Pattern A: writes carry org_id; a cross-tenant run id 404s via the
//     parent assert.
//   * Jacket FSM: draft -> approved / rejected / reopen, illegal moves 409,
//     reject requires a reason (422).
//   * Start-gate (operator decision): a run whose jacket exists and is not
//     approved cannot start (409); a run with no jacket starts as before.

import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
  installDenoShim,
  capturedHandler,
  resetCapturedHandler,
} from './_helpers/deno-shim.ts';
import { makeState, bearer } from './_helpers/supabase-mock.ts';
import type { MockState } from './_helpers/supabase-mock.ts';
import {
  setActiveMockState,
  clearActiveMockState,
} from './_helpers/supabase-stub.ts';
import { invalidateFlagCache } from '../../../../supabase/functions/_shared/feature-flags.ts';

const ORG_A = '00000000-0000-4000-8000-0000000000a1';
const USER_A = '00000000-0000-4000-8000-0000000000b1';
const OWNER = { userId: USER_A, orgId: ORG_A, role: 'org_owner' as const };

const RUN_ID = '00000000-0000-4000-8000-0000000000e1';
const JACKET_ID = '00000000-0000-4000-8000-0000000000f1';

// A full job_runs row satisfying JobRunSchema (loadJobRun parses it on start).
const RUN_ROW = {
  id: RUN_ID, org_id: ORG_A, run_number: null, project_id: null, account_id: null,
  job_template_id: null, job_template_snapshot: null, warehouse_id: null,
  status: 'planned', started_at: null, completed_at: null, closed_at: null,
  cancelled_at: null, notes: null, payload: {}, deleted_at: null,
  created_at: '2026-06-29T00:00:00Z', updated_at: '2026-06-29T00:00:00Z',
};

function flagOn(extra: Record<string, Array<Record<string, unknown>>> = {}): MockState {
  return makeState({
    org_feature_flags: [{ org_id: ORG_A, flag_key: 'plugins.three_pl', is_enabled: true, config: {} }],
    job_runs: [{ ...RUN_ROW }],
    ...extra,
  });
}

async function readJson(res: Response): Promise<{ data?: unknown; error?: unknown }> {
  return JSON.parse(await res.text());
}

function idemHeaders(): Record<string, string> {
  return {
    authorization: bearer(OWNER),
    'content-type': 'application/json',
    'idempotency-key': crypto.randomUUID(),
  };
}

function inserted(state: MockState, table: string): Array<Record<string, unknown>> {
  return state.inserts.filter((r) => r.table === table).map((r) => r.row);
}

function post(handler: (r: Request) => Promise<Response> | Response, path: string, body: unknown) {
  return handler(new Request(`https://example.test${path}`, {
    method: 'POST', headers: idemHeaders(), body: JSON.stringify(body),
  }));
}

function get(handler: (r: Request) => Promise<Response> | Response, path: string) {
  return handler(new Request(`https://example.test${path}`, {
    method: 'GET', headers: { authorization: bearer(OWNER) },
  }));
}

describe('three-pl-api job build artifacts (P2b)', () => {
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

  it('bundle gate off -> 404 on an artifact route', async () => {
    setActiveMockState(makeState({
      org_feature_flags: [{ org_id: ORG_A, flag_key: 'plugins.three_pl', is_enabled: false, config: {} }],
      job_runs: [{ ...RUN_ROW }],
    }));
    const res = await get(handler, `/job-runs/${RUN_ID}/labels`);
    expect(res.status).toBe(404);
  });

  it('creates a label scoped to the org and run', async () => {
    const state = flagOn({ job_run_labels: [] });
    setActiveMockState(state);
    const res = await post(handler, `/job-runs/${RUN_ID}/labels`, {
      label_kind: 'UPC', size: '4x6', data: { code: '810001192034' }, qty: 1131,
    });
    expect(res.status).toBe(201);
    const row = inserted(state, 'job_run_labels')[0];
    expect(row).toMatchObject({
      org_id: ORG_A, job_run_id: RUN_ID, label_kind: 'UPC', qty: 1131, created_by: USER_A,
    });
    expect(row.data).toEqual({ code: '810001192034' });
  });

  it('lists labels for a run (RLS-only read)', async () => {
    const state = flagOn({
      job_run_labels: [{ id: 'l1', org_id: ORG_A, job_run_id: RUN_ID, label_kind: 'UPC', size: '4x6', data: {}, qty: 10, position: 0 }],
    });
    setActiveMockState(state);
    const res = await get(handler, `/job-runs/${RUN_ID}/labels`);
    expect(res.status).toBe(200);
    expect((await readJson(res)).data).toHaveLength(1);
  });

  it('ensures a draft jacket (creates one when absent, returns the existing one otherwise)', async () => {
    const state = flagOn({ job_run_jacket: [] });
    setActiveMockState(state);
    const res = await post(handler, `/job-runs/${RUN_ID}/jacket`, {});
    expect(res.status).toBe(201);
    expect(inserted(state, 'job_run_jacket')[0]).toMatchObject({
      org_id: ORG_A, job_run_id: RUN_ID, status: 'draft',
    });

    // idempotent: an existing jacket is returned, not duplicated
    const state2 = flagOn({ job_run_jacket: [{ id: JACKET_ID, org_id: ORG_A, job_run_id: RUN_ID, status: 'draft' }] });
    setActiveMockState(state2);
    const res2 = await post(handler, `/job-runs/${RUN_ID}/jacket`, {});
    expect(res2.status).toBe(200);
    expect(inserted(state2, 'job_run_jacket')).toHaveLength(0);
  });

  it('approves a draft jacket', async () => {
    const state = flagOn({ job_run_jacket: [{ id: JACKET_ID, org_id: ORG_A, job_run_id: RUN_ID, status: 'draft' }] });
    setActiveMockState(state);
    const res = await post(handler, `/job-runs/${RUN_ID}/jacket/transition`, { decision: 'approve' });
    expect(res.status).toBe(200);
    expect((await readJson(res)).data).toMatchObject({ status: 'approved' });
    const upd = state.updates.find((u) => u.table === 'job_run_jacket');
    expect(upd?.patch).toMatchObject({ status: 'approved', approved_by: USER_A });
  });

  it('requires a reason to reject a jacket (422)', async () => {
    const state = flagOn({ job_run_jacket: [{ id: JACKET_ID, org_id: ORG_A, job_run_id: RUN_ID, status: 'draft' }] });
    setActiveMockState(state);
    const res = await post(handler, `/job-runs/${RUN_ID}/jacket/transition`, { decision: 'reject' });
    expect(res.status).toBe(422);
  });

  it('rejects an illegal jacket transition (approve an approved jacket -> 409)', async () => {
    const state = flagOn({ job_run_jacket: [{ id: JACKET_ID, org_id: ORG_A, job_run_id: RUN_ID, status: 'approved' }] });
    setActiveMockState(state);
    const res = await post(handler, `/job-runs/${RUN_ID}/jacket/transition`, { decision: 'approve' });
    expect(res.status).toBe(409);
  });

  // -------------------------------------------------------------------------
  // start-gate (operator decision: an unapproved jacket blocks start)
  // -------------------------------------------------------------------------

  it('blocks start when the jacket is not approved (409)', async () => {
    const state = flagOn({ job_run_jacket: [{ id: JACKET_ID, org_id: ORG_A, job_run_id: RUN_ID, status: 'draft' }] });
    setActiveMockState(state);
    const res = await post(handler, `/job-runs/${RUN_ID}/start`, {});
    expect(res.status).toBe(409);
    // the start RPC must NOT have been called
    expect(state.rpcCalls.some((c) => c.name === 'start_job_run')).toBe(false);
  });

  it('allows start when the jacket is approved', async () => {
    const state = flagOn({ job_run_jacket: [{ id: JACKET_ID, org_id: ORG_A, job_run_id: RUN_ID, status: 'approved' }] });
    state.rpcResults['start_job_run'] = { data: null, error: null };
    setActiveMockState(state);
    const res = await post(handler, `/job-runs/${RUN_ID}/start`, {});
    expect(res.status).toBe(200);
    expect(state.rpcCalls.some((c) => c.name === 'start_job_run')).toBe(true);
  });

  it('allows start when the run has no jacket (legacy / non-builder run)', async () => {
    const state = flagOn({ job_run_jacket: [] });
    state.rpcResults['start_job_run'] = { data: null, error: null };
    setActiveMockState(state);
    const res = await post(handler, `/job-runs/${RUN_ID}/start`, {});
    expect(res.status).toBe(200);
    expect(state.rpcCalls.some((c) => c.name === 'start_job_run')).toBe(true);
  });

  it('upserts the timeline for a run', async () => {
    const state = flagOn({ job_run_timeline: [] });
    setActiveMockState(state);
    const res = await handler(new Request(`https://example.test/job-runs/${RUN_ID}/timeline`, {
      method: 'PUT', headers: idemHeaders(), body: JSON.stringify({ ship_date: '2026-08-28', mabd: '2026-09-01' }),
    }));
    expect(res.status).toBe(200);
    const row = inserted(state, 'job_run_timeline')[0];
    expect(row).toMatchObject({ org_id: ORG_A, job_run_id: RUN_ID, ship_date: '2026-08-28', mabd: '2026-09-01' });
  });
});
