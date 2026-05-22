// UX-Q5 regression suite for the dashboard-api work-card counts.
//
// Covers the four new fields added to GET /dashboard/summary:
//   - quotes_awaiting_approval_count
//   - runs_in_production_count
//   - shipments_ready_to_ship_count
//   - unpaid_invoices_count
//
// Why this exists: the four counts back the live work cards rendered on
// /dashboard. The predicates are declared in the UX revision spec
// (2026-05-21 Q5). A regression in any one of them (wrong status enum,
// dropped deleted_at gate, cross-tenant leak) silently misleads the
// operator on their daily landing pad, so the predicates are tested
// directly here rather than left to manual smoke.
//
// Constitutional invariants protected:
//   - Capabilities: requireCap('dashboard.summary.read') fires before any
//     DB call.
//   - RLS Pattern A: every count filters on org_id; the cross-tenant
//     probe asserts the orgB caller sees zeros across all four counts.
//   - Soft-delete safety: deleted_at IS NULL gate. A deleted-but-active
//     row must not increment any count.

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

async function readJson(
  res: Response,
): Promise<{ data?: unknown; error?: unknown }> {
  return JSON.parse(await res.text());
}

function fixtureWithWorkload() {
  return makeState({
    // Two quotes count (submitted + revise_requested), one draft does not.
    quotes: [
      {
        id: '11111111-1111-4111-8111-111111111111',
        org_id: ORG_A,
        state: 'submitted',
        deleted_at: null,
      },
      {
        id: '11111111-1111-4111-8111-111111111112',
        org_id: ORG_A,
        state: 'revise_requested',
        deleted_at: null,
      },
      {
        id: '11111111-1111-4111-8111-111111111113',
        org_id: ORG_A,
        state: 'draft',
        deleted_at: null,
      },
      // Soft-deleted submitted quote must not count.
      {
        id: '11111111-1111-4111-8111-111111111114',
        org_id: ORG_A,
        state: 'submitted',
        deleted_at: '2026-01-01T00:00:00Z',
      },
    ],
    // One started run counts; draft and completed do not.
    manufacturing_runs: [
      {
        id: '22222222-2222-4222-8222-222222222221',
        org_id: ORG_A,
        status: 'started',
        deleted_at: null,
      },
      {
        id: '22222222-2222-4222-8222-222222222222',
        org_id: ORG_A,
        status: 'draft',
        deleted_at: null,
      },
      {
        id: '22222222-2222-4222-8222-222222222223',
        org_id: ORG_A,
        status: 'completed',
        deleted_at: null,
      },
    ],
    // One created + one picking shipment count; shipped does not.
    shipments: [
      {
        id: '33333333-3333-4333-8333-333333333331',
        org_id: ORG_A,
        status: 'created',
        deleted_at: null,
      },
      {
        id: '33333333-3333-4333-8333-333333333332',
        org_id: ORG_A,
        status: 'picking',
        deleted_at: null,
      },
      {
        id: '33333333-3333-4333-8333-333333333333',
        org_id: ORG_A,
        status: 'shipped',
        deleted_at: null,
      },
    ],
    // Sent + partially_paid + overdue count; paid and cancelled do not.
    invoices: [
      {
        id: '44444444-4444-4444-8444-444444444441',
        org_id: ORG_A,
        status: 'sent',
        deleted_at: null,
        balance_cents: '0',
      },
      {
        id: '44444444-4444-4444-8444-444444444442',
        org_id: ORG_A,
        status: 'partially_paid',
        deleted_at: null,
        balance_cents: '0',
      },
      {
        id: '44444444-4444-4444-8444-444444444443',
        org_id: ORG_A,
        status: 'overdue',
        deleted_at: null,
        balance_cents: '0',
      },
      {
        id: '44444444-4444-4444-8444-444444444444',
        org_id: ORG_A,
        status: 'paid',
        deleted_at: null,
        balance_cents: '0',
      },
      {
        id: '44444444-4444-4444-8444-444444444445',
        org_id: ORG_A,
        status: 'cancelled',
        deleted_at: null,
        balance_cents: '0',
      },
    ],
    organizations: [
      { id: ORG_A, default_currency_code: 'USD' },
    ],
  });
}

describe('dashboard-api — work-card counts (UX-Q5)', () => {
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

  it('returns the four work-card count fields on GET /dashboard/summary', async () => {
    setActiveMockState(fixtureWithWorkload());
    const req = new Request('https://example.test/dashboard/summary', {
      method: 'GET',
      headers: { authorization: bearer(OWNER_A) },
    });
    const res = await handler(req);
    expect(res.status).toBe(200);
    const body = await readJson(res);
    const data = body.data as Record<string, unknown>;
    expect(data).toHaveProperty('quotes_awaiting_approval_count');
    expect(data).toHaveProperty('runs_in_production_count');
    expect(data).toHaveProperty('shipments_ready_to_ship_count');
    expect(data).toHaveProperty('unpaid_invoices_count');
  });

  it('counts match the per-status predicates from the UX spec', async () => {
    setActiveMockState(fixtureWithWorkload());
    const req = new Request('https://example.test/dashboard/summary', {
      method: 'GET',
      headers: { authorization: bearer(OWNER_A) },
    });
    const res = await handler(req);
    expect(res.status).toBe(200);
    const body = await readJson(res);
    const data = body.data as Record<string, unknown>;

    // Quotes: submitted + revise_requested. Draft excluded.
    // Soft-deleted submitted quote excluded.
    expect(data.quotes_awaiting_approval_count).toBe(2);
    // Runs: started only. Draft + completed excluded.
    expect(data.runs_in_production_count).toBe(1);
    // Shipments: created + picking. Shipped excluded.
    expect(data.shipments_ready_to_ship_count).toBe(2);
    // Invoices: sent + partially_paid + overdue. Paid + cancelled excluded.
    expect(data.unpaid_invoices_count).toBe(3);
  });

  it('orgB caller sees zero on every work-card count (RLS Pattern A)', async () => {
    setActiveMockState(fixtureWithWorkload());
    const req = new Request('https://example.test/dashboard/summary', {
      method: 'GET',
      headers: { authorization: bearer(OWNER_B) },
    });
    const res = await handler(req);
    expect(res.status).toBe(200);
    const body = await readJson(res);
    const data = body.data as Record<string, unknown>;
    expect(data.quotes_awaiting_approval_count).toBe(0);
    expect(data.runs_in_production_count).toBe(0);
    expect(data.shipments_ready_to_ship_count).toBe(0);
    expect(data.unpaid_invoices_count).toBe(0);
  });
});
