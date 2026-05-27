// Regression suite for customer-portal-api list endpoints (Path B3).
//
// The endpoints already existed before B3; B3 wires the SPA to consume them.
// This suite locks down the constitutional contract so the SPA can rely on
// it without surprise:
//
//   1. customer_user gets ONLY their own customer_id's rows scoped to
//      their org. Other customers in the same org are invisible.
//   2. Non-customer_user roles (staff, ops, viewer, vendor_user) get 404
//      on every /portal/* route per the Pattern B "hide existence" rule.
//   3. /portal/me returns the right customer envelope when the membership
//      is mapped.
//   4. /portal/me returns 404 (not 500) when org_memberships has no
//      customer_id mapping for the caller.

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
const CUSTOMER_A = '00000000-0000-4000-8000-0000000000c1';
const CUSTOMER_B = '00000000-0000-4000-8000-0000000000c2';
const CUSTOMER_USER_A = '00000000-0000-4000-8000-0000000000b1';
const STAFF_USER_A = '00000000-0000-4000-8000-0000000000b2';
const CUSTOMER_USER_NO_MAPPING = '00000000-0000-4000-8000-0000000000b3';

const PORTAL_CALLER = {
  userId: CUSTOMER_USER_A,
  orgId: ORG_A,
  role: 'customer_user' as const,
};
const STAFF_CALLER = {
  userId: STAFF_USER_A,
  orgId: ORG_A,
  role: 'org_owner' as const,
};
const UNMAPPED_PORTAL_CALLER = {
  userId: CUSTOMER_USER_NO_MAPPING,
  orgId: ORG_A,
  role: 'customer_user' as const,
};

function readJsonStatus(res: Response): Promise<{
  status: number;
  json: { data?: unknown; error?: { code?: string } };
}> {
  return res.text().then((t) => ({ status: res.status, json: JSON.parse(t) }));
}

function get(
  path: string,
  caller: { userId: string; orgId: string; role: string },
): Request {
  return new Request(`https://example.test${path}`, {
    method: 'GET',
    headers: {
      authorization: bearer(caller),
    },
  });
}

function makePortalState() {
  return makeState({
    customers: [
      {
        id: CUSTOMER_A,
        org_id: ORG_A,
        display_name: 'Acme Co.',
        email: 'acme@example.test',
        deleted_at: null,
      },
      {
        id: CUSTOMER_B,
        org_id: ORG_A,
        display_name: 'Other Customer Co.',
        email: 'other@example.test',
        deleted_at: null,
      },
    ],
    org_memberships: [
      {
        org_id: ORG_A,
        user_id: CUSTOMER_USER_A,
        customer_id: CUSTOMER_A,
        is_active: true,
      },
      {
        org_id: ORG_A,
        user_id: CUSTOMER_USER_NO_MAPPING,
        customer_id: null,
        is_active: true,
      },
    ],
    invoices: [
      {
        id: 'inv-a1',
        org_id: ORG_A,
        customer_id: CUSTOMER_A,
        number: 'INV-001',
        invoice_number: 'INV-001',
        status: 'sent',
        issued_at: '2026-04-15',
        issue_date: '2026-04-15',
        due_at: '2026-05-15',
        due_date: '2026-05-15',
        subtotal_cents: 75000,
        tax_total_cents: 0,
        total_cents: 75000,
        balance_cents: 75000,
        currency_code: 'USD',
        deleted_at: null,
      },
      {
        id: 'inv-b1',
        org_id: ORG_A,
        customer_id: CUSTOMER_B,
        number: 'INV-OTHER',
        invoice_number: 'INV-OTHER',
        status: 'sent',
        issued_at: '2026-04-15',
        issue_date: '2026-04-15',
        due_at: '2026-05-15',
        due_date: '2026-05-15',
        subtotal_cents: 99999,
        tax_total_cents: 0,
        total_cents: 99999,
        balance_cents: 99999,
        currency_code: 'USD',
        deleted_at: null,
      },
    ],
    invoice_line_items: [
      {
        id: 'line-a1',
        invoice_id: 'inv-a1',
        description: 'Pallet receiving',
        quantity: 1,
        unit_price_cents: 75000,
        line_total_cents: 75000,
        position: 0,
      },
    ],
    quotes: [
      {
        id: 'q-a1',
        org_id: ORG_A,
        customer_id: CUSTOMER_A,
        number: 'Q-001',
        status: 'sent',
        state: 'sent',
        issued_at: '2026-05-10',
        sent_at: '2026-05-10',
        submitted_at: '2026-05-10',
        expires_at: '2026-06-10',
        expiration_date: '2026-06-10',
        subtotal_cents: 284000,
        tax_cents: 0,
        total_cents: 284000,
        currency_code: 'USD',
        deleted_at: null,
      },
      {
        id: 'q-b1',
        org_id: ORG_A,
        customer_id: CUSTOMER_B,
        number: 'Q-OTHER',
        status: 'sent',
        state: 'sent',
        issued_at: '2026-05-10',
        sent_at: '2026-05-10',
        submitted_at: '2026-05-10',
        expires_at: '2026-06-10',
        expiration_date: '2026-06-10',
        subtotal_cents: 100000,
        tax_cents: 0,
        total_cents: 100000,
        currency_code: 'USD',
        deleted_at: null,
      },
    ],
    quote_line_items: [
      {
        id: 'qline-a1',
        quote_id: 'q-a1',
        name: 'Setup fee',
        quantity_e3: 1000,
        unit_price_cents: 284000,
        line_total_cents: 284000,
        position: 0,
      },
    ],
    projects: [
      {
        id: 'p-a1',
        org_id: ORG_A,
        customer_id: CUSTOMER_A,
        name: 'Spring Campaign',
        status: 'in_production',
        started_at: '2026-05-01',
        expected_completion_at: '2026-06-15',
      },
    ],
  });
}

