// Regression suite for A1 (WS-A MONEY INTEGRITY) - invoice line totals are
// SERVER-AUTHORITATIVE. A client may POST/PATCH a forged tax_amount_cents
// and line_total_cents in the body; the invoicing-api handler must IGNORE
// those fields and persist the server-recomputed values derived from the
// trusted inputs (quantity, unit_price_cents, tax_rate_snapshot,
// discount_cents).
//
// Why this matters: recompute_invoice_totals (migration 0018) sums
// line_total_cents and tax_amount_cents straight off invoice_line_items
// into the invoice header. A forged line total would silently inflate the
// invoice subtotal/tax/total and the GENERATED balance_cents. Closing the
// gap at the handler keeps the persisted line total trustworthy.
//
// Derived line formula (invoice tax_rate_snapshot is a DECIMAL FRACTION,
// numeric(7,4), e.g. 0.0825 = 8.25%, NOT integer bps as on quotes):
//   gross            = roundHalfEven(quantity * unit_price_cents)
//   net              = gross - discount_cents
//   tax_amount_cents = roundHalfEven(net * tax_rate_snapshot)
//   line_total_cents = net + tax_amount_cents
//
// Target:
//   * supabase/functions/invoicing-api/handlers/invoice_line_items.ts
//       createLineItem  (POST /invoices/:id/line-items)
//       patchLineItem   (PATCH /invoice-line-items/:line_id)
//
// Constitutional invariants protected:
//   * Money rules: integer BIGINT cents, banker's rounding, no float on
//     _cents. Server is the authority on persisted totals.
//   * RLS: org gate via ensureInvoiceForCaller (caller.orgId).
//   * Idempotency: handler keeps its respondWithIdempotency wrapper.

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

const INVOICE_A = '00000000-0000-4000-8000-0000000000a0';
const LINE_A = '00000000-0000-4000-8000-0000000000e0';

function idemHeaders(): Record<string, string> {
  return {
    authorization: bearer(OWNER),
    'content-type': 'application/json',
    'idempotency-key': crypto.randomUUID(),
  };
}

function invoiceRow(): Record<string, unknown> {
  return {
    id: INVOICE_A,
    org_id: ORG_A,
    invoice_number: 'INV-2026-00001',
    status: 'draft',
    currency_code: 'USD',
    deleted_at: null,
  };
}

function existingLineRow(): Record<string, unknown> {
  return {
    id: LINE_A,
    invoice_id: INVOICE_A,
    item_id: null,
    description: 'Widget',
    quantity: 10,
    unit_price_cents: 100,
    tax_rate_snapshot: 0,
    tax_amount_cents: 0,
    discount_cents: 0,
    line_total_cents: 1000,
    sort_order: 0,
  };
}

