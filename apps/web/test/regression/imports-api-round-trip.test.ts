// Regression suite for the imports-api CSV commit round-trip (R-W13-COPACK-01).
//
// The CHANGELOG (0.15.0 Notes) flagged the import RowSchemas as declaring
// column names that do not match the destination tables (number vs
// invoice_number / expense_number, email / phone vs primary_email /
// primary_phone, unit_of_measure vs the units FK), so the import round-trip was
// broken for several entities. This suite proves the fix:
//
//   1. Round-trip works per fixed entity: a friendly-header CSV row commits and
//      the inserted row lands under the REAL destination-table column names.
//   2. The mass-assignment guard (F/MASSG-IMPORTS-01) stays intact: an
//      arbitrary CSV column (created_by, id, status, anything undeclared) is
//      stripped and never reaches the insert. Only allowlisted columns plus the
//      server-set org_id / created_by / updated_by are written.
//
// Constitutional invariants protected:
//   * Capabilities: commit calls requireCap('imports.job.commit'); the owner
//     caller holds it, so a clean commit proves the cap gate passed.
//   * Idempotency: the commit runs inside respondWithIdempotency (Idempotency-
//     Key header required); a missing key would 400 before any insert.
//   * Allowlist insert: the inserted row keys are exactly the schema-declared
//     columns plus org_id / created_by / updated_by.

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

const ORG_A = '00000000-0000-4000-8000-0000000000a1';
const USER_A = '00000000-0000-4000-8000-0000000000b1';
const OWNER = { userId: USER_A, orgId: ORG_A, role: 'org_owner' as const };

const CUSTOMER_ID = '00000000-0000-4000-8000-0000000000c1';
const VENDOR_ID = '00000000-0000-4000-8000-0000000000d1';

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

async function commit(
  handler: (req: Request) => Promise<Response> | Response,
  entity: string,
  rows: Array<Record<string, unknown>>,
): Promise<Response> {
  const req = new Request(`https://example.test/imports/${entity}/commit`, {
    method: 'POST',
    headers: idemHeaders(),
    body: JSON.stringify({ entity_type: entity, rows }),
  });
  return handler(req);
}

function insertedRows(
  state: MockState,
  table: string,
): Array<Record<string, unknown>> {
  return state.inserts.filter((r) => r.table === table).map((r) => r.row);
}

// Columns the server always sets; an inserted row may carry these in addition
// to the allowlisted CSV columns.
const SERVER_COLUMNS = ['org_id', 'created_by', 'updated_by'];

