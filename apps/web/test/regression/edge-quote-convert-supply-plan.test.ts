// Regression suite for Wave 13 / R-W13-3PL-02: quote -> project conversion must
// auto-create a DRAFT Supply Plan linked to the new project, seeded from the
// project materials (the project_line_items the conversion RPC copied) and the
// org default warehouse.
//
// PART B (handler behaviour, exercised through the real quotes-api handler under
//   the Supabase mock):
//   1. A successful conversion mints exactly one draft supply_plans row linked
//      to the returned project, with the org default warehouse.
//   2. One supply_plan_lines row per material (project_line_item with an
//      item_id); descriptive free-text lines (item_id null) are skipped.
//   3. The plan create is idempotent: when a plan already exists for the
//      project, the conversion does NOT mint a second one.
//   4. No org default warehouse -> the plan is still created with a null
//      warehouse_id (operator routes it later).
//   5. The plan / line inserts never hand-write audit_log (the 0096 trigger
//      handles audit). No audit_log insert is emitted by the handler.
//
// PART A (chain wiring, locked at the migration level since no DB harness runs
//   the RPCs): post_job_run_daily_log emits production_consumed / produced
//   movements, and approve_billing_review drafts a spine invoice with one line
//   per active account service definition.

import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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
import { invalidateFlagCache } from '../../../../supabase/functions/_shared/feature-flags.ts';

const ORG_A = '00000000-0000-4000-8000-0000000000a1';
const USER_A = '00000000-0000-4000-8000-0000000000b1';
const OWNER = { userId: USER_A, orgId: ORG_A, role: 'org_owner' as const };

const QUOTE_ID = '00000000-0000-4000-8000-0000000000d1';
const PROJECT_ID = '00000000-0000-4000-8000-0000000000e1';
const WAREHOUSE_ID = '00000000-0000-4000-8000-0000000000f1';
const ITEM_1 = '00000000-0000-4000-8000-000000001001';
const ITEM_2 = '00000000-0000-4000-8000-000000001002';

function idemHeaders(): Record<string, string> {
  return {
    authorization: bearer(OWNER),
    'content-type': 'application/json',
    'idempotency-key': crypto.randomUUID(),
  };
}

interface ConvertStateOpts {
  withDefaultWarehouse?: boolean;
  lineItems?: Array<Record<string, unknown>>;
  existingSupplyPlans?: Array<Record<string, unknown>>;
}

function makeConvertState(opts: ConvertStateOpts = {}): MockState {
  const lineItems = opts.lineItems ?? [
    { org_id: ORG_A, project_id: PROJECT_ID, item_id: ITEM_1, quantity: 5, position: 0 },
    { org_id: ORG_A, project_id: PROJECT_ID, item_id: ITEM_2, quantity: 12, position: 1 },
  ];
  const warehouses = opts.withDefaultWarehouse === false
    ? []
    : [{ id: WAREHOUSE_ID, org_id: ORG_A, is_default: true }];
  const state = makeState({
    org_feature_flags: [
      { org_id: ORG_A, flag_key: 'plugins.three_pl', is_enabled: true, config: {} },
    ],
    warehouses,
    project_line_items: lineItems,
    supply_plans: opts.existingSupplyPlans ?? [],
    supply_plan_lines: [],
  });
  // The conversion RPC returns the new project id; next_doc_number mints SUP-.
  state.rpcResults['convert_quote_to_project'] = { data: PROJECT_ID, error: null };
  state.rpcResults['next_doc_number'] = { data: 'SUP-0001', error: null };
  return state;
}

function convertRequest(): Request {
  return new Request(
    `https://example.test/quotes/${QUOTE_ID}/convert-to-project`,
    { method: 'POST', headers: idemHeaders(), body: JSON.stringify({}) },
  );
}

async function readJsonStatus(res: Response): Promise<{
  status: number;
  json: { data?: { project_id?: string }; error?: { code?: string } };
}> {
  const t = await res.text();
  return { status: res.status, json: JSON.parse(t) };
}

