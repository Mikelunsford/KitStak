// Regression suite for Phase B / WS5 FSM completeness (credit notes).
//
// Background: credit notes could be created and applied, but there was no
// issue or void transition endpoint at any layer, so a credit note was stuck
// at `draft`. This suite locks the two new transition handlers:
//   * POST /credit-notes/:id/issue  (draft -> issued)
//   * POST /credit-notes/:id/void   (draft|issued -> voided)
//
// Target:
//   * supabase/functions/invoicing-api/handlers/credit_notes.ts
//       issueCreditNote / voidCreditNote / transitionCreditNoteTo
//
// Each test asserts a slice of the contract:
//   1. issue: draft -> issued returns 200 and stamps status=issued + issued_at.
//   2. issue from issued -> 409 STATE_CONFLICT (illegal move).
//   3. void: issued -> voided returns 200 and stamps status=voided + voided_at.
//   4. void from voided -> 409 STATE_CONFLICT (terminal).
//   5. void from applied -> 409 STATE_CONFLICT (no applied -> voided edge).
//   6. cross-tenant / missing id -> 404 NOT_FOUND (RLS org gate, not 403).
//   7. missing Idempotency-Key -> 400 IDEMPOTENCY_KEY_REQUIRED.
//
// Constitutional invariants protected:
//   * RLS: cross-tenant read of the credit note resolves to the empty set, so
//     the transition surfaces 404 (not 403). The org gate is .eq('org_id', ...).
//   * Audit: the handler never hand-writes audit_log. The AFTER UPDATE status
//     trigger owns the audit row; the test asserts the status update patch.
//   * Idempotency: both handlers wrap the transition in respondWithIdempotency,
//     so a missing Idempotency-Key is rejected before any state change.
//   * Money rules: untouched (lifecycle metadata only).
//   * State machine: canFinanceTransition(creditNoteStateMachine, from, to) is
//     the gate; an illegal edge throws STATE_CONFLICT 409.

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

const ORG_A = '00000000-0000-4000-8000-0000000000a1';
const USER_A = '00000000-0000-4000-8000-0000000000b1';
const OWNER = { userId: USER_A, orgId: ORG_A, role: 'org_owner' as const };

const CN_ID = '00000000-0000-4000-8000-0000000000c1';
const MISSING_ID = '00000000-0000-4000-8000-0000000000f0';

function creditNoteRow(status: string): Record<string, unknown> {
  return {
    id: CN_ID,
    org_id: ORG_A,
    credit_note_number: 'CN-2026-00001',
    customer_id: null,
    source_invoice_id: null,
    status,
    state_changed_at: '2026-06-01T00:00:00.000Z',
    currency_code: 'USD',
    amount_cents: 10000,
    applied_cents: 0,
    reason: null,
    issued_at: null,
    voided_at: null,
    created_at: '2026-06-01T00:00:00.000Z',
    updated_at: '2026-06-01T00:00:00.000Z',
    deleted_at: null,
  };
}

function stateWith(status: string): MockState {
  return makeState({ credit_notes: [creditNoteRow(status)] });
}

function idemHeaders(): Record<string, string> {
  return {
    authorization: bearer(OWNER),
    'content-type': 'application/json',
    'idempotency-key': crypto.randomUUID(),
  };
}

function noIdemHeaders(): Record<string, string> {
  return {
    authorization: bearer(OWNER),
    'content-type': 'application/json',
  };
}