describe('customer-portal-api list endpoints - Path B3', () => {
  let handler: (req: Request) => Promise<Response> | Response;

  beforeAll(async () => {
    installDenoShim();
    resetCapturedHandler();
    await import(
      '../../../../supabase/functions/customer-portal-api/index.ts'
    );
    handler = capturedHandler();
  });

  afterEach(() => {
    clearActiveMockState();
  });

  it('GET /portal/me returns the caller customer envelope', async () => {
    setActiveMockState(makePortalState());
    const res = await handler(get('/portal/me', PORTAL_CALLER));
    const { status, json } = await readJsonStatus(res);
    expect(status).toBe(200);
    expect(json.data).toMatchObject({
      customer_id: CUSTOMER_A,
      org_id: ORG_A,
      display_name: 'Acme Co.',
    });
  });

  it('GET /portal/me returns 404 when membership has no customer_id mapping', async () => {
    setActiveMockState(makePortalState());
    const res = await handler(get('/portal/me', UNMAPPED_PORTAL_CALLER));
    const { status, json } = await readJsonStatus(res);
    expect(status).toBe(404);
    expect(json.error?.code).toBe('NOT_FOUND');
  });

  it('GET /portal/invoices returns ONLY the caller customers invoices', async () => {
    setActiveMockState(makePortalState());
    const res = await handler(get('/portal/invoices', PORTAL_CALLER));
    const { status, json } = await readJsonStatus(res);
    expect(status).toBe(200);
    const rows = (json.data ?? []) as Array<{ customer_id: string; number: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.number).toBe('INV-001');
    // The other customer's INV-OTHER must NOT leak.
    expect(rows.find((r) => r.number === 'INV-OTHER')).toBeUndefined();
  });

  it('GET /portal/quotes returns ONLY the caller customers quotes', async () => {
    setActiveMockState(makePortalState());
    const res = await handler(get('/portal/quotes', PORTAL_CALLER));
    const { status, json } = await readJsonStatus(res);
    expect(status).toBe(200);
    const rows = (json.data ?? []) as Array<{ number: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.number).toBe('Q-001');
  });

  it('GET /portal/projects returns ONLY the caller customers projects', async () => {
    setActiveMockState(makePortalState());
    const res = await handler(get('/portal/projects', PORTAL_CALLER));
    const { status, json } = await readJsonStatus(res);
    expect(status).toBe(200);
    const rows = (json.data ?? []) as Array<{ name: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe('Spring Campaign');
  });

  it('Pattern B: staff role gets 404 on /portal/me (existence hidden)', async () => {
    setActiveMockState(makePortalState());
    const res = await handler(get('/portal/me', STAFF_CALLER));
    const { status, json } = await readJsonStatus(res);
    expect(status).toBe(404);
    expect(json.error?.code).toBe('NOT_FOUND');
  });

  it('Pattern B: staff role gets 404 on /portal/invoices', async () => {
    setActiveMockState(makePortalState());
    const res = await handler(get('/portal/invoices', STAFF_CALLER));
    const { status } = await readJsonStatus(res);
    expect(status).toBe(404);
  });

  it('Pattern B: staff role gets 404 on /portal/quotes', async () => {
    setActiveMockState(makePortalState());
    const res = await handler(get('/portal/quotes', STAFF_CALLER));
    const { status } = await readJsonStatus(res);
    expect(status).toBe(404);
  });

  it('Pattern B: staff role gets 404 on /portal/projects', async () => {
    setActiveMockState(makePortalState());
    const res = await handler(get('/portal/projects', STAFF_CALLER));
    const { status } = await readJsonStatus(res);
    expect(status).toBe(404);
  });

  // ---------------------------------------------------------------------
  // F-Wave9-PORTAL-NO-ACTION-WIRING-01: detail endpoints back the
  // Download PDF action. Lock down ownership scoping and the Pattern B
  // 404-on-cross-customer rule.
  // ---------------------------------------------------------------------
  it('GET /portal/invoices/:id returns the invoice when caller owns it', async () => {
    setActiveMockState(makePortalState());
    const res = await handler(
      get('/portal/invoices/inv-a1', PORTAL_CALLER),
    );
    const { status, json } = await readJsonStatus(res);
    expect(status).toBe(200);
    const body = json.data as {
      invoice: { invoice_number: string };
      line_items: Array<{ description: string }>;
      customer_display_name: string;
    };
    expect(body.invoice.invoice_number).toBe('INV-001');
    expect(body.line_items).toHaveLength(1);
    expect(body.customer_display_name).toBe('Acme Co.');
  });

  it('GET /portal/invoices/:id returns 404 for another customer s invoice', async () => {
    setActiveMockState(makePortalState());
    const res = await handler(
      get('/portal/invoices/inv-b1', PORTAL_CALLER),
    );
    const { status, json } = await readJsonStatus(res);
    expect(status).toBe(404);
    expect(json.error?.code).toBe('NOT_FOUND');
  });

  it('GET /portal/invoices/:id returns 404 for staff role (Pattern B)', async () => {
    setActiveMockState(makePortalState());
    const res = await handler(
      get('/portal/invoices/inv-a1', STAFF_CALLER),
    );
    const { status } = await readJsonStatus(res);
    expect(status).toBe(404);
  });

  it('GET /portal/quotes/:id returns the quote when caller owns it', async () => {
    setActiveMockState(makePortalState());
    const res = await handler(get('/portal/quotes/q-a1', PORTAL_CALLER));
    const { status, json } = await readJsonStatus(res);
    expect(status).toBe(200);
    const body = json.data as {
      quote: { number: string };
      line_items: Array<{ name: string }>;
      customer_display_name: string;
    };
    expect(body.quote.number).toBe('Q-001');
    expect(body.line_items).toHaveLength(1);
    expect(body.customer_display_name).toBe('Acme Co.');
  });

  it('GET /portal/quotes/:id returns 404 for another customer s quote', async () => {
    setActiveMockState(makePortalState());
    const res = await handler(get('/portal/quotes/q-b1', PORTAL_CALLER));
    const { status } = await readJsonStatus(res);
    expect(status).toBe(404);
  });

  it('GET /portal/quotes/:id returns 404 for staff role (Pattern B)', async () => {
    setActiveMockState(makePortalState());
    const res = await handler(get('/portal/quotes/q-a1', STAFF_CALLER));
    const { status } = await readJsonStatus(res);
    expect(status).toBe(404);
  });
});