describe('invoicing-api - invoice line server recompute (A1)', () => {
  let handler: (req: Request) => Promise<Response> | Response;

  beforeAll(async () => {
    installDenoShim();
    resetCapturedHandler();
    await import('../../../../supabase/functions/invoicing-api/index.ts');
    handler = capturedHandler();
  });

  afterEach(() => clearActiveMockState());

  // -------------------------------------------------------------------------
  // CREATE: forged totals on POST are overwritten by the server recompute.
  // -------------------------------------------------------------------------

  it('POST /invoices/:id/line-items overwrites forged line_total_cents and tax_amount_cents', async () => {
    const state = makeState({
      invoices: [invoiceRow()],
      invoice_line_items: [],
    });
    setActiveMockState(state);

    // qty 10 * unit 100 = 1000 gross; discount 200 -> net 800; tax 0.10 of
    // 800 = 80; line total 880. The client forges 999999 / 555555.
    const req = new Request(
      `https://example.test/invoices/${INVOICE_A}/line-items`,
      {
        method: 'POST',
        headers: idemHeaders(),
        body: JSON.stringify({
          description: 'Widget',
          quantity: 10,
          unit_price_cents: 100,
          tax_rate_snapshot: 0.1,
          discount_cents: 200,
          tax_amount_cents: 555555,
          line_total_cents: 999999,
        }),
      },
    );
    await handler(req);

    const inserted = state.inserts.find(
      (i) => i.table === 'invoice_line_items',
    );
    expect(inserted).toBeDefined();
    // Server values win; forged values are dropped.
    expect(String(inserted?.row.tax_amount_cents)).toBe('80');
    expect(String(inserted?.row.line_total_cents)).toBe('880');
    expect(String(inserted?.row.tax_amount_cents)).not.toBe('555555');
    expect(String(inserted?.row.line_total_cents)).not.toBe('999999');
    // recompute_invoice_totals fired so the header stays in sync.
    expect(
      state.rpcCalls.some((c) => c.name === 'recompute_invoice_totals'),
    ).toBe(true);
  });

  it('POST /invoices/:id/line-items recomputes a zero-tax line total', async () => {
    const state = makeState({
      invoices: [invoiceRow()],
      invoice_line_items: [],
    });
    setActiveMockState(state);

    // qty 3 * unit 333 = 999; no discount, no tax; total 999. Forge 1.
    const req = new Request(
      `https://example.test/invoices/${INVOICE_A}/line-items`,
      {
        method: 'POST',
        headers: idemHeaders(),
        body: JSON.stringify({
          description: 'Service',
          quantity: 3,
          unit_price_cents: 333,
          tax_rate_snapshot: 0,
          discount_cents: 0,
          tax_amount_cents: 1,
          line_total_cents: 1,
        }),
      },
    );
    await handler(req);

    const inserted = state.inserts.find(
      (i) => i.table === 'invoice_line_items',
    );
    expect(String(inserted?.row.tax_amount_cents)).toBe('0');
    expect(String(inserted?.row.line_total_cents)).toBe('999');
  });

  // -------------------------------------------------------------------------
  // PATCH: forged totals on PATCH are overwritten by the server recompute.
  // -------------------------------------------------------------------------

  it('PATCH /invoice-line-items/:line_id overwrites forged totals using merged inputs', async () => {
    const state = makeState({
      invoices: [invoiceRow()],
      invoice_line_items: [existingLineRow()],
    });
    setActiveMockState(state);

    // Patch only quantity to 20 and tax_rate to 0.05; unit/discount carried
    // from the existing row (unit 100, discount 0). gross 2000; net 2000;
    // tax 0.05 * 2000 = 100; total 2100. Client forges 7777 / 88888.
    const req = new Request(
      `https://example.test/invoice-line-items/${LINE_A}`,
      {
        method: 'PATCH',
        headers: idemHeaders(),
        body: JSON.stringify({
          quantity: 20,
          tax_rate_snapshot: 0.05,
          tax_amount_cents: 7777,
          line_total_cents: 88888,
        }),
      },
    );
    await handler(req);

    const updated = state.updates.find(
      (u) => u.table === 'invoice_line_items',
    );
    expect(updated).toBeDefined();
    expect(String(updated?.patch.tax_amount_cents)).toBe('100');
    expect(String(updated?.patch.line_total_cents)).toBe('2100');
    expect(String(updated?.patch.tax_amount_cents)).not.toBe('7777');
    expect(String(updated?.patch.line_total_cents)).not.toBe('88888');
    expect(
      state.rpcCalls.some((c) => c.name === 'recompute_invoice_totals'),
    ).toBe(true);
  });

  it('PATCH /invoice-line-items/:line_id with no input fields still rewrites totals from current row', async () => {
    const state = makeState({
      invoices: [invoiceRow()],
      invoice_line_items: [existingLineRow()],
    });
    setActiveMockState(state);

    // Body carries ONLY a forged total. With no trusted input field, the
    // recompute uses the existing row (qty 10, unit 100, no discount/tax)
    // -> total 1000, tax 0. Forge must be dropped.
    const req = new Request(
      `https://example.test/invoice-line-items/${LINE_A}`,
      {
        method: 'PATCH',
        headers: idemHeaders(),
        body: JSON.stringify({
          line_total_cents: 424242,
          tax_amount_cents: 424242,
        }),
      },
    );
    await handler(req);

    const updated = state.updates.find(
      (u) => u.table === 'invoice_line_items',
    );
    expect(String(updated?.patch.line_total_cents)).toBe('1000');
    expect(String(updated?.patch.tax_amount_cents)).toBe('0');
  });
});
