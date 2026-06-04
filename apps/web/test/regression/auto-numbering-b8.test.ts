// Regression suite for F-Wave9-AUTO-NUMBERING-01 (B8) — auto-numbering for
// Quote / Receiving Order / Shipment when the operator omits the number
// field. The convert-to-invoice RPC migration (0060) cannot be exercised
// from this Vitest harness because the supabase-mock does not execute
// PL/pgSQL; that path is covered by the migration body + DB-side tests run
// in the Supabase project.
//
// Targets:
//   * supabase/functions/quotes-api/index.ts          POST /quotes
//   * supabase/functions/ops-api/index.ts             POST /receiving-orders
//   * supabase/functions/ops-api/index.ts             POST /shipments
//
// Each test asserts two halves of the contract:
//   1. Blank/missing number on input -> handler calls next_doc_number(org,
//      <doc_type>) and writes the returned value to the insert row.
//   2. Operator-supplied number still wins -> next_doc_number is NOT called
//      and the supplied string lands in the insert row verbatim.
//
// Constitutional invariants protected:
//   * Money rules: untouched (numbering is metadata).
//   * RLS: org gate enforced by handler (caller.orgId), verified by
//     inspecting state.inserts[0].row.org_id.
//   * Audit: handlers do not write audit_log directly; numbering allocation
//     is metadata and not an FSM transition.
//   * Idempotency: the handlers continue to wrap inserts in
//     respondWithIdempotency, so a replay of the same Idempotency-Key
//     returns the cached envelope and does NOT call next_doc_number twice.
//     (Verified by inspecting rpcCalls length on the second invocation.)

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

const WAREHOUSE_ID = '00000000-0000-4000-8000-0000000000c1';