describe('invoicing-api — credit note issue/void transitions', () => {
  let handler: (req: Request) => Promise<Response> | Response;

  beforeAll(async () => {
    installDenoShim();
    resetCapturedHandler();
    await import('../../../../supabase/functions/invoicing-api/index.ts');
    handler = capturedHandler();
  });

  afterEach(() => clearActiveMockState());

  it('POST /credit-notes/:id/issue transitions draft -> issued (200) and stamps issued_at', async () => {
    const state = stateWith('draft');
    setActiveMockState(state);

    const req = new Request(
      `https://example.test/credit-notes/${CN_ID}/issue`,
      { method: 'POST', headers: idemHeaders() },
    );
    const res = await handler(req);
    expect(res.status).toBe(200);

    const envelope = (await res.json()) as { data: { status: string } };
    expect(envelope.data.status).toBe('issued');

    const update = state.updates.find((u) => u.table === 'credit_notes');
    expect(update?.patch.status).toBe('issued');
    expect(update?.patch.issued_at).toBeDefined();
    // The handler never writes voided_at on an issue.
    expect(update?.patch.voided_at).toBeUndefined();
  });

  it('POST /credit-notes/:id/issue from issued -> 409 STATE_CONFLICT', async () => {
    const state = stateWith('issued');
    setActiveMockState(state);

    const req = new Request(
      `https://example.test/credit-notes/${CN_ID}/issue`,
      { method: 'POST', headers: idemHeaders() },
    );
    const res = await handler(req);
    expect(res.status).toBe(409);

    const envelope = (await res.json()) as { error: { code: string } };
    expect(envelope.error.code).toBe('STATE_CONFLICT');
    // No status update was attempted.
    expect(state.updates.find((u) => u.table === 'credit_notes')).toBeUndefined();
  });

  it('POST /credit-notes/:id/void transitions issued -> voided (200) and stamps voided_at', async () => {
    const state = stateWith('issued');
    setActiveMockState(state);

    const req = new Request(
      `https://example.test/credit-notes/${CN_ID}/void`,
      { method: 'POST', headers: idemHeaders() },
    );
    const res = await handler(req);
    expect(res.status).toBe(200);

    const envelope = (await res.json()) as { data: { status: string } };
    expect(envelope.data.status).toBe('voided');

    const update = state.updates.find((u) => u.table === 'credit_notes');
    expect(update?.patch.status).toBe('voided');
    expect(update?.patch.voided_at).toBeDefined();
  });

  it('POST /credit-notes/:id/void transitions draft -> voided (200)', async () => {
    const state = stateWith('draft');
    setActiveMockState(state);

    const req = new Request(
      `https://example.test/credit-notes/${CN_ID}/void`,
      { method: 'POST', headers: idemHeaders() },
    );
    const res = await handler(req);
    expect(res.status).toBe(200);

    const envelope = (await res.json()) as { data: { status: string } };
    expect(envelope.data.status).toBe('voided');
  });

  it('POST /credit-notes/:id/void from voided -> 409 STATE_CONFLICT (terminal)', async () => {
    const state = stateWith('voided');
    setActiveMockState(state);

    const req = new Request(
      `https://example.test/credit-notes/${CN_ID}/void`,
      { method: 'POST', headers: idemHeaders() },
    );
    const res = await handler(req);
    expect(res.status).toBe(409);

    const envelope = (await res.json()) as { error: { code: string } };
    expect(envelope.error.code).toBe('STATE_CONFLICT');
  });

  it('POST /credit-notes/:id/void from applied -> 409 STATE_CONFLICT (no applied -> voided edge)', async () => {
    const state = stateWith('applied');
    setActiveMockState(state);

    const req = new Request(
      `https://example.test/credit-notes/${CN_ID}/void`,
      { method: 'POST', headers: idemHeaders() },
    );
    const res = await handler(req);
    expect(res.status).toBe(409);

    const envelope = (await res.json()) as { error: { code: string } };
    expect(envelope.error.code).toBe('STATE_CONFLICT');
  });

  it('POST /credit-notes/:id/issue for a missing / cross-tenant id -> 404 NOT_FOUND', async () => {
    // The credit note table holds a draft row for CN_ID only. A request for
    // MISSING_ID resolves the empty set under the org gate, so the handler
    // surfaces 404 (constitutional answer for cross-tenant, never 403).
    const state = stateWith('draft');
    setActiveMockState(state);

    const req = new Request(
      `https://example.test/credit-notes/${MISSING_ID}/issue`,
      { method: 'POST', headers: idemHeaders() },
    );
    const res = await handler(req);
    expect(res.status).toBe(404);

    const envelope = (await res.json()) as { error: { code: string } };
    expect(envelope.error.code).toBe('NOT_FOUND');
  });

  it('POST /credit-notes/:id/issue without an Idempotency-Key -> 400', async () => {
    const state = stateWith('draft');
    setActiveMockState(state);

    const req = new Request(
      `https://example.test/credit-notes/${CN_ID}/issue`,
      { method: 'POST', headers: noIdemHeaders() },
    );
    const res = await handler(req);
    expect(res.status).toBe(400);

    const envelope = (await res.json()) as { error: { code: string } };
    expect(envelope.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
    // The transition never ran, so no status update was recorded.
    expect(state.updates.find((u) => u.table === 'credit_notes')).toBeUndefined();
  });

  it('POST /credit-notes/:id/void without an Idempotency-Key -> 400', async () => {
    const state = stateWith('issued');
    setActiveMockState(state);

    const req = new Request(
      `https://example.test/credit-notes/${CN_ID}/void`,
      { method: 'POST', headers: noIdemHeaders() },
    );
    const res = await handler(req);
    expect(res.status).toBe(400);

    const envelope = (await res.json()) as { error: { code: string } };
    expect(envelope.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });
});
