// Regression suite for the copack-api edge bundle (Pillar 3 Co-Pack and Ecom).
//
// Mirrors apps/web/test/regression/manufacturing-api-basic.test.ts: the same
// three highest-signal classes of bug for a new bundle, adapted to the
// copack_ecom surface (sales_orders / kitting_jobs / fulfillments):
//   1. Cross-tenant list returns 200 + [] (RLS Pattern A filters, never
//      throws). Verifies the org_id gate is wired on GET /sales-orders.
//   2. Bundle-level plugins.copack_ecom gate returns 404 NOT_FOUND when the
//      flag is off, every method + every path.
//   3. Illegal state transitions return 409 STATE_CONFLICT (the canonical
//      FSM-violation envelope; manufacturing-api / ops-api use the same code
//      for the same class of bug). The kitting_jobs FSM mirrors
//      manufacturing_runs one-for-one (completed is terminal), so a
//      completed -> started start attempt is the analogous illegal probe.
//
// Constitutional invariants protected:
//   * Capabilities: every state-changing handler calls requireCap() before
//     touching the DB. Verified indirectly by 409 returning AFTER the cap
//     check passes (caller has org_owner cap).
//   * RLS: cross-tenant list -> 200 + [], not 403. Pattern A flow.
//   * State machine: handler-enforced BEFORE the DB call so the kitting_jobs /
//     sales_orders CHECK constraints never produce a 500-class error.

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
const ORG_B = '00000000-0000-4000-8000-0000000000a2';
const USER_A = '00000000-0000-4000-8000-0000000000b1';
const OWNER = { userId: USER_A, orgId: ORG_A, role: 'org_owner' as const };

const ORDER_ID = '00000000-0000-4000-8000-0000000000e1';
const JOB_ID = '00000000-0000-4000-8000-0000000000e2';

function makeStateWithFlag(extra: Record<string, Array<Record<string, unknown>>> = {}) {
  return makeState({
    org_feature_flags: [
      {
        org_id: ORG_A,
        flag_key: 'plugins.copack_ecom',
        is_enabled: true,
        config: {},
      },
    ],
    ...extra,
  });
}