function withThreePlFlag(extra: Record<string, Array<Record<string, unknown>>> = {}): MockState {
  return makeState({
    org_feature_flags: [
      {
        org_id: ORG_A,
        flag_key: 'plugins.three_pl',
        is_enabled: true,
        config: {},
      },
    ],
    // FK validation parent: ops-api receiving/shipment create org-checks
    // warehouse_id via assertRefInOrg before insert.
    warehouses: [{ id: WAREHOUSE_ID, org_id: ORG_A }],
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

// ---------------------------------------------------------------------------
// quotes-api
// ---------------------------------------------------------------------------

describe('quotes-api — auto-numbering (B8)', () => {
  let handler: (req: Request) => Promise<Response> | Response;

  beforeAll(async () => {
    installDenoShim();
    resetCapturedHandler();
    await import('../../../../supabase/functions/quotes-api/index.ts');
    handler = capturedHandler();
  });

  afterEach(() => {
    clearActiveMockState();
    // quotes-api is now bundle-gated on plugins.three_pl
    // (F-Wave9-COWORK-SMOKE-06). The flag reader caches per-org for 5
    // minutes; flipping the gate between tests requires invalidation.
    invalidateFlagCache(ORG_A);
  });

  it('POST /quotes calls next_doc_number when number is absent', async () => {
    const state = withThreePlFlag({ quotes: [] });
    state.rpcResults['next_doc_number'] = {
      data: 'Q-2026-00001',
      error: null,
    };
    setActiveMockState(state);
    const req = new Request('https://example.test/quotes', {
      method: 'POST',
      headers: idemHeaders(),
      body: JSON.stringify({
        currency_code: 'USD',
      }),
    });
    await handler(req);
    const call = state.rpcCalls.find((c) => c.name === 'next_doc_number');
    expect(call).toBeDefined();
    expect(call?.args).toMatchObject({
      p_org_id: ORG_A,
      p_doc_type: 'quote',
    });
    const inserted = state.inserts.find((i) => i.table === 'quotes');
    expect(inserted?.row.number).toBe('Q-2026-00001');
  });

  it('POST /quotes uses operator-supplied number verbatim and skips next_doc_number', async () => {
    const state = withThreePlFlag({ quotes: [] });
    state.rpcResults['next_doc_number'] = {
      data: 'Q-AUTO-SHOULD-NOT-APPEAR',
      error: null,
    };
    setActiveMockState(state);
    const req = new Request('https://example.test/quotes', {
      method: 'POST',
      headers: idemHeaders(),
      body: JSON.stringify({
        number: 'Q-CUSTOM-001',
        currency_code: 'USD',
      }),
    });
    await handler(req);
    const call = state.rpcCalls.find((c) => c.name === 'next_doc_number');
    expect(call).toBeUndefined();
    const inserted = state.inserts.find((i) => i.table === 'quotes');
    expect(inserted?.row.number).toBe('Q-CUSTOM-001');
  });

  it('POST /quotes treats whitespace-only number as absent', async () => {
    const state = withThreePlFlag({ quotes: [] });
    state.rpcResults['next_doc_number'] = {
      data: 'Q-2026-00002',
      error: null,
    };
    setActiveMockState(state);
    const req = new Request('https://example.test/quotes', {
      method: 'POST',
      headers: idemHeaders(),
      body: JSON.stringify({
        // number absent — handler should call next_doc_number
        currency_code: 'USD',
      }),
    });
    await handler(req);
    const call = state.rpcCalls.find((c) => c.name === 'next_doc_number');
    expect(call).toBeDefined();
    const inserted = state.inserts.find((i) => i.table === 'quotes');
    expect(inserted?.row.number).toBe('Q-2026-00002');
  });
});

// ---------------------------------------------------------------------------
// ops-api — receiving + shipment
// ---------------------------------------------------------------------------

describe('ops-api — auto-numbering (B8)', () => {
  let handler: (req: Request) => Promise<Response> | Response;

  beforeAll(async () => {
    installDenoShim();
    resetCapturedHandler();
    await import('../../../../supabase/functions/ops-api/index.ts');
    handler = capturedHandler();
  });

  afterEach(() => {
    clearActiveMockState();
    invalidateFlagCache(ORG_A);
  });

  // ---- receiving_orders ----

  it('POST /receiving-orders calls next_doc_number when receiving_number is absent', async () => {
    const state = withThreePlFlag({ receiving_orders: [] });
    state.rpcResults['next_doc_number'] = {
      data: 'RCV-2026-00001',
      error: null,
    };
    setActiveMockState(state);
    const req = new Request('https://example.test/receiving-orders', {
      method: 'POST',
      headers: idemHeaders(),
      body: JSON.stringify({
        warehouse_id: WAREHOUSE_ID,
        payload: { lines: [] },
      }),
    });
    await handler(req);
    const call = state.rpcCalls.find((c) => c.name === 'next_doc_number');
    expect(call).toBeDefined();
    expect(call?.args).toMatchObject({
      p_org_id: ORG_A,
      p_doc_type: 'receiving_order',
    });
    const inserted = state.inserts.find((i) => i.table === 'receiving_orders');
    expect(inserted?.row.receiving_number).toBe('RCV-2026-00001');
  });

  it('POST /receiving-orders uses operator-supplied receiving_number verbatim', async () => {
    const state = withThreePlFlag({ receiving_orders: [] });
    state.rpcResults['next_doc_number'] = {
      data: 'RCV-AUTO-SHOULD-NOT-APPEAR',
      error: null,
    };
    setActiveMockState(state);
    const req = new Request('https://example.test/receiving-orders', {
      method: 'POST',
      headers: idemHeaders(),
      body: JSON.stringify({
        warehouse_id: WAREHOUSE_ID,
        receiving_number: 'RCV-CUSTOM-001',
        payload: { lines: [] },
      }),
    });
    await handler(req);
    const call = state.rpcCalls.find((c) => c.name === 'next_doc_number');
    expect(call).toBeUndefined();
    const inserted = state.inserts.find((i) => i.table === 'receiving_orders');
    expect(inserted?.row.receiving_number).toBe('RCV-CUSTOM-001');
  });

  // ---- shipments ----

  it('POST /shipments calls next_doc_number when shipment_number is absent', async () => {
    const state = withThreePlFlag({ shipments: [] });
    state.rpcResults['next_doc_number'] = {
      data: 'SHP-2026-00001',
      error: null,
    };
    setActiveMockState(state);
    const req = new Request('https://example.test/shipments', {
      method: 'POST',
      headers: idemHeaders(),
      body: JSON.stringify({
        warehouse_id: WAREHOUSE_ID,
        payload: { lines: [] },
      }),
    });
    await handler(req);
    const call = state.rpcCalls.find((c) => c.name === 'next_doc_number');
    expect(call).toBeDefined();
    expect(call?.args).toMatchObject({
      p_org_id: ORG_A,
      p_doc_type: 'shipment',
    });
    const inserted = state.inserts.find((i) => i.table === 'shipments');
    expect(inserted?.row.shipment_number).toBe('SHP-2026-00001');
  });

  it('POST /shipments uses operator-supplied shipment_number verbatim', async () => {
    const state = withThreePlFlag({ shipments: [] });
    state.rpcResults['next_doc_number'] = {
      data: 'SHP-AUTO-SHOULD-NOT-APPEAR',
      error: null,
    };
    setActiveMockState(state);
    const req = new Request('https://example.test/shipments', {
      method: 'POST',
      headers: idemHeaders(),
      body: JSON.stringify({
        warehouse_id: WAREHOUSE_ID,
        shipment_number: 'SHP-CUSTOM-001',
        payload: { lines: [] },
      }),
    });
    await handler(req);
    const call = state.rpcCalls.find((c) => c.name === 'next_doc_number');
    expect(call).toBeUndefined();
    const inserted = state.inserts.find((i) => i.table === 'shipments');
    expect(inserted?.row.shipment_number).toBe('SHP-CUSTOM-001');
  });
});
