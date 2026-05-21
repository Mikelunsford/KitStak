// Regression suite for Path C / C1 — KitCost dashboard endpoint inside the
// dashboard-api bundle (GET /kitcost/summary).
//
// Covers the two highest-signal classes of bug for a new read-only endpoint:
//   1. Top-level response shape: 200 + the four collections (kpis,
//      revenue_trend, top_customers, project_margins). Verifies the handler
//      wires every panel.
//   2. Cross-tenant RLS Pattern A: a caller from orgB seeing only orgA
//      fixtures gets empty collections, never orgA totals. The 4 collections
//      must reflect orgB scope; a 403 here would be a constitutional bug.
//
// Constitutional invariants protected:
//   * Capabilities: requireCap(caller, 'kitcost.dashboard.view') fires before
//     any DB call. Test 3 verifies a viewer (no cap) gets 403.
//   * RLS Pattern A: every aggregate filters on org_id; cross-tenant probe
//     returns the cross-tenant org's empty/own data, not orgA's totals.
//   * Money on the wire: BIGINT cents as strings. The schema validates.

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
const VIEWER_A = { userId: USER_A, orgId: ORG_A, role: 'viewer' as const };

const NOW = new Date().toISOString().slice(0, 10);

async function readJson(res: Response): Promise<{ data?: unknown; error?: unknown }> {
  return JSON.parse(await res.text());
}

function fixtureOrgA() {
  return makeState({
    invoices: [
      {
        id: '11111111-1111-4111-8111-111111111111',
        org_id: ORG_A,
        status: 'paid',
        customer_id: '22222222-2222-4222-8222-222222222222',
        project_id: null,
        total_cents: '125000',
        issue_date: NOW,
      },
    ],
    customers: [
      {
        id: '22222222-2222-4222-8222-222222222222',
        org_id: ORG_A,
        display_name: 'Acme Co',
      },
    ],
    projects: [],
    stock_levels: [],
    items: [],
    stock_movements: [],
  });
}

describe('dashboard-api — KitCost summary (Path C / C1)', () => {
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

  // -------------------------------------------------------------------------
  // Top-level shape: 200 + four panels
  // -------------------------------------------------------------------------

  it('GET /kitcost/summary returns 200 with kpis/trend/customers/margins shape', async () => {
    setActiveMockState(fixtureOrgA());
    const req = new Request('https://example.test/kitcost/summary', {
      method: 'GET',
      headers: { authorization: bearer(OWNER_A) },
    });
    const res = await handler(req);
    expect(res.status).toBe(200);
    const body = await readJson(res);
    const data = body.data as Record<string, unknown>;
    expect(data).toBeTruthy();
    expect(data.kpis).toBeTruthy();
    const kpis = data.kpis as Record<string, unknown>;
    expect(kpis).toHaveProperty('total_revenue_ytd_cents');
    expect(kpis).toHaveProperty('invoiced_this_month_cents');
    expect(kpis).toHaveProperty('active_projects_count');
    expect(kpis).toHaveProperty('inventory_value_cents');
    expect(Array.isArray(data.revenue_trend)).toBe(true);
    expect(Array.isArray(data.top_customers)).toBe(true);
    expect(Array.isArray(data.project_margins)).toBe(true);
    // Revenue trend always emits 12 buckets (oldest first).
    expect((data.revenue_trend as unknown[]).length).toBe(12);
  });

  // -------------------------------------------------------------------------
  // RLS Pattern A: cross-tenant caller sees only own data
  // -------------------------------------------------------------------------

  it('orgB caller sees empty collections when only orgA fixtures exist', async () => {
    setActiveMockState(fixtureOrgA());
    const req = new Request('https://example.test/kitcost/summary', {
      method: 'GET',
      headers: { authorization: bearer(OWNER_B) },
    });
    const res = await handler(req);
    expect(res.status).toBe(200);
    const body = await readJson(res);
    const data = body.data as Record<string, unknown>;
    const kpis = data.kpis as Record<string, unknown>;
    expect(kpis.total_revenue_ytd_cents).toBe('0');
    expect(kpis.invoiced_this_month_cents).toBe('0');
    expect(kpis.active_projects_count).toBe(0);
    expect(kpis.inventory_value_cents).toBe('0');
    expect(data.top_customers).toEqual([]);
    expect(data.project_margins).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // Capability gate: caller without kitcost.dashboard.view gets 403
  // -------------------------------------------------------------------------

  it('viewer (no kitcost.dashboard.view) gets 403 FORBIDDEN', async () => {
    setActiveMockState(fixtureOrgA());
    const req = new Request('https://example.test/kitcost/summary', {
      method: 'GET',
      headers: { authorization: bearer(VIEWER_A) },
    });
    const res = await handler(req);
    expect(res.status).toBe(403);
    const body = await readJson(res);
    expect((body.error as Record<string, unknown>).code).toBe('FORBIDDEN');
  });
});