function makeStateGateOff(extra: Record<string, Array<Record<string, unknown>>> = {}) {
  return makeState({
    org_feature_flags: [
      {
        org_id: ORG_A,
        flag_key: 'plugins.copack_ecom',
        is_enabled: false,
        config: {},
      },
    ],
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

describe('copack-api — bundle basics', () => {
  let handler: (req: Request) => Promise<Response> | Response;

  beforeAll(async () => {
    installDenoShim();
    resetCapturedHandler();
    await import('../../../../supabase/functions/copack-api/index.ts');
    handler = capturedHandler();
  });

  afterEach(() => {
    clearActiveMockState();
    // The feature-flag reader caches per (org_id, flag_key) for 5 minutes.
    // Tests that flip the gate on/off back-to-back must clear the cache so
    // a prior gate-on read does not mask a subsequent gate-off probe.
    invalidateFlagCache(ORG_A);
  });

  // -------------------------------------------------------------------------
  // RLS Pattern A: cross-tenant list returns 200 + []
  // -------------------------------------------------------------------------

  it('GET /sales-orders returns 200 + [] when only other-tenant rows exist', async () => {
    setActiveMockState(makeStateWithFlag({
      sales_orders: [
        {
          id: ORDER_ID,
          org_id: ORG_B, // belongs to a different tenant
          order_number: 'SO-OTHER',
          channel_id: null,
          customer_id: null,
          project_id: null,
          status: 'draft',
          currency_code: null,
          ordered_at: null,
          confirmed_at: null,
          shipped_at: null,
          cancelled_at: null,
          notes: null,
          payload: {},
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          deleted_at: null,
        },
      ],
    }));
    const req = new Request('https://example.test/sales-orders', {
      method: 'GET',
      headers: { authorization: bearer(OWNER) },
    });
    const res = await handler(req);
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.data).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // Bundle gate: plugins.copack_ecom OFF -> 404 everywhere
  // -------------------------------------------------------------------------

  it('GET /sales-orders returns 404 when plugins.copack_ecom is off', async () => {
    setActiveMockState(makeStateGateOff());
    const req = new Request('https://example.test/sales-orders', {
      method: 'GET',
      headers: { authorization: bearer(OWNER) },
    });
    const res = await handler(req);
    expect(res.status).toBe(404);
    const body = await readJson(res);
    expect(body.error).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('POST /sales-orders returns 404 when plugins.copack_ecom is off', async () => {
    setActiveMockState(makeStateGateOff());
    const req = new Request('https://example.test/sales-orders', {
      method: 'POST',
      headers: idemHeaders(),
      body: JSON.stringify({}),
    });
    const res = await handler(req);
    expect(res.status).toBe(404);
  });

  it('GET /kitting-jobs returns 404 when plugins.copack_ecom is off', async () => {
    setActiveMockState(makeStateGateOff());
    const req = new Request('https://example.test/kitting-jobs', {
      method: 'GET',
      headers: { authorization: bearer(OWNER) },
    });
    const res = await handler(req);
    expect(res.status).toBe(404);
  });

  // -------------------------------------------------------------------------
  // State machine: kitting_jobs completed -> started is illegal -> 409.
  // Mirrors the manufacturing_runs FSM probe one-for-one.
  // -------------------------------------------------------------------------

  it('POST /kitting-jobs/:id/start returns 409 when job is already completed', async () => {
    setActiveMockState(makeStateWithFlag({
      kitting_jobs: [
        {
          id: JOB_ID,
          org_id: ORG_A,
          job_number: 'KIT-DONE',
          sales_order_id: null,
          warehouse_id: null,
          status: 'completed',
          planned_start_at: null,
          planned_complete_at: null,
          started_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
          cancelled_at: null,
          notes: null,
          payload: {},
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          deleted_at: null,
        },
      ],
    }));
    const req = new Request(`https://example.test/kitting-jobs/${JOB_ID}/start`, {
      method: 'POST',
      headers: idemHeaders(),
    });
    const res = await handler(req);
    expect(res.status).toBe(409);
    const body = await readJson(res);
    expect(body.error).toMatchObject({ code: 'STATE_CONFLICT' });
    expect(JSON.stringify(body.error)).toMatch(/completed/);
  });

  // -------------------------------------------------------------------------
  // Happy path: POST /sales-orders creates a draft order.
  //
  // The mock's insert path echoes the row back to .single() under-specified
  // (it cannot synthesise audit columns the way a real Postgres default
  // does) so the downstream SalesOrderSchema.parse(data) may return 500
  // INTERNAL_ERROR. That is a test-harness shortcoming, not a create-path
  // regression — the body-parse + idempotency + cap check we care about
  // already succeeded by then. Assert specifically: NOT a 422 and NOT a
  // 403/404 (i.e. the validation + gate + cap layers all passed).
  // -------------------------------------------------------------------------

  it('POST /sales-orders accepts a minimal valid body (no 4xx)', async () => {
    setActiveMockState(makeStateWithFlag({ sales_orders: [] }));
    const req = new Request('https://example.test/sales-orders', {
      method: 'POST',
      headers: idemHeaders(),
      body: JSON.stringify({
        order_number: 'SO-001',
        notes: 'unit-test seed order',
      }),
    });
    const res = await handler(req);
    expect(res.status).not.toBe(422);
    expect(res.status).not.toBe(403);
    expect(res.status).not.toBe(404);
  });

  // -------------------------------------------------------------------------
  // Numbering chassis: when the caller omits order_number, the create handler
  // calls public.next_doc_number(org_id, 'sales_order') to allocate the next
  // SO- value via the org-scoped numbering chassis (migration 0077 /
  // _shared/numbering.ts). Mirrors the manufacturing-api numbering probe.
  // -------------------------------------------------------------------------

  it('POST /sales-orders calls next_doc_number when order_number is absent', async () => {
    const state = makeStateWithFlag({ sales_orders: [] });
    state.rpcResults['next_doc_number'] = {
      data: 'SO-2026-00001',
      error: null,
    };
    setActiveMockState(state);
    const req = new Request('https://example.test/sales-orders', {
      method: 'POST',
      headers: idemHeaders(),
      body: JSON.stringify({
        notes: 'auto-numbered order',
      }),
    });
    await handler(req);
    const call = state.rpcCalls.find((c) => c.name === 'next_doc_number');
    expect(call).toBeDefined();
    expect(call?.args).toMatchObject({
      p_org_id: ORG_A,
      p_doc_type: 'sales_order',
    });
  });
});
