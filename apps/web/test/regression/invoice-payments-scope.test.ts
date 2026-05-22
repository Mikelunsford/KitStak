// Regression suite for BNEW-12 — InvoiceDetailPage PAYMENTS section
// scope.
//
// Background (2026-05-22 v2 re-smoke walk): the operator opened a
// brand-new DRAFT invoice for Smoke V2 Co. with $0 balance and zero
// allocations. The PAYMENTS section rendered yesterday's SV2-PAY-001
// and SV2-PAY-002 with "unapplied $0.00" because the SPA query was
// scoped by customer_id, not by invoice_id. The intent of the section
// header has always been "payments applied to THIS invoice"; the fix
// adds an ?invoice_id= filter to GET /payments backed by a join over
// payment_allocations, and rewires InvoiceDetailPage to use it.
//
// Target:
//   * supabase/functions/invoicing-api/handlers/payments.ts listPayments
//
// Each test asserts:
//   1. GET /payments?invoice_id=<A> returns only payments with an
//      allocation against invoice A, even when the same customer has
//      additional payments allocated to a different invoice B.
//   2. GET /payments?invoice_id=<B> returns only the second payment.
//   3. GET /payments?invoice_id=<C> for a brand-new invoice with zero
//      allocations returns an empty array.
//
// Constitutional invariants protected:
//   * Money rules: untouched. Integer cents on amount/unapplied unchanged.
//   * RLS: untouched. payments Pattern A + payment_allocations Pattern B
//     already gate the org. A cross-tenant invoice_id reads the empty
//     set and 200 + [] (the allocation lookup is bounded by RLS).
//   * Audit: read path, no audit rows.
//   * Idempotency: read path, untouched.

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

const CUSTOMER_ID = '00000000-0000-4000-8000-0000000000c0';

const INVOICE_A = '00000000-0000-4000-8000-0000000000a0';
const INVOICE_B = '00000000-0000-4000-8000-0000000000b0';
const INVOICE_C = '00000000-0000-4000-8000-0000000000d0';

const PAYMENT_A = '00000000-0000-4000-8000-0000000000a1';
const PAYMENT_B = '00000000-0000-4000-8000-0000000000b1';

const ALLOC_A = '00000000-0000-4000-8000-0000000000a2';
const ALLOC_B = '00000000-0000-4000-8000-0000000000b2';

function paymentRow(
  id: string,
  payment_number: string,
  amount_cents: number,
): Record<string, unknown> {
  return {
    id,
    org_id: ORG_A,
    payment_number,
    customer_id: CUSTOMER_ID,
    amount_cents,
    currency_code: 'USD',
    payment_method: null,
    reference_number: null,
    received_at: '2026-05-22T00:00:00.000Z',
    notes: null,
    unapplied_cents: 0,
    created_at: '2026-05-22T00:00:00.000Z',
    updated_at: '2026-05-22T00:00:00.000Z',
    deleted_at: null,
  };
}

function allocRow(
  id: string,
  payment_id: string,
  invoice_id: string,
  amount_cents: number,
): Record<string, unknown> {
  return {
    id,
    payment_id,
    invoice_id,
    amount_cents,
    created_at: '2026-05-22T00:00:00.000Z',
    created_by: USER_A,
  };
}

function getHeaders(): Record<string, string> {
  return {
    authorization: bearer(OWNER),
  };
}

function makeStateWithTwoPaymentsTwoInvoices() {
  // Two payments from the same customer, each allocated to a different
  // invoice. The BNEW-12 fix says ?invoice_id=A returns only PAYMENT_A
  // (which has an allocation against INVOICE_A) and ?invoice_id=B
  // returns only PAYMENT_B.
  return makeState({
    payments: [
      paymentRow(PAYMENT_A, 'SV2-PAY-001', 250000),
      paymentRow(PAYMENT_B, 'SV2-PAY-002', 500000),
    ],
    payment_allocations: [
      allocRow(ALLOC_A, PAYMENT_A, INVOICE_A, 250000),
      allocRow(ALLOC_B, PAYMENT_B, INVOICE_B, 500000),
    ],
  });
}

describe('invoicing-api — listPayments invoice_id scope (BNEW-12)', () => {
  let handler: (req: Request) => Promise<Response> | Response;

  beforeAll(async () => {
    installDenoShim();
    resetCapturedHandler();
    await import('../../../../supabase/functions/invoicing-api/index.ts');
    handler = capturedHandler();
  });

  afterEach(() => clearActiveMockState());

  it('GET /payments?invoice_id=A returns only the payment allocated to invoice A', async () => {
    const state = makeStateWithTwoPaymentsTwoInvoices();
    setActiveMockState(state);

    const req = new Request(
      `https://example.test/payments?invoice_id=${INVOICE_A}`,
      { method: 'GET', headers: getHeaders() },
    );
    const res = await handler(req);
    expect(res.status).toBe(200);

    // ok() wraps list responses in { data: [...] }.
    const envelope = (await res.json()) as { data: Array<{ id: string }> };
    expect(envelope.data.length).toBe(1);
    expect(envelope.data[0]!.id).toBe(PAYMENT_A);
  });

  it('GET /payments?invoice_id=B returns only the payment allocated to invoice B', async () => {
    const state = makeStateWithTwoPaymentsTwoInvoices();
    setActiveMockState(state);

    const req = new Request(
      `https://example.test/payments?invoice_id=${INVOICE_B}`,
      { method: 'GET', headers: getHeaders() },
    );
    const res = await handler(req);
    expect(res.status).toBe(200);

    const envelope = (await res.json()) as { data: Array<{ id: string }> };
    expect(envelope.data.length).toBe(1);
    expect(envelope.data[0]!.id).toBe(PAYMENT_B);
  });

  it('GET /payments?invoice_id=C (no allocations) returns []', async () => {
    // The 2026-05-22 evidence: a brand-new DRAFT invoice with $0 balance
    // and zero allocations was rendering yesterday's customer-scoped
    // payments. This test locks the empty-state contract.
    const state = makeStateWithTwoPaymentsTwoInvoices();
    setActiveMockState(state);

    const req = new Request(
      `https://example.test/payments?invoice_id=${INVOICE_C}`,
      { method: 'GET', headers: getHeaders() },
    );
    const res = await handler(req);
    expect(res.status).toBe(200);

    const envelope = (await res.json()) as { data: Array<unknown> };
    expect(envelope.data.length).toBe(0);
  });

  it('GET /payments?customer_id=<id> (legacy, no invoice_id) still returns both customer payments', async () => {
    // Regression guard: the customer_id-scoped view stays intact for
    // CustomerDetailPage. Only InvoiceDetailPage swaps to invoice_id.
    const state = makeStateWithTwoPaymentsTwoInvoices();
    setActiveMockState(state);

    const req = new Request(
      `https://example.test/payments?customer_id=${CUSTOMER_ID}`,
      { method: 'GET', headers: getHeaders() },
    );
    const res = await handler(req);
    expect(res.status).toBe(200);

    const envelope = (await res.json()) as { data: Array<{ id: string }> };
    expect(envelope.data.length).toBe(2);
  });
});
