// BNEW-6: regression suite for the dashboard-api inventory_value_cents
// KPI. The 2026-05-22 v2 smoke walk caught the KPI rendering $0.00 even
// though the operator had 500 units of SV2-RM on hand at $2.00/unit
// (= $1,000 expected). Root cause: items.unit_cost_cents was null on the
// catalog row because v1 operators capture the unit cost on the
// receiving line (receiving_order_line_items.unit_cost_cents), not on
// the catalog row. The rollup previously read only the catalog cost.
//
// Constitutional invariants protected:
//   - Money: BIGINT cents, integer arithmetic, no float drift.
//   - RLS Pattern A: every read scopes to org_id; the cross-tenant
//     probe asserts orgB sees 0 even when orgA has valued stock.
//   - Soft-delete safety: the catalog read does not exempt deleted_at,
//     but the receiving fallback uses the most recent non-null cost
//     per item, which means a deleted item with no live cost still
//     reports 0 (no false-positive valuation).

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
const ORG_B = '00000000-0000-4000-8000-0000000000a2';
const USER_A = '00000000-0000-4000-8000-0000000000b1';
const OWNER_A = { userId: USER_A, orgId: ORG_A, role: 'org_owner' as const };
const OWNER_B = { userId: USER_A, orgId: ORG_B, role: 'org_owner' as const };

const ITEM_A = '7fcfd43b-4121-4c3e-af6d-42ead2f08c82';
const ITEM_B = 'dca9da05-8aca-4d5c-9525-d5da987f57ce';
const WH_A = '11111111-1111-4111-8111-111111111111';

async function readJson(
  res: Response,
): Promise<{ data?: unknown; error?: unknown }> {
  return JSON.parse(await res.text());
}

function fixtureWithReceivingFallback() {
  // Mirrors the SV2-RM operator state from the smoke walk:
  // 500 units on hand, catalog unit_cost_cents=null, receiving line
  // recorded $2.00/unit ($1,000 expected total).
  return makeState({
    stock_levels: [
      {
        org_id: ORG_A,
        warehouse_id: WH_A,
        item_id: ITEM_A,
        quantity_on_hand: 500,
      },
    ],
    items: [
      {
        id: ITEM_A,
        org_id: ORG_A,
        sku: 'SV2-RM',
        name: 'Smoke V2 Raw Material',
        unit_cost_cents: null,
        deleted_at: null,
      },
    ],
    receiving_order_line_items: [
      {
        id: 'rli-1',
        org_id: ORG_A,
        item_id: ITEM_A,
        quantity: 500,
        unit_cost_cents: 200,
        created_at: '2026-05-22T10:00:00Z',
      },
    ],
    organizations: [{ id: ORG_A, default_currency_code: 'USD' }],
    invoices: [],
    projects: [],
  });
}

function fixtureWithCatalogCost() {
  // Same item id, but cost lives on the catalog row, not on a
  // receiving line. The KPI must still reflect $1,000.
  return makeState({
    stock_levels: [
      {
        org_id: ORG_A,
        warehouse_id: WH_A,
        item_id: ITEM_A,
        quantity_on_hand: 500,
      },
    ],
    items: [
      {
        id: ITEM_A,
        org_id: ORG_A,
        sku: 'SV2-RM',
        name: 'Smoke V2 Raw Material',
        unit_cost_cents: 200,
        deleted_at: null,
      },
    ],
    receiving_order_line_items: [],
    organizations: [{ id: ORG_A, default_currency_code: 'USD' }],
    invoices: [],
    projects: [],
  });
}

function fixtureWithBoth() {
  // Catalog cost is set ($3.00), receiving line is also set ($2.00).
  // Catalog wins (it's the authoritative cost per the constitution).
  return makeState({
    stock_levels: [
      {
        org_id: ORG_A,
        warehouse_id: WH_A,
        item_id: ITEM_A,
        quantity_on_hand: 500,
      },
    ],
    items: [
      {
        id: ITEM_A,
        org_id: ORG_A,
        sku: 'SV2-RM',
        name: 'Smoke V2 Raw Material',
        unit_cost_cents: 300,
        deleted_at: null,
      },
    ],
    receiving_order_line_items: [
      {
        id: 'rli-1',
        org_id: ORG_A,
        item_id: ITEM_A,
        quantity: 500,
        unit_cost_cents: 200,
        created_at: '2026-05-22T10:00:00Z',
      },
    ],
    organizations: [{ id: ORG_A, default_currency_code: 'USD' }],
    invoices: [],
    projects: [],
  });
}