describe('imports-api CSV commit round-trip and allowlist', () => {
  let handler: (req: Request) => Promise<Response> | Response;

  beforeAll(async () => {
    installDenoShim();
    resetCapturedHandler();
    await import('../../../../supabase/functions/imports-api/index.ts');
    handler = capturedHandler();
  });

  afterEach(() => {
    clearActiveMockState();
  });

  // -------------------------------------------------------------------------
  // customer: friendly email / phone map to primary_email / primary_phone.
  // -------------------------------------------------------------------------

  it('customer commit maps email/phone to primary_email/primary_phone', async () => {
    const state = makeState({ customers: [] });
    setActiveMockState(state);
    const res = await commit(handler, 'customer', [
      { display_name: 'Acme', email: 'billing@acme.test', phone: '555-0100' },
    ]);
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.data).toMatchObject({ inserted: 1, errors: [] });

    const rows = insertedRows(state, 'customers');
    expect(rows).toHaveLength(1);
    const row = rows[0] as Record<string, unknown>;
    expect(row.display_name).toBe('Acme');
    expect(row.primary_email).toBe('billing@acme.test');
    expect(row.primary_phone).toBe('555-0100');
    // friendly aliases must not survive onto the insert
    expect(row).not.toHaveProperty('email');
    expect(row).not.toHaveProperty('phone');
  });

  // -------------------------------------------------------------------------
  // item: sku + name + the free-text unit_of_measure label persist. UOM is a
  // real column (migrations 0031 + 0115); it is distinct from the unit_id FK,
  // which is only set when the `unit` FK-by-name column is supplied.
  // -------------------------------------------------------------------------

  it('item commit writes sku + name + unit_of_measure and leaves unit_id unset', async () => {
    const state = makeState({ items: [] });
    setActiveMockState(state);
    const res = await commit(handler, 'item', [
      { sku: 'SKU-1', name: 'Widget', unit_of_measure: 'each' },
    ]);
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.data).toMatchObject({ inserted: 1, errors: [] });

    const rows = insertedRows(state, 'items');
    expect(rows).toHaveLength(1);
    const row = rows[0] as Record<string, unknown>;
    expect(row.sku).toBe('SKU-1');
    expect(row.name).toBe('Widget');
    // unit_of_measure is now a real free-text column and persists.
    expect(row.unit_of_measure).toBe('each');
    // unit_id is the FK, set only via the `unit` resolver column (not supplied).
    expect(row).not.toHaveProperty('unit_id');
  });

  // -------------------------------------------------------------------------
  // vendor: email / phone are the real columns (no alias needed).
  // -------------------------------------------------------------------------

  it('vendor commit writes display_name + email + phone', async () => {
    const state = makeState({ vendors: [] });
    setActiveMockState(state);
    const res = await commit(handler, 'vendor', [
      { display_name: 'Supplier Co', email: 'ap@supplier.test', phone: '555-0200' },
    ]);
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.data).toMatchObject({ inserted: 1, errors: [] });

    const rows = insertedRows(state, 'vendors');
    expect(rows).toHaveLength(1);
    const row = rows[0] as Record<string, unknown>;
    expect(row.display_name).toBe('Supplier Co');
    expect(row.email).toBe('ap@supplier.test');
    expect(row.phone).toBe('555-0200');
  });

  // -------------------------------------------------------------------------
  // invoice: friendly number maps to invoice_number; cents coerce from string.
  // -------------------------------------------------------------------------

  it('invoice commit maps number to invoice_number and coerces cents', async () => {
    const state = makeState({
      invoices: [],
      // the FK existence check must find the customer in the org
      customers: [{ id: CUSTOMER_ID, org_id: ORG_A, deleted_at: null }],
    });
    setActiveMockState(state);
    const res = await commit(handler, 'invoice', [
      {
        number: 'INV-1',
        customer_id: CUSTOMER_ID,
        total_cents: '12500', // CSV cells arrive as strings
        currency_code: 'USD',
      },
    ]);
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.data).toMatchObject({ inserted: 1, errors: [] });

    const rows = insertedRows(state, 'invoices');
    expect(rows).toHaveLength(1);
    const row = rows[0] as Record<string, unknown>;
    expect(row.invoice_number).toBe('INV-1');
    expect(row.customer_id).toBe(CUSTOMER_ID);
    expect(row.total_cents).toBe(12500); // integer cents, not a float or string
    expect(row.currency_code).toBe('USD');
    expect(row).not.toHaveProperty('number');
  });

  // -------------------------------------------------------------------------
  // expense: friendly number maps to expense_number; cents coerce from string.
  // -------------------------------------------------------------------------

  it('expense commit maps number to expense_number and coerces cents', async () => {
    const state = makeState({
      expenses: [],
      vendors: [{ id: VENDOR_ID, org_id: ORG_A, deleted_at: null }],
    });
    setActiveMockState(state);
    const res = await commit(handler, 'expense', [
      {
        number: 'EXP-1',
        vendor_id: VENDOR_ID,
        amount_cents: '4200',
        currency_code: 'USD',
      },
    ]);
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.data).toMatchObject({ inserted: 1, errors: [] });

    const rows = insertedRows(state, 'expenses');
    expect(rows).toHaveLength(1);
    const row = rows[0] as Record<string, unknown>;
    expect(row.expense_number).toBe('EXP-1');
    expect(row.vendor_id).toBe(VENDOR_ID);
    expect(row.amount_cents).toBe(4200);
    expect(row.currency_code).toBe('USD');
    expect(row).not.toHaveProperty('number');
  });

  // -------------------------------------------------------------------------
  // Mass-assignment guard (F/MASSG-IMPORTS-01): arbitrary CSV columns are
  // stripped. Only the allowlisted schema columns plus the server-set
  // org_id / created_by / updated_by reach the insert. A client-supplied
  // created_by / id / status must NOT override the server values.
  // -------------------------------------------------------------------------

  it('strips arbitrary CSV columns and ignores client-supplied audit fields', async () => {
    const state = makeState({ customers: [] });
    setActiveMockState(state);
    const attackerUserId = '00000000-0000-4000-8000-00000000dead';
    const res = await commit(handler, 'customer', [
      {
        display_name: 'Mallory',
        email: 'm@evil.test',
        // none of these may reach the insert as client-controlled values:
        // id / status / is_admin are undeclared, and the org/audit columns are
        // server-set so the attacker's values must not override them.
        id: '00000000-0000-4000-8000-00000000beef',
        org_id: '00000000-0000-4000-8000-00000000face',
        created_by: attackerUserId,
        updated_by: attackerUserId,
        status: 'active',
        is_admin: true,
      },
    ]);
    expect(res.status).toBe(200);

    const rows = insertedRows(state, 'customers');
    expect(rows).toHaveLength(1);
    const row = rows[0] as Record<string, unknown>;

    // the insert key set is exactly: allowlisted schema columns + server
    // columns. The customer allowlist is broader now, but undeclared fields
    // still cannot ride in.
    const allowed = new Set([
      'display_name',
      'primary_email',
      'primary_phone',
      'kind',
      'tax_id',
      'default_currency_code',
      'default_payment_terms_days',
      'billing_address',
      'shipping_address',
      'tags',
      ...SERVER_COLUMNS,
    ]);
    for (const key of Object.keys(row)) {
      expect(allowed.has(key)).toBe(true);
    }

    // server columns are server-set, never the attacker's values
    expect(row.org_id).toBe(ORG_A);
    expect(row.created_by).toBe(USER_A);
    expect(row.updated_by).toBe(USER_A);

    // undeclared columns are gone
    expect(row).not.toHaveProperty('id');
    expect(row).not.toHaveProperty('status');
    expect(row).not.toHaveProperty('is_admin');
  });

  // -------------------------------------------------------------------------
  // item FK-by-name: category / unit / tax resolve against the org's lookup
  // tables by name OR code, mapping to the *_id columns; the name columns are
  // stripped from the insert.
  // -------------------------------------------------------------------------

  const CAT_ID = '00000000-0000-4000-8000-0000000000e1';
  const UNIT_ID = '00000000-0000-4000-8000-0000000000e2';
  const TAX_ID = '00000000-0000-4000-8000-0000000000e3';

  function itemLookupState(): MockState {
    return makeState({
      items: [],
      item_categories: [{ id: CAT_ID, org_id: ORG_A, code: 'HW', name: 'Hardware', deleted_at: null }],
      units: [{ id: UNIT_ID, org_id: ORG_A, code: 'EA', label: 'Each', deleted_at: null }],
      taxes: [{ id: TAX_ID, org_id: ORG_A, code: 'STD', name: 'Standard Rate', deleted_at: null }],
    });
  }

  it('item commit resolves category/unit/tax by name or code to the *_id columns', async () => {
    const state = itemLookupState();
    setActiveMockState(state);
    const res = await commit(handler, 'item', [
      // category by name, unit by code, tax by name
      { sku: 'SKU-2', name: 'Bolt', category: 'Hardware', unit: 'EA', tax: 'Standard Rate' },
    ]);
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.data).toMatchObject({ inserted: 1, errors: [] });

    const row = insertedRows(state, 'items')[0] as Record<string, unknown>;
    expect(row.category_id).toBe(CAT_ID);
    expect(row.unit_id).toBe(UNIT_ID);
    expect(row.default_tax_id).toBe(TAX_ID);
    // the name columns must not survive onto the insert
    expect(row).not.toHaveProperty('category');
    expect(row).not.toHaveProperty('unit');
    expect(row).not.toHaveProperty('tax');
  });

  it('item commit errors per row and inserts nothing when a lookup name is not found', async () => {
    const state = itemLookupState();
    setActiveMockState(state);
    const res = await commit(handler, 'item', [
      { sku: 'SKU-3', name: 'Nut', category: 'Nonexistent' },
    ]);
    expect(res.status).toBe(200);
    const body = (await readJson(res)).data as { inserted: number; errors: Array<{ field: string | null; message: string }> };
    expect(body.inserted).toBe(0);
    expect(insertedRows(state, 'items')).toHaveLength(0);
    expect(body.errors).toEqual([
      expect.objectContaining({ field: 'category', message: expect.stringContaining('not found') }),
    ]);
  });

  it('item commit errors per row when a lookup name is ambiguous', async () => {
    const state = makeState({
      items: [],
      item_categories: [
        { id: CAT_ID, org_id: ORG_A, code: 'A', name: 'Dup', deleted_at: null },
        { id: '00000000-0000-4000-8000-0000000000e9', org_id: ORG_A, code: 'B', name: 'Dup', deleted_at: null },
      ],
    });
    setActiveMockState(state);
    const res = await commit(handler, 'item', [
      { sku: 'SKU-4', name: 'Washer', category: 'Dup' },
    ]);
    expect(res.status).toBe(200);
    const body = (await readJson(res)).data as { inserted: number; errors: Array<{ field: string | null; message: string }> };
    expect(body.inserted).toBe(0);
    expect(body.errors).toEqual([
      expect.objectContaining({ field: 'category', message: expect.stringContaining('ambiguous') }),
    ]);
  });

  // -------------------------------------------------------------------------
  // customer: flat address cells assemble into the *_address jsonb columns,
  // tags split on ';' into a text[], and kind defaults to 'company'.
  // -------------------------------------------------------------------------

  it('customer commit assembles addresses, splits tags, and defaults kind', async () => {
    const state = makeState({ customers: [] });
    setActiveMockState(state);
    const res = await commit(handler, 'customer', [
      {
        display_name: 'Acme',
        billing_line1: '1 A St',
        billing_city: 'Austin',
        billing_country: 'US',
        tags: 'wholesale;net30',
      },
    ]);
    expect(res.status).toBe(200);
    const row = insertedRows(state, 'customers')[0] as Record<string, unknown>;
    expect(row.billing_address).toEqual({ line1: '1 A St', city: 'Austin', country: 'US' });
    expect(row.tags).toEqual(['wholesale', 'net30']);
    expect(row.kind).toBe('company');
    // flat address cells must not survive as columns
    expect(row).not.toHaveProperty('billing_line1');
    expect(row).not.toHaveProperty('billing_city');
  });

  // -------------------------------------------------------------------------
  // item: boolean flags parse from common CSV spellings.
  // -------------------------------------------------------------------------

  it('item commit parses boolean flags from CSV spellings', async () => {
    const state = makeState({ items: [] });
    setActiveMockState(state);
    const res = await commit(handler, 'item', [
      { sku: 'SKU-5', name: 'Screw', is_active: 'true', is_sellable: 'no', is_taxable: '1' },
    ]);
    expect(res.status).toBe(200);
    const row = insertedRows(state, 'items')[0] as Record<string, unknown>;
    expect(row.is_active).toBe(true);
    expect(row.is_sellable).toBe(false);
    expect(row.is_taxable).toBe(true);
  });

  // -------------------------------------------------------------------------
  // commit is idempotency-gated: a missing Idempotency-Key is rejected before
  // any insert (no row written).
  // -------------------------------------------------------------------------

  it('rejects a commit with no Idempotency-Key and writes nothing', async () => {
    const state = makeState({ customers: [] });
    setActiveMockState(state);
    const req = new Request('https://example.test/imports/customer/commit', {
      method: 'POST',
      headers: { authorization: bearer(OWNER), 'content-type': 'application/json' },
      body: JSON.stringify({
        entity_type: 'customer',
        rows: [{ display_name: 'NoKey' }],
      }),
    });
    const res = await handler(req);
    expect(res.status).toBe(400);
    expect(insertedRows(state, 'customers')).toHaveLength(0);
  });
});