describe('quotes-api convert-to-project: auto draft Supply Plan (R-W13-3PL-02)', () => {
  let handler: (req: Request) => Promise<Response> | Response;

  beforeAll(async () => {
    installDenoShim();
    resetCapturedHandler();
    await import('../../../../supabase/functions/quotes-api/index.ts');
    handler = capturedHandler();
  });

  afterEach(() => {
    clearActiveMockState();
    invalidateFlagCache(ORG_A);
  });

  it('mints one draft supply plan linked to the project and default warehouse', async () => {
    const state = makeConvertState();
    setActiveMockState(state);

    const res = await handler(convertRequest());
    const { status, json } = await readJsonStatus(res);
    expect(status).toBe(201);
    expect(json.data?.project_id).toBe(PROJECT_ID);

    const planInserts = state.inserts.filter((i) => i.table === 'supply_plans');
    expect(planInserts).toHaveLength(1);
    expect(planInserts[0].row).toMatchObject({
      org_id: ORG_A,
      project_id: PROJECT_ID,
      warehouse_id: WAREHOUSE_ID,
      status: 'draft',
      plan_number: 'SUP-0001',
      created_by: USER_A,
    });
  });

  it('creates one supply_plan_line per material in position order', async () => {
    const state = makeConvertState();
    setActiveMockState(state);

    await handler(convertRequest());

    const lineInserts = state.inserts.filter((i) => i.table === 'supply_plan_lines');
    expect(lineInserts).toHaveLength(2);
    expect(lineInserts[0].row).toMatchObject({
      org_id: ORG_A, item_id: ITEM_1, required_qty: 5, resolution: 'reserve', position: 0,
    });
    expect(lineInserts[1].row).toMatchObject({
      org_id: ORG_A, item_id: ITEM_2, required_qty: 12, resolution: 'reserve', position: 1,
    });
    // Each plan line carries a supply_plan_id key (the handler reads the new
    // plan id from the insert .select('id').single() result and threads it).
    for (const li of lineInserts) {
      expect(li.row).toHaveProperty('supply_plan_id');
    }
  });

  it('skips descriptive line items that have no item_id', async () => {
    const state = makeConvertState({
      lineItems: [
        { org_id: ORG_A, project_id: PROJECT_ID, item_id: ITEM_1, quantity: 3, position: 0 },
        { org_id: ORG_A, project_id: PROJECT_ID, item_id: null, quantity: 1, position: 1 },
      ],
    });
    setActiveMockState(state);

    await handler(convertRequest());

    const lineInserts = state.inserts.filter((i) => i.table === 'supply_plan_lines');
    expect(lineInserts).toHaveLength(1);
    expect(lineInserts[0].row).toMatchObject({ item_id: ITEM_1, required_qty: 3 });
  });

  it('is idempotent: does not mint a second plan when one already exists', async () => {
    const state = makeConvertState({
      existingSupplyPlans: [
        {
          id: '00000000-0000-4000-8000-0000000009a1',
          org_id: ORG_A, project_id: PROJECT_ID, status: 'draft', deleted_at: null,
        },
      ],
    });
    setActiveMockState(state);

    const res = await handler(convertRequest());
    expect(res.status).toBe(201);

    const planInserts = state.inserts.filter((i) => i.table === 'supply_plans');
    expect(planInserts).toHaveLength(0);
    const lineInserts = state.inserts.filter((i) => i.table === 'supply_plan_lines');
    expect(lineInserts).toHaveLength(0);
  });

  it('creates the plan with a null warehouse when no org default exists', async () => {
    const state = makeConvertState({ withDefaultWarehouse: false });
    setActiveMockState(state);

    const res = await handler(convertRequest());
    expect(res.status).toBe(201);

    const planInserts = state.inserts.filter((i) => i.table === 'supply_plans');
    expect(planInserts).toHaveLength(1);
    expect(planInserts[0].row).toMatchObject({ project_id: PROJECT_ID, warehouse_id: null });
  });

  it('never hand-writes audit_log (the 0096 trigger owns audit)', async () => {
    const state = makeConvertState();
    setActiveMockState(state);

    await handler(convertRequest());

    const auditInserts = state.inserts.filter((i) => i.table === 'audit_log');
    expect(auditInserts).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// PART A: chain wiring, locked at the migration level (no DB harness runs the
// RPCs). Asserts the posted daily log emits stock movements and the billing
// review approve drafts a spine invoice line per active account rate.
// ---------------------------------------------------------------------------

const MIG_DIR = join(
  __dirname, '..', '..', '..', '..', 'supabase', 'migrations',
);

const dailyLogSql = readFileSync(
  join(MIG_DIR, '0099_job_run_daily_logs.sql'), 'utf8',
);
const billingSql = readFileSync(
  join(MIG_DIR, '0102_billing_reviews.sql'), 'utf8',
);

function rpcBody(sql: string, name: string): string {
  const m = sql.match(
    new RegExp(`create or replace function public\\.${name}[\\s\\S]*?\\$\\$;`),
  );
  expect(m).toBeTruthy();
  return m![0];
}

describe('3PL chain wiring: posted daily log emits movements (PART A)', () => {
  const body = rpcBody(dailyLogSql, 'post_job_run_daily_log');

  it('emits production_consumed movements for consumed lines', () => {
    expect(body).toMatch(/insert into public\.stock_movements[\s\S]*?'production_consumed'[\s\S]*?from public\.job_run_daily_log_consumed_line_items/i);
  });

  it('emits production_produced movements for produced lines with an item_id', () => {
    expect(body).toMatch(/insert into public\.stock_movements[\s\S]*?'production_produced'[\s\S]*?from public\.job_run_daily_log_produced_line_items/i);
    // Produced lines without an item_id are descriptive-only and skipped.
    expect(body).toMatch(/li\.item_id is not null/i);
  });

  it('only emits movements when the run has a warehouse', () => {
    expect(body).toMatch(/if v_warehouse_id is not null then/i);
  });

  it('moves the log draft -> posted and is idempotent on an already-posted log', () => {
    expect(body).toMatch(/set status = 'posted'/i);
    expect(body).toMatch(/if v_status = 'posted' then\s*return p_log_id;/i);
  });
});

describe('3PL chain wiring: billing review approve drafts a spine invoice (PART A)', () => {
  const body = rpcBody(billingSql, 'approve_billing_review');

  it('inserts a draft spine invoice', () => {
    expect(body).toMatch(/insert into public\.invoices[\s\S]*?'draft'/i);
  });

  it('drafts one invoice line per active account service definition', () => {
    expect(body).toMatch(/insert into public\.invoice_line_items[\s\S]*?from public\.account_service_definitions asd/i);
    // Active = effective window open at now() (null bounds open-ended).
    expect(body).toMatch(/asd\.effective_from is null or asd\.effective_from <= now\(\)/i);
    expect(body).toMatch(/asd\.effective_to\s+is null or asd\.effective_to\s+>= now\(\)/i);
  });

  it('recomputes the invoice totals via the authoritative helper', () => {
    expect(body).toMatch(/perform public\.recompute_invoice_totals\(v_invoice_id\)/i);
  });

  it('moves the review draft -> approved and links the invoice', () => {
    expect(body).toMatch(/set status = 'approved'/i);
    expect(body).toMatch(/invoice_id = v_invoice_id/i);
  });
});
