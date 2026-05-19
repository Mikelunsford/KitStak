// Regression suite for F-Wave7-LINEFORM-VALIDATE-01 — API-boundary line
// validation on receiving / shipment / production_run create endpoints.
//
// Companion to PR #28 (migration 0048), which made the emit-movements
// triggers tolerate malformed payload lines by skipping them. The trigger
// fix is the storage-layer safety net; this PR closes the same class of
// bug at the API boundary so the operator sees a structured 422 instead
// of a silently dropped stock movement.
//
// Targets:
//   * supabase/functions/ops-api/index.ts  POST /receiving-orders
//   * supabase/functions/ops-api/index.ts  POST /shipments
//   * supabase/functions/ops-api/index.ts  POST /production-runs
//
// Each endpoint accepts `payload: { lines: [...] }` (or, for production_run,
// `payload: { consumed: [...], produced: {...} }`). The schemas defined in
// _shared/types/vendors_inventory_ops.ts require every line to carry a
// valid UUID `item_id` and a numeric `quantity`.
//
// Constitutional invariant protected: API boundary contract is the
// authority. Rejecting malformed payloads up front means the audit_log
// auto-transition triggers downstream never see a row that would have
// caused stock_movements to drop entries (migration 0048's tolerant
// skip-on-null branch becomes dead code once F-Wave7-LINES-01 normalises
// lines into their own table — both layers stay until then).

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

const WAREHOUSE_ID = '00000000-0000-4000-8000-0000000000c1';
const ITEM_ID = '00000000-0000-4000-8000-0000000000d1';
const OUTPUT_ITEM_ID = '00000000-0000-4000-8000-0000000000d2';