function fixtureWithMultipleReceivingLines() {
  // Two receiving lines for the same item — the most recent cost wins.
  return makeState({
    stock_levels: [
      {
        org_id: ORG_A,
        warehouse_id: WH_A,
        item_id: ITEM_B,
        quantity_on_hand: 400,
      },
    ],
    items: [
      {
        id: ITEM_B,
        org_id: ORG_A,
        sku: 'SRM-001',
        unit_cost_cents: null,
        deleted_at: null,
      },
    ],
    receiving_order_line_items: [
      {
        id: 'rli-old',
        org_id: ORG_A,
        item_id: ITEM_B,
        quantity: 200,
        unit_cost_cents: 100,
        created_at: '2026-01-01T00:00:00Z',
      },
      {
        id: 'rli-new',
        org_id: ORG_A,
        item_id: ITEM_B,
        quantity: 200,
        unit_cost_cents: 500,
        created_at: '2026-05-22T10:00:00Z',
      },
    ],
    organizations: [{ id: ORG_A, default_currency_code: 'USD' }],
    invoices: [],
    projects: [],
  });
}

describe('dashboard-api inventory_value_cents (BNEW-6)', () => {
  let handler: (req: Request) => Promise<Response> | Response;

  beforeAll(async () => {
    installDenoShim();
    resetCapturedHandler();
    await import('../../../../supabase/functions/dashboard-api/index.ts');
    handler = capturedHandler();
  });

  afterEach(() => {
    clearActiveMockState();
  });

  it('falls back to the most recent receiving cost when items.unit_cost_cents is null', async () => {
    setActiveMockState(fixtureWithReceivingFallback());
    const req = new Request('https://example.test/kitcost/summary', {
      method: 'GET',
      headers: { authorization: bearer(OWNER_A) },
    });
    const res = await handler(req);
    expect(res.status).toBe(200);
    const body = await readJson(res);
    const data = body.data as Record<string, unknown>;
    const kpis = data.kpis as Record<string, unknown>;
    // 500 units × 200 cents = 100_000 cents ($1,000)
    expect(kpis.inventory_value_cents).toBe('100000');
  });

  it('uses the catalog cost when items.unit_cost_cents is set', async () => {
    setActiveMockState(fixtureWithCatalogCost());
    const req = new Request('https://example.test/kitcost/summary', {
      method: 'GET',
      headers: { authorization: bearer(OWNER_A) },
    });
    const res = await handler(req);
    const body = await readJson(res);
    const data = body.data as Record<string, unknown>;
    const kpis = data.kpis as Record<string, unknown>;
    // 500 × 200 = 100_000 cents.
    expect(kpis.inventory_value_cents).toBe('100000');
  });

  it('prefers the catalog cost over the receiving fallback when both are set', async () => {
    setActiveMockState(fixtureWithBoth());
    const req = new Request('https://example.test/kitcost/summary', {
      method: 'GET',
      headers: { authorization: bearer(OWNER_A) },
    });
    const res = await handler(req);
    const body = await readJson(res);
    const data = body.data as Record<string, unknown>;
    const kpis = data.kpis as Record<string, unknown>;
    // Catalog cost wins: 500 × 300 = 150_000 cents.
    expect(kpis.inventory_value_cents).toBe('150000');
  });

  it('picks the most recent receiving line cost when multiple exist', async () => {
    setActiveMockState(fixtureWithMultipleReceivingLines());
    const req = new Request('https://example.test/kitcost/summary', {
      method: 'GET',
      headers: { authorization: bearer(OWNER_A) },
    });
    const res = await handler(req);
    const body = await readJson(res);
    const data = body.data as Record<string, unknown>;
    const kpis = data.kpis as Record<string, unknown>;
    // Latest receiving cost = 500 cents. 400 × 500 = 200_000 cents.
    expect(kpis.inventory_value_cents).toBe('200000');
  });

  it('orgB caller sees zero (RLS Pattern A)', async () => {
    setActiveMockState(fixtureWithReceivingFallback());
    const req = new Request('https://example.test/kitcost/summary', {
      method: 'GET',
      headers: { authorization: bearer(OWNER_B) },
    });
    const res = await handler(req);
    const body = await readJson(res);
    const data = body.data as Record<string, unknown>;
    const kpis = data.kpis as Record<string, unknown>;
    expect(kpis.inventory_value_cents).toBe('0');
  });
});
