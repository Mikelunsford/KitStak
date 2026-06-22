// Regression suite for the Section Dashboard read endpoints (Section
// Dashboards, Phase 1): GET /dashboard/sell-summary and
// /dashboard/money-summary in the dashboard-api bundle.
//
// Constitutional invariants protected:
//   - Money: BIGINT cents on the wire (string), integer arithmetic, no float
//     drift in AR aging, pipeline value, payments, or credit-note rollups.
//   - RLS Pattern A: every read scopes to org_id; the cross-tenant probe
//     asserts orgB sees zeros and empty lists even when orgA has data.

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

const CUST_1 = '00000000-0000-4000-8000-0000000000c1';
const CUST_2 = '00000000-0000-4000-8000-0000000000c2';

async function readJson(
  res: Response,
): Promise<{ data?: unknown; error?: unknown }> {
  return JSON.parse(await res.text());
}

/** A YYYY-MM-DD date `days` in the past (negative for the future), UTC. */
function dateOffsetDays(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/** A full ISO timestamp `days` in the past (negative for the future), UTC. */
function tsOffsetDays(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString();
}

const ITEM_A = '00000000-0000-4000-8000-0000000000d1';
const ITEM_B = '00000000-0000-4000-8000-0000000000d2';
const ITEM_C = '00000000-0000-4000-8000-0000000000d3';
const ITEM_D = '00000000-0000-4000-8000-0000000000d4';

function sellFixture() {
  return makeState({
    opportunities: [
      { org_id: ORG_A, stage: 'discovery', amount_cents: 100000, deleted_at: null },
      { org_id: ORG_A, stage: 'proposal', amount_cents: 200000, deleted_at: null },
      { org_id: ORG_A, stage: 'negotiation', amount_cents: 300000, deleted_at: null },
      { org_id: ORG_A, stage: 'closed_won', amount_cents: 400000, deleted_at: null },
      { org_id: ORG_A, stage: 'closed_won', amount_cents: 500000, deleted_at: null },
      { org_id: ORG_A, stage: 'closed_lost', amount_cents: 600000, deleted_at: null },
    ],
    quotes: [
      { id: 'q1', org_id: ORG_A, number: 'QUO-1', customer_id: CUST_1, state: 'submitted', total_cents: 11000, created_at: '2026-01-01T00:00:00Z', deleted_at: null },
      { id: 'q2', org_id: ORG_A, number: 'QUO-2', customer_id: CUST_2, state: 'revise_requested', total_cents: 22000, created_at: '2026-01-02T00:00:00Z', deleted_at: null },
      { id: 'q3', org_id: ORG_A, number: 'QUO-3', customer_id: CUST_1, state: 'draft', total_cents: 33000, created_at: '2026-01-03T00:00:00Z', deleted_at: null },
      { id: 'q4', org_id: ORG_A, number: 'QUO-4', customer_id: CUST_2, state: 'approved', total_cents: 44000, created_at: '2026-01-04T00:00:00Z', deleted_at: null },
    ],
    projects: [
      { org_id: ORG_A, state: 'pending', deleted_at: null },
      { org_id: ORG_A, state: 'in_production', deleted_at: null },
      { org_id: ORG_A, state: 'completed', deleted_at: null },
    ],
    customers: [
      { id: CUST_1, org_id: ORG_A, display_name: 'Acme Foods' },
      { id: CUST_2, org_id: ORG_A, display_name: 'Northwind' },
    ],
    organizations: [{ id: ORG_A, default_currency_code: 'USD' }],
  });
}

function moneyFixture() {
  return makeState({
    invoices: [
      { id: 'i1', org_id: ORG_A, invoice_number: 'INV-1', customer_id: CUST_1, status: 'sent', due_date: dateOffsetDays(-10), balance_cents: 10000, deleted_at: null },
      { id: 'i2', org_id: ORG_A, invoice_number: 'INV-2', customer_id: CUST_2, status: 'overdue', due_date: dateOffsetDays(15), balance_cents: 20000, deleted_at: null },
      { id: 'i3', org_id: ORG_A, invoice_number: 'INV-3', customer_id: CUST_1, status: 'partially_paid', due_date: dateOffsetDays(45), balance_cents: 30000, deleted_at: null },
      { id: 'i4', org_id: ORG_A, invoice_number: 'INV-4', customer_id: CUST_2, status: 'overdue', due_date: dateOffsetDays(75), balance_cents: 40000, deleted_at: null },
      { id: 'i5', org_id: ORG_A, invoice_number: 'INV-5', customer_id: CUST_1, status: 'overdue', due_date: dateOffsetDays(120), balance_cents: 50000, deleted_at: null },
      { id: 'i6', org_id: ORG_A, invoice_number: 'INV-6', customer_id: CUST_2, status: 'sent', due_date: dateOffsetDays(5), balance_cents: 0, deleted_at: null },
    ],
    payments: [
      { org_id: ORG_A, amount_cents: 5000, received_at: new Date().toISOString(), deleted_at: null },
      { org_id: ORG_A, amount_cents: 9999, received_at: '2000-01-01T00:00:00Z', deleted_at: null },
    ],
    credit_notes: [
      { org_id: ORG_A, status: 'issued', amount_cents: 8000, applied_cents: 3000, deleted_at: null },
      { org_id: ORG_A, status: 'issued', amount_cents: 2000, applied_cents: 2000, deleted_at: null },
    ],
    customers: [
      { id: CUST_1, org_id: ORG_A, display_name: 'Acme Foods' },
      { id: CUST_2, org_id: ORG_A, display_name: 'Northwind' },
    ],
    organizations: [{ id: ORG_A, default_currency_code: 'USD' }],
  });
}

function inventoryFixture() {
  return makeState({
    stock_levels: [
      { org_id: ORG_A, item_id: ITEM_A, quantity_on_hand: 5, quantity_available: 3 },
      { org_id: ORG_A, item_id: ITEM_B, quantity_on_hand: 0, quantity_available: 0 },
      { org_id: ORG_A, item_id: ITEM_C, quantity_on_hand: 100, quantity_available: 100 },
    ],
    items: [
      { id: ITEM_A, org_id: ORG_A, sku: 'SKU-A', name: 'Item A', reorder_point: 10, deleted_at: null },
      { id: ITEM_B, org_id: ORG_A, sku: 'SKU-B', name: 'Item B', reorder_point: 5, deleted_at: null },
      { id: ITEM_C, org_id: ORG_A, sku: 'SKU-C', name: 'Item C', reorder_point: 10, deleted_at: null },
      { id: ITEM_D, org_id: ORG_A, sku: 'SKU-D', name: 'Item D', reorder_point: null, deleted_at: null },
    ],
    receiving_orders: [
      { id: 'r1', org_id: ORG_A, receiving_number: 'RO-1', status: 'created', expected_date: dateOffsetDays(2), deleted_at: null },
      { id: 'r2', org_id: ORG_A, receiving_number: 'RO-2', status: 'in_progress', expected_date: dateOffsetDays(5), deleted_at: null },
      { id: 'r3', org_id: ORG_A, receiving_number: 'RO-3', status: 'received', expected_date: dateOffsetDays(1), deleted_at: null },
    ],
    shipments: [
      { id: 's1', org_id: ORG_A, status: 'created', deleted_at: null },
      { id: 's2', org_id: ORG_A, status: 'picking', deleted_at: null },
      { id: 's3', org_id: ORG_A, status: 'shipped', deleted_at: null },
    ],
    bin_stock_levels: [
      { org_id: ORG_A, location_id: 'L1', quantity_on_hand: 5 },
      { org_id: ORG_A, location_id: 'L2', quantity_on_hand: 0 },
      { org_id: ORG_A, location_id: 'L3', quantity_on_hand: 2 },
    ],
  });
}

function productionFixture() {
  const past = tsOffsetDays(1);
  const future = tsOffsetDays(-1);
  return makeState({
    manufacturing_runs: [
      { id: 'm1', org_id: ORG_A, run_number: 'MR-1', status: 'started', planned_complete_at: future, deleted_at: null },
      { id: 'm2', org_id: ORG_A, run_number: 'MR-2', status: 'started', planned_complete_at: past, deleted_at: null },
      { id: 'm3', org_id: ORG_A, run_number: 'MR-3', status: 'draft', planned_complete_at: past, deleted_at: null },
      { id: 'm4', org_id: ORG_A, run_number: 'MR-4', status: 'completed', planned_complete_at: past, deleted_at: null },
    ],
    kitting_jobs: [
      { id: 'k1', org_id: ORG_A, status: 'started', planned_complete_at: past, deleted_at: null },
      { id: 'k2', org_id: ORG_A, status: 'started', planned_complete_at: future, deleted_at: null },
      { id: 'k3', org_id: ORG_A, status: 'completed', planned_complete_at: past, deleted_at: null },
    ],
    sales_orders: [
      { id: 'o1', org_id: ORG_A, order_number: 'SO-1', status: 'confirmed', customer_id: CUST_1, ordered_at: '2026-01-01T00:00:00Z', deleted_at: null },
      { id: 'o2', org_id: ORG_A, order_number: 'SO-2', status: 'picking', customer_id: CUST_2, ordered_at: '2026-01-02T00:00:00Z', deleted_at: null },
      { id: 'o3', org_id: ORG_A, order_number: 'SO-3', status: 'packed', customer_id: CUST_1, ordered_at: '2026-01-03T00:00:00Z', deleted_at: null },
      { id: 'o4', org_id: ORG_A, order_number: 'SO-4', status: 'draft', customer_id: CUST_1, ordered_at: '2026-01-04T00:00:00Z', deleted_at: null },
      { id: 'o5', org_id: ORG_A, order_number: 'SO-5', status: 'shipped', customer_id: CUST_1, ordered_at: '2026-01-05T00:00:00Z', deleted_at: null },
    ],
    job_runs: [
      { id: 'j1', org_id: ORG_A, run_number: 'JR-1', status: 'planned', started_at: null, deleted_at: null },
      { id: 'j2', org_id: ORG_A, run_number: 'JR-2', status: 'in_progress', started_at: '2026-01-01T00:00:00Z', deleted_at: null },
      { id: 'j3', org_id: ORG_A, run_number: 'JR-3', status: 'completed', started_at: '2026-01-01T00:00:00Z', deleted_at: null },
    ],
    customers: [
      { id: CUST_1, org_id: ORG_A, display_name: 'Acme Foods' },
      { id: CUST_2, org_id: ORG_A, display_name: 'Northwind' },
    ],
    organizations: [{ id: ORG_A, default_currency_code: 'USD' }],
  });
}

describe('dashboard-api section summaries (Section Dashboards)', () => {
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

  async function getSummary(path: string, caller = OWNER_A) {
    const req = new Request(`https://example.test${path}`, {
      method: 'GET',
      headers: { authorization: bearer(caller) },
    });
    const res = await handler(req);
    const body = await readJson(res);
    return { res, data: body.data as Record<string, unknown> };
  }

  it('sell-summary computes opportunity KPIs, pipeline by stage, and win rate', async () => {
    setActiveMockState(sellFixture());
    const { res, data } = await getSummary('/dashboard/sell-summary');
    expect(res.status).toBe(200);
    const kpis = data.kpis as Record<string, unknown>;
    expect(kpis.open_opportunities_count).toBe(3);
    expect(kpis.pipeline_value_cents).toBe('600000');
    expect(kpis.quotes_awaiting_approval_count).toBe(2);
    expect(kpis.active_projects_count).toBe(2);
    // 2 won of 3 decided = 66.7%
    expect(kpis.win_rate_pct).toBe(66.7);

    expect(data.pipeline_by_stage).toEqual([
      { stage: 'discovery', count: 1, value_cents: '100000' },
      { stage: 'proposal', count: 1, value_cents: '200000' },
      { stage: 'negotiation', count: 1, value_cents: '300000' },
    ]);
  });

  it('sell-summary lists quotes needing action with resolved customer names', async () => {
    setActiveMockState(sellFixture());
    const { data } = await getSummary('/dashboard/sell-summary');
    const quotes = data.quotes_needing_action as Array<Record<string, unknown>>;
    // draft + submitted + revise_requested = 3; approved excluded.
    expect(quotes).toHaveLength(3);
    const numbers = quotes.map((q) => q.number);
    expect(numbers).toContain('QUO-1');
    expect(numbers).toContain('QUO-2');
    expect(numbers).toContain('QUO-3');
    expect(numbers).not.toContain('QUO-4');
    const q1 = quotes.find((q) => q.number === 'QUO-1');
    expect(q1?.customer_name).toBe('Acme Foods');
  });

  it('sell-summary returns zeros and empty lists for a cross-tenant caller (RLS Pattern A)', async () => {
    setActiveMockState(sellFixture());
    const { data } = await getSummary('/dashboard/sell-summary', OWNER_B);
    const kpis = data.kpis as Record<string, unknown>;
    expect(kpis.open_opportunities_count).toBe(0);
    expect(kpis.pipeline_value_cents).toBe('0');
    expect(kpis.win_rate_pct).toBe(0);
    expect(data.pipeline_by_stage).toEqual([]);
    expect(data.quotes_needing_action).toEqual([]);
  });

  it('money-summary computes AR balance and aging buckets by days past due', async () => {
    setActiveMockState(moneyFixture());
    const { res, data } = await getSummary('/dashboard/money-summary');
    expect(res.status).toBe(200);
    const kpis = data.kpis as Record<string, unknown>;
    // zero-balance invoice excluded; 10k+20k+30k+40k+50k = 150k.
    expect(kpis.ar_balance_cents).toBe('150000');
    expect(kpis.unpaid_invoices_count).toBe(5);

    const aging = data.ar_aging as Record<string, unknown>;
    expect(aging.current_cents).toBe('10000');
    expect(aging.d1_30_cents).toBe('20000');
    expect(aging.d31_60_cents).toBe('30000');
    expect(aging.d61_90_cents).toBe('40000');
    expect(aging.d90_plus_cents).toBe('50000');
  });

  it('money-summary sums only this-month payments and unapplied issued credit notes', async () => {
    setActiveMockState(moneyFixture());
    const { data } = await getSummary('/dashboard/money-summary');
    const kpis = data.kpis as Record<string, unknown>;
    // 5000 this month; the 9999 from 2000 is excluded.
    expect(kpis.payments_this_month_cents).toBe('5000');
    // 8000-3000 outstanding on the first issued note; the fully-applied one drops.
    expect(kpis.credit_notes_outstanding_cents).toBe('5000');
    expect(kpis.credit_notes_outstanding_count).toBe(1);
  });

  it('money-summary lists the oldest unpaid invoices first with resolved names', async () => {
    setActiveMockState(moneyFixture());
    const { data } = await getSummary('/dashboard/money-summary');
    const list = data.unpaid_invoices as Array<Record<string, unknown>>;
    expect(list).toHaveLength(5);
    // Oldest due date first: INV-5 (120d past) leads, INV-1 (future) trails.
    expect(list[0].number).toBe('INV-5');
    expect(list[4].number).toBe('INV-1');
    expect(list[0].customer_name).toBe('Acme Foods');
  });

  it('money-summary returns zeros and empty lists for a cross-tenant caller (RLS Pattern A)', async () => {
    setActiveMockState(moneyFixture());
    const { data } = await getSummary('/dashboard/money-summary', OWNER_B);
    const kpis = data.kpis as Record<string, unknown>;
    expect(kpis.ar_balance_cents).toBe('0');
    expect(kpis.unpaid_invoices_count).toBe(0);
    expect(kpis.payments_this_month_cents).toBe('0');
    expect(kpis.credit_notes_outstanding_cents).toBe('0');
    expect(data.unpaid_invoices).toEqual([]);
  });

  it('inventory-summary computes below-reorder, stocked SKUs, flow counts, and bins', async () => {
    setActiveMockState(inventoryFixture());
    const { res, data } = await getSummary('/dashboard/inventory-summary');
    expect(res.status).toBe(200);
    const kpis = data.kpis as Record<string, unknown>;
    expect(kpis.below_reorder_count).toBe(2);
    expect(kpis.stocked_skus_count).toBe(2);
    expect(kpis.inbound_receiving_count).toBe(2);
    expect(kpis.outbound_shipments_count).toBe(2);
    expect(kpis.occupied_bins_count).toBe(2);
    const below = data.below_reorder as Array<Record<string, unknown>>;
    expect(below).toHaveLength(2);
    // Largest shortfall first: Item A (3 of 10) leads Item B (0 of 5).
    expect(below[0].sku).toBe('SKU-A');
  });

  it('inventory-summary returns zeros and empty lists for a cross-tenant caller (RLS Pattern A)', async () => {
    setActiveMockState(inventoryFixture());
    const { data } = await getSummary('/dashboard/inventory-summary', OWNER_B);
    const kpis = data.kpis as Record<string, unknown>;
    expect(kpis.below_reorder_count).toBe(0);
    expect(kpis.stocked_skus_count).toBe(0);
    expect(kpis.inbound_receiving_count).toBe(0);
    expect(kpis.occupied_bins_count).toBe(0);
    expect(data.below_reorder).toEqual([]);
    expect(data.inbound_receiving).toEqual([]);
  });

  it('production-summary computes KPIs across add-ons and folds late jobs', async () => {
    setActiveMockState(productionFixture());
    const { res, data } = await getSummary('/dashboard/production-summary');
    expect(res.status).toBe(200);
    const kpis = data.kpis as Record<string, unknown>;
    expect(kpis.runs_in_production_count).toBe(2);
    expect(kpis.kitting_in_progress_count).toBe(2);
    expect(kpis.orders_to_fulfill_count).toBe(3);
    // 2 manufacturing (m2, m3) + 1 kitting (k1) past their planned date.
    expect(kpis.late_jobs_count).toBe(3);
    expect(data.manufacturing_runs).toHaveLength(3);
    expect(data.sales_orders).toHaveLength(3);
    expect(data.job_runs).toHaveLength(2);
    const orders = data.sales_orders as Array<Record<string, unknown>>;
    const o1 = orders.find((o) => o.number === 'SO-1');
    expect(o1?.customer_name).toBe('Acme Foods');
  });

  it('production-summary returns zeros and empty lists for a cross-tenant caller (RLS Pattern A)', async () => {
    setActiveMockState(productionFixture());
    const { data } = await getSummary('/dashboard/production-summary', OWNER_B);
    const kpis = data.kpis as Record<string, unknown>;
    expect(kpis.runs_in_production_count).toBe(0);
    expect(kpis.orders_to_fulfill_count).toBe(0);
    expect(kpis.late_jobs_count).toBe(0);
    expect(data.manufacturing_runs).toEqual([]);
    expect(data.sales_orders).toEqual([]);
    expect(data.job_runs).toEqual([]);
  });
});