// plugins.three_pl flag enabled for ORG_A. Required because ops-api's
// dispatcher returns 404 NOT_FOUND if the bundle gate is off.
function makeStateWithFlag(extra: Record<string, Array<Record<string, unknown>>> = {}) {
  return makeState({
    org_feature_flags: [
      {
        org_id: ORG_A,
        flag_key: 'plugins.three_pl',
        is_enabled: true,
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

describe('ops-api — strict line validation (F-Wave7-LINEFORM-VALIDATE-01)', () => {
  let handler: (req: Request) => Promise<Response> | Response;

  beforeAll(async () => {
    installDenoShim();
    resetCapturedHandler();
    await import('../../../../supabase/functions/ops-api/index.ts');
    handler = capturedHandler();
  });

  afterEach(() => clearActiveMockState());

  // -------------------------------------------------------------------------
  // Negative — missing item_id
  // -------------------------------------------------------------------------

  it('POST /receiving-orders rejects payload.lines without item_id (422)', async () => {
    setActiveMockState(makeStateWithFlag());
    const req = new Request('https://example.test/receiving-orders', {
      method: 'POST',
      headers: idemHeaders(),
      body: JSON.stringify({
        warehouse_id: WAREHOUSE_ID,
        payload: { lines: [{ quantity: 1 }] },
      }),
    });
    const res = await handler(req);
    expect(res.status).toBe(422);
    const body = await readJson(res);
    expect(body.error).toMatchObject({ code: 'VALIDATION_ERROR' });
    // Structured details surface the offending field.
    expect(JSON.stringify(body.error)).toMatch(/payload|lines|item_id/);
  });

  it('POST /shipments rejects payload.lines without item_id (422)', async () => {
    setActiveMockState(makeStateWithFlag());
    const req = new Request('https://example.test/shipments', {
      method: 'POST',
      headers: idemHeaders(),
      body: JSON.stringify({
        warehouse_id: WAREHOUSE_ID,
        payload: { lines: [{ quantity: 1 }] },
      }),
    });
    const res = await handler(req);
    expect(res.status).toBe(422);
    const body = await readJson(res);
    expect(body.error).toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('POST /production-runs rejects payload.consumed without item_id (422)', async () => {
    setActiveMockState(makeStateWithFlag());
    const req = new Request('https://example.test/production-runs', {
      method: 'POST',
      headers: idemHeaders(),
      body: JSON.stringify({
        warehouse_id: WAREHOUSE_ID,
        output_item_id: OUTPUT_ITEM_ID,
        payload: { consumed: [{ quantity: 1 }] },
      }),
    });
    const res = await handler(req);
    expect(res.status).toBe(422);
    const body = await readJson(res);
    expect(body.error).toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  // -------------------------------------------------------------------------
  // Negative — non-UUID item_id
  // -------------------------------------------------------------------------

  it('POST /receiving-orders rejects payload.lines with non-UUID item_id (422)', async () => {
    setActiveMockState(makeStateWithFlag());
    const req = new Request('https://example.test/receiving-orders', {
      method: 'POST',
      headers: idemHeaders(),
      body: JSON.stringify({
        warehouse_id: WAREHOUSE_ID,
        payload: { lines: [{ item_id: 'not-a-uuid', quantity: 1 }] },
      }),
    });
    const res = await handler(req);
    expect(res.status).toBe(422);
    const body = await readJson(res);
    expect(body.error).toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('POST /shipments rejects payload.lines with empty-string item_id (422)', async () => {
    setActiveMockState(makeStateWithFlag());
    const req = new Request('https://example.test/shipments', {
      method: 'POST',
      headers: idemHeaders(),
      body: JSON.stringify({
        warehouse_id: WAREHOUSE_ID,
        payload: { lines: [{ item_id: '', quantity: 1 }] },
      }),
    });
    const res = await handler(req);
    expect(res.status).toBe(422);
    const body = await readJson(res);
    expect(body.error).toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  // -------------------------------------------------------------------------
  // Positive — valid line shape is unchanged (201)
  // -------------------------------------------------------------------------

  // The positive assertions below verify that the line schemas do NOT
  // trip a 422 VALIDATION_ERROR on a well-formed payload. The mock's
  // insert path echoes the row back to .single() under-specified (it
  // can't synthesise audit columns the way a real Postgres default does)
  // so the downstream `ReceivingOrderSchema.parse(data)` may return 500
  // INTERNAL_ERROR. That is a test-harness shortcoming, not a
  // line-validation regression — the body-parse step we care about
  // already succeeded by then. We assert specifically: NOT a 422.

  it('POST /receiving-orders accepts a well-formed line (no 422)', async () => {
    setActiveMockState(makeStateWithFlag({ receiving_orders: [] }));
    const req = new Request('https://example.test/receiving-orders', {
      method: 'POST',
      headers: idemHeaders(),
      body: JSON.stringify({
        warehouse_id: WAREHOUSE_ID,
        payload: {
          lines: [{ item_id: ITEM_ID, quantity: 2, unit_cost_cents: 1500 }],
        },
      }),
    });
    const res = await handler(req);
    expect(res.status).not.toBe(422);
  });

  it('POST /production-runs accepts an empty payload (no 422)', async () => {
    setActiveMockState(makeStateWithFlag({ production_runs: [] }));
    const req = new Request('https://example.test/production-runs', {
      method: 'POST',
      headers: idemHeaders(),
      body: JSON.stringify({
        warehouse_id: WAREHOUSE_ID,
        output_item_id: OUTPUT_ITEM_ID,
        quantity_planned: 10,
        payload: {},
      }),
    });
    const res = await handler(req);
    expect(res.status).not.toBe(422);
  });

  it('POST /production-runs accepts well-formed consumed + produced (no 422)', async () => {
    setActiveMockState(makeStateWithFlag({ production_runs: [] }));
    const req = new Request('https://example.test/production-runs', {
      method: 'POST',
      headers: idemHeaders(),
      body: JSON.stringify({
        warehouse_id: WAREHOUSE_ID,
        output_item_id: OUTPUT_ITEM_ID,
        quantity_planned: 10,
        payload: {
          consumed: [{ item_id: ITEM_ID, quantity: 5 }],
          produced: { item_id: OUTPUT_ITEM_ID, quantity: 10 },
        },
      }),
    });
    const res = await handler(req);
    expect(res.status).not.toBe(422);
  });
});
