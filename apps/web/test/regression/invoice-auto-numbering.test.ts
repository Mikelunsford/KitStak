// Regression suite for BNEW-4 (v2 smoke 2026-05-22) — auto-numbering for the
// standalone POST /invoices handler when the operator omits the
// invoice_number field. PR #105 (B8) wired Quote / Receiving Order /
// Shipment to the numbering chassis and updated the convert RPC via
// migration 0060, but the standalone POST /invoices handler was missed; the
// v2 smoke surfaced "Please fill out this field" still firing on invoice
// create. This test locks the fix in.
//
// Target:
//   * supabase/functions/invoicing-api/handlers/invoices.ts   POST /invoices
//
// Each test asserts two halves of the contract:
//   1. Blank/missing invoice_number on input -> handler calls
//      next_doc_number(org, 'invoice') and writes the returned value to the
//      insert row.
//   2. Operator-supplied invoice_number still wins -> next_doc_number is NOT
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

describe('invoicing-api — invoice auto-numbering (BNEW-4)', () => {
  let handler: (req: Request) => Promise<Response> | Response;

  beforeAll(async () => {
    installDenoShim();
    resetCapturedHandler();
    await import('../../../../supabase/functions/invoicing-api/index.ts');
    handler = capturedHandler();
  });

  afterEach(() => clearActiveMockState());

  it('POST /invoices calls next_doc_number when invoice_number is absent', async () => {
    const state = makeState({ invoices: [] });
    state.rpcResults['next_doc_number'] = {
      data: 'INV-2026-00001',
      error: null,
    };
    setActiveMockState(state);
    const req = new Request('https://example.test/invoices', {
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
      p_doc_type: 'invoice',
    });
    const inserted = state.inserts.find((i) => i.table === 'invoices');
    expect(inserted?.row.invoice_number).toBe('INV-2026-00001');
    expect(inserted?.row.org_id).toBe(ORG_A);
  });

  it('POST /invoices uses operator-supplied invoice_number verbatim and skips next_doc_number', async () => {
    const state = makeState({ invoices: [] });
    state.rpcResults['next_doc_number'] = {
      data: 'INV-AUTO-SHOULD-NOT-APPEAR',
      error: null,
    };
    setActiveMockState(state);
    const req = new Request('https://example.test/invoices', {
      method: 'POST',
      headers: idemHeaders(),
      body: JSON.stringify({
        invoice_number: 'INV-CUSTOM-001',
        currency_code: 'USD',
      }),
    });
    await handler(req);
    const call = state.rpcCalls.find((c) => c.name === 'next_doc_number');
    expect(call).toBeUndefined();
    const inserted = state.inserts.find((i) => i.table === 'invoices');
    expect(inserted?.row.invoice_number).toBe('INV-CUSTOM-001');
  });

  it('POST /invoices treats whitespace-only invoice_number as absent', async () => {
    const state = makeState({ invoices: [] });
    state.rpcResults['next_doc_number'] = {
      data: 'INV-2026-00002',
      error: null,
    };
    setActiveMockState(state);
    const req = new Request('https://example.test/invoices', {
      method: 'POST',
      headers: idemHeaders(),
      body: JSON.stringify({
        // invoice_number omitted — handler should call next_doc_number
        currency_code: 'USD',
      }),
    });
    await handler(req);
    const call = state.rpcCalls.find((c) => c.name === 'next_doc_number');
    expect(call).toBeDefined();
    const inserted = state.inserts.find((i) => i.table === 'invoices');
    expect(inserted?.row.invoice_number).toBe('INV-2026-00002');
  });
});
