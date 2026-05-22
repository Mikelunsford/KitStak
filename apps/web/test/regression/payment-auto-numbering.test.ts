// Regression suite for B8 completion (v2 smoke 2026-05-22) — auto-numbering
// for the standalone POST /payments handler when the operator omits the
// payment_number field. PR-B (#117) wired the same change for the standalone
// invoice POST; payment is the last of the five chassis-eligible doc types
// (quote / receiving / shipment / invoice / payment) still requiring manual
// entry. This test locks the fix in.
//
// Target:
//   * supabase/functions/invoicing-api/handlers/payments.ts   POST /payments
//
// Each test asserts two halves of the contract:
//   1. Blank/missing payment_number on input -> handler calls
//      next_doc_number(org, 'payment') and writes the returned value to the
//      insert row.
//   2. Operator-supplied payment_number still wins -> next_doc_number is NOT
//      called and the supplied string lands in the insert row verbatim.
//
// Constitutional invariants protected:
//   * Money rules: untouched (numbering is metadata).
//   * RLS: org gate enforced by handler (caller.orgId), verified by
//     inspecting state.inserts[0].row.org_id.
//   * Audit: handlers do not write audit_log directly; numbering allocation
//     is metadata and not an FSM transition.
//   * Idempotency: the handler continues to wrap its insert in
//     respondWithIdempotency. The numbering allocation happens inside the
//     idempotency block so a cache hit replays the cached envelope and does
//     NOT call next_doc_number twice.

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

function idemHeaders(): Record<string, string> {
  return {
    authorization: bearer(OWNER),
    'content-type': 'application/json',
    'idempotency-key': crypto.randomUUID(),
  };
}

describe('invoicing-api — payment auto-numbering (B8 completion)', () => {
  let handler: (req: Request) => Promise<Response> | Response;

  beforeAll(async () => {
    installDenoShim();
    resetCapturedHandler();
    await import('../../../../supabase/functions/invoicing-api/index.ts');
    handler = capturedHandler();
  });

  afterEach(() => clearActiveMockState());

  it('POST /payments calls next_doc_number when payment_number is absent', async () => {
    const state = makeState({ payments: [] });
    state.rpcResults['next_doc_number'] = {
      data: 'PMT-2026-00001',
      error: null,
    };
    setActiveMockState(state);
    const req = new Request('https://example.test/payments', {
      method: 'POST',
      headers: idemHeaders(),
      body: JSON.stringify({
        amount_cents: '10000',
        currency_code: 'USD',
      }),
    });
    await handler(req);
    const call = state.rpcCalls.find((c) => c.name === 'next_doc_number');
    expect(call).toBeDefined();
    expect(call?.args).toMatchObject({
      p_org_id: ORG_A,
      p_doc_type: 'payment',
    });
    const inserted = state.inserts.find((i) => i.table === 'payments');
    expect(inserted?.row.payment_number).toBe('PMT-2026-00001');
    expect(inserted?.row.org_id).toBe(ORG_A);
  });

  it('POST /payments uses operator-supplied payment_number verbatim and skips next_doc_number', async () => {
    const state = makeState({ payments: [] });
    state.rpcResults['next_doc_number'] = {
      data: 'PMT-AUTO-SHOULD-NOT-APPEAR',
      error: null,
    };
    setActiveMockState(state);
    const req = new Request('https://example.test/payments', {
      method: 'POST',
      headers: idemHeaders(),
      body: JSON.stringify({
        payment_number: 'PMT-CUSTOM-001',
        amount_cents: '10000',
        currency_code: 'USD',
      }),
    });
    await handler(req);
    const call = state.rpcCalls.find((c) => c.name === 'next_doc_number');
    expect(call).toBeUndefined();
    const inserted = state.inserts.find((i) => i.table === 'payments');
    expect(inserted?.row.payment_number).toBe('PMT-CUSTOM-001');
  });

  it('POST /payments treats whitespace-only payment_number as absent', async () => {
    const state = makeState({ payments: [] });
    state.rpcResults['next_doc_number'] = {
      data: 'PMT-2026-00002',
      error: null,
    };
    setActiveMockState(state);
    const req = new Request('https://example.test/payments', {
      method: 'POST',
      headers: idemHeaders(),
      body: JSON.stringify({
        // payment_number omitted — handler should call next_doc_number
        amount_cents: '10000',
        currency_code: 'USD',
      }),
    });
    await handler(req);
    const call = state.rpcCalls.find((c) => c.name === 'next_doc_number');
    expect(call).toBeDefined();
    const inserted = state.inserts.find((i) => i.table === 'payments');
    expect(inserted?.row.payment_number).toBe('PMT-2026-00002');
  });
});
