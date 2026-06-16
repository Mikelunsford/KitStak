// Regression suite for Wave 13 Phase 13.C handler-correctness items.
//
// R-W13-FIN-01 (status-equals-from guard on the remaining SELECT-then-UPDATE
//   state transitions): the invoicing-api invoice + credit-note transitions,
//   the ops-api receiving / production / shipment in-handler transitions, and
//   the manufacturing-api run transitions read the row status, then UPDATE off
//   that read. Without `.eq('status', from)` two concurrent transitions from
//   the same status both win their UPDATE and the second silently double-
//   applies (and re-fires emit triggers). This suite locks the compare-and-set:
//   two transitions from the same starting status yield one success (200) and
//   one STATE_CONFLICT (409). The loser path is modelled with the supabase
//   mock's `raceAdvanceStatusOnSelect` hook, which advances the stored row's
//   status right after the handler's SELECT so the follow-up UPDATE matches
//   0 rows, exactly as a concurrent commit landing between the read and the
//   write would.
//
// R-W13-DB-01 (multi-stage drop, stage 1: stop dual-writing the JSON line
//   mirror): the ops-api /receive and /ship action RPCs were still merging
//   body.lines into payload.lines on the terminal transition. The emit
//   triggers (migration 0051) read exclusively from the normalised
//   receiving_order_line_items / shipment_line_items tables, and the SPA
//   detail pages read lines via useReceivingOrderLineItems /
//   useShipmentLineItems. No reader depends on payload.lines, so the mirror
//   write is removed. This suite asserts the transition UPDATE no longer
//   carries a `payload` key, and that the line-items GET endpoints still
//   return the normalised rows after the dual-write stops. Production-run
//   payload.consumed / payload.produced is deliberately NOT dropped (the
//   production emit trigger still reads it); that is asserted to remain.
//
// Constitutional invariants protected:
//   * RLS: cross-tenant / missing ids 404 (org gate), never 403.
//   * Idempotency: every transition wraps respondWithIdempotency.
//   * State machine: STATE_CONFLICT 409 is the canonical FSM-violation /
//     compare-and-set envelope, matching three-pl / wms / finance.
//   * Append-only ledger: the production payload mirror that the emit trigger
//     reads is preserved so movements still emit exactly once.

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
import { invalidateFlagCache } from '../../../../supabase/functions/_shared/feature-flags.ts';

const ORG_A = '00000000-0000-4000-8000-0000000000a1';
const USER_A = '00000000-0000-4000-8000-0000000000b1';
const OWNER = { userId: USER_A, orgId: ORG_A, role: 'org_owner' as const };

const RO_ID = '00000000-0000-4000-8000-0000000000e1';
const PR_ID = '00000000-0000-4000-8000-0000000000e2';
const SH_ID = '00000000-0000-4000-8000-0000000000e3';
const MR_ID = '00000000-0000-4000-8000-0000000000e4';
const INV_ID = '00000000-0000-4000-8000-0000000000e5';
const CN_ID = '00000000-0000-4000-8000-0000000000e6';
const WAREHOUSE_ID = '00000000-0000-4000-8000-0000000000c1';
const ITEM_ID = '00000000-0000-4000-8000-0000000000d1';
const LINE_ID = '00000000-0000-4000-8000-0000000000f1';

const ISO = '2026-06-15T00:00:00.000Z';

function idemHeaders(): Record<string, string> {
  return {
    authorization: bearer(OWNER),
    'content-type': 'application/json',
    'idempotency-key': crypto.randomUUID(),
  };
}

async function readJson(res: Response): Promise<{ data?: unknown; error?: { code?: string } }> {
  return JSON.parse(await res.text());
}

function threePlFlag(): Array<Record<string, unknown>> {
  return [{ org_id: ORG_A, flag_key: 'plugins.three_pl', is_enabled: true, config: {} }];
}

function manufacturingFlag(): Array<Record<string, unknown>> {
  return [{ org_id: ORG_A, flag_key: 'plugins.manufacturing', is_enabled: true, config: {} }];
}

function receivingRow(status: string): Record<string, unknown> {
  return {
    id: RO_ID,
    org_id: ORG_A,
    receiving_number: 'RO-2026-00001',
    purchase_order_id: null,
    warehouse_id: WAREHOUSE_ID,
    vendor_id: null,
    project_id: null,
    dock_location_id: null,
    status,
    expected_date: null,
    received_date: null,
    reference: null,
    notes: null,
    payload: {},
    created_at: ISO,
    updated_at: ISO,
    deleted_at: null,
  };
}

function productionRow(status: string): Record<string, unknown> {
  return {
    id: PR_ID,
    org_id: ORG_A,
    run_number: 'PR-2026-00001',
    warehouse_id: WAREHOUSE_ID,
    output_item_id: ITEM_ID,
    status,
    quantity_planned: 10,
    quantity_produced: 0,
    scheduled_for: null,
    started_at: null,
    completed_at: null,
    notes: null,
    payload: {},
    created_at: ISO,
    updated_at: ISO,
    deleted_at: null,
  };
}

function shipmentRow(status: string): Record<string, unknown> {
  return {
    id: SH_ID,
    org_id: ORG_A,
    shipment_number: 'SH-2026-00001',
    customer_id: null,
    sales_order_id: null,
    project_id: null,
    warehouse_id: WAREHOUSE_ID,
    status,
    ship_date: null,
    carrier: null,
    tracking_number: null,
    notes: null,
    payload: {},
    created_at: ISO,
    updated_at: ISO,
    deleted_at: null,
  };
}

function manufacturingRow(status: string): Record<string, unknown> {
  return {
    id: MR_ID,
    org_id: ORG_A,
    run_number: 'MFG-2026-00001',
    status,
    warehouse_id: null,
    project_id: null,
    planned_start_at: null,
    planned_complete_at: null,
    started_at: null,
    completed_at: null,
    cancelled_at: null,
    notes: null,
    payload: {},
    created_at: ISO,
    updated_at: ISO,
    deleted_at: null,
  };
}

// Each bundle's Deno.serve handler is captured exactly once. The module cache
// means a bundle imported a second time does not re-run Deno.serve, so all
// three handlers are captured up-front into dedicated variables rather than
// re-imported per describe (which would clear the captured handler).
let opsHandler: (req: Request) => Promise<Response> | Response;
let manufacturingHandler: (req: Request) => Promise<Response> | Response;
let invoicingHandler: (req: Request) => Promise<Response> | Response;

beforeAll(async () => {
  installDenoShim();
  resetCapturedHandler();
  await import('../../../../supabase/functions/ops-api/index.ts');
  opsHandler = capturedHandler();
  resetCapturedHandler();
  await import('../../../../supabase/functions/manufacturing-api/index.ts');
  manufacturingHandler = capturedHandler();
  resetCapturedHandler();
  await import('../../../../supabase/functions/invoicing-api/index.ts');
  invoicingHandler = capturedHandler();
});

afterEach(() => {
  clearActiveMockState();
  invalidateFlagCache(ORG_A);
});

// -----------------------------------------------------------------------------
// ops-api: receiving + production + shipment transitions
// -----------------------------------------------------------------------------
describe('ops-api transitions: status-equals-from guard (R-W13-FIN-01)', () => {
  const handler = (req: Request) => opsHandler(req);

  it('receiving /transition created -> in_progress succeeds (200) and the UPDATE carries .eq(status, created)', async () => {
    const state = makeState({
      org_feature_flags: threePlFlag(),
      receiving_orders: [receivingRow('created')],
    });
    setActiveMockState(state);

    const req = new Request(`https://example.test/receiving-orders/${RO_ID}/transition`, {
      method: 'POST',
      headers: idemHeaders(),
      body: JSON.stringify({ to: 'in_progress' }),
    });
    const res = await handler(req);
    expect(res.status).toBe(200);

    const update = state.updates.find((u) => u.table === 'receiving_orders');
    expect(update).toBeDefined();
    // The compare-and-set predicate must be present in the WHERE clause.
    expect(update!.filters).toEqual(
      expect.arrayContaining([{ col: 'status', val: 'created' }]),
    );
  });

  it('receiving /transition loses the compare-and-set -> 409 STATE_CONFLICT when the row was concurrently advanced', async () => {
    const state: MockState = makeState({
      org_feature_flags: threePlFlag(),
      receiving_orders: [receivingRow('created')],
    });
    // A concurrent transition advances the stored row to in_progress right
    // after this request's SELECT, so the follow-up UPDATE matches 0 rows.
    state.raceAdvanceStatusOnSelect = { receiving_orders: 'in_progress' };
    setActiveMockState(state);

    const req = new Request(`https://example.test/receiving-orders/${RO_ID}/transition`, {
      method: 'POST',
      headers: idemHeaders(),
      body: JSON.stringify({ to: 'in_progress' }),
    });
    const res = await handler(req);
    expect(res.status).toBe(409);
    const body = await readJson(res);
    expect(body.error?.code).toBe('STATE_CONFLICT');
  });

  it('production /complete in_progress -> completed succeeds (200) and the UPDATE carries .eq(status, in_progress)', async () => {
    const state = makeState({
      org_feature_flags: threePlFlag(),
      production_runs: [productionRow('in_progress')],
    });
    setActiveMockState(state);

    const req = new Request(`https://example.test/production-runs/${PR_ID}/complete`, {
      method: 'POST',
      headers: idemHeaders(),
      body: JSON.stringify({ quantity_produced: 5, consumed: [] }),
    });
    const res = await handler(req);
    expect(res.status).toBe(200);

    const update = state.updates.find((u) => u.table === 'production_runs');
    expect(update).toBeDefined();
    expect(update!.filters).toEqual(
      expect.arrayContaining([{ col: 'status', val: 'in_progress' }]),
    );
  });

  it('production /complete loses the compare-and-set -> 409 STATE_CONFLICT', async () => {
    const state: MockState = makeState({
      org_feature_flags: threePlFlag(),
      production_runs: [productionRow('in_progress')],
    });
    state.raceAdvanceStatusOnSelect = { production_runs: 'completed' };
    setActiveMockState(state);

    const req = new Request(`https://example.test/production-runs/${PR_ID}/complete`, {
      method: 'POST',
      headers: idemHeaders(),
      body: JSON.stringify({ quantity_produced: 5, consumed: [] }),
    });
    const res = await handler(req);
    expect(res.status).toBe(409);
    const body = await readJson(res);
    expect(body.error?.code).toBe('STATE_CONFLICT');
  });

  it('shipment /transition created -> picking succeeds (200) and the UPDATE carries .eq(status, created)', async () => {
    const state = makeState({
      org_feature_flags: threePlFlag(),
      shipments: [shipmentRow('created')],
    });
    setActiveMockState(state);

    const req = new Request(`https://example.test/shipments/${SH_ID}/transition`, {
      method: 'POST',
      headers: idemHeaders(),
      body: JSON.stringify({ to: 'picking' }),
    });
    const res = await handler(req);
    expect(res.status).toBe(200);

    const update = state.updates.find((u) => u.table === 'shipments');
    expect(update).toBeDefined();
    expect(update!.filters).toEqual(
      expect.arrayContaining([{ col: 'status', val: 'created' }]),
    );
  });

  it('shipment /transition loses the compare-and-set -> 409 STATE_CONFLICT', async () => {
    const state: MockState = makeState({
      org_feature_flags: threePlFlag(),
      shipments: [shipmentRow('created')],
    });
    state.raceAdvanceStatusOnSelect = { shipments: 'picking' };
    setActiveMockState(state);

    const req = new Request(`https://example.test/shipments/${SH_ID}/transition`, {
      method: 'POST',
      headers: idemHeaders(),
      body: JSON.stringify({ to: 'picking' }),
    });
    const res = await handler(req);
    expect(res.status).toBe(409);
    const body = await readJson(res);
    expect(body.error?.code).toBe('STATE_CONFLICT');
  });
});

// -----------------------------------------------------------------------------
// ops-api: R-W13-DB-01 stop dual-writing payload.lines on /receive + /ship
// -----------------------------------------------------------------------------
describe('ops-api line mirror: stop dual-writing payload.lines (R-W13-DB-01)', () => {
  const handler = (req: Request) => opsHandler(req);

  it('/receive transition no longer writes a payload mirror into the UPDATE patch', async () => {
    const state = makeState({
      org_feature_flags: threePlFlag(),
      receiving_orders: [receivingRow('in_progress')],
    });
    setActiveMockState(state);

    const req = new Request(`https://example.test/receiving-orders/${RO_ID}/receive`, {
      method: 'POST',
      headers: idemHeaders(),
      body: JSON.stringify({
        lines: [{ item_id: ITEM_ID, quantity: 3, unit_cost_cents: 100 }],
      }),
    });
    const res = await handler(req);
    expect(res.status).toBe(200);

    const update = state.updates.find(
      (u) => u.table === 'receiving_orders' && u.patch.status === 'received',
    );
    expect(update).toBeDefined();
    // The body.lines mirror must NOT land in payload anymore.
    expect(update!.patch).not.toHaveProperty('payload');
  });

  it('/ship transition no longer writes a payload mirror into the UPDATE patch', async () => {
    const state = makeState({
      org_feature_flags: threePlFlag(),
      shipments: [shipmentRow('picking')],
    });
    setActiveMockState(state);

    const req = new Request(`https://example.test/shipments/${SH_ID}/ship`, {
      method: 'POST',
      headers: idemHeaders(),
      body: JSON.stringify({
        lines: [{ item_id: ITEM_ID, quantity: 2 }],
      }),
    });
    const res = await handler(req);
    expect(res.status).toBe(200);

    const update = state.updates.find(
      (u) => u.table === 'shipments' && u.patch.status === 'shipped',
    );
    expect(update).toBeDefined();
    expect(update!.patch).not.toHaveProperty('payload');
  });

  it('GET /receiving-orders/:id/line-items still returns rows from the normalised table', async () => {
    const state = makeState({
      org_feature_flags: threePlFlag(),
      receiving_orders: [receivingRow('received')],
      receiving_order_line_items: [
        {
          id: LINE_ID,
          org_id: ORG_A,
          receiving_order_id: RO_ID,
          item_id: ITEM_ID,
          quantity: 3,
          unit_cost_cents: 100,
          uom: null,
          reference: null,
          lot_id: null,
          position: 0,
          created_at: ISO,
          updated_at: ISO,
        },
      ],
    });
    setActiveMockState(state);

    const req = new Request(`https://example.test/receiving-orders/${RO_ID}/line-items`, {
      method: 'GET',
      headers: { authorization: bearer(OWNER) },
    });
    const res = await handler(req);
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(Array.isArray(body.data)).toBe(true);
    expect((body.data as Array<{ id: string }>)).toHaveLength(1);
    expect((body.data as Array<{ id: string }>)[0].id).toBe(LINE_ID);
  });

  it('GET /shipments/:id/line-items still returns rows from the normalised table', async () => {
    const state = makeState({
      org_feature_flags: threePlFlag(),
      shipments: [shipmentRow('shipped')],
      shipment_line_items: [
        {
          id: LINE_ID,
          org_id: ORG_A,
          shipment_id: SH_ID,
          item_id: ITEM_ID,
          quantity: 2,
          unit_cost_cents: null,
          uom: null,
          reference: null,
          position: 0,
          created_at: ISO,
          updated_at: ISO,
        },
      ],
    });
    setActiveMockState(state);

    const req = new Request(`https://example.test/shipments/${SH_ID}/line-items`, {
      method: 'GET',
      headers: { authorization: bearer(OWNER) },
    });
    const res = await handler(req);
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect((body.data as Array<{ id: string }>)).toHaveLength(1);
    expect((body.data as Array<{ id: string }>)[0].id).toBe(LINE_ID);
  });

  it('production /complete STILL writes payload.consumed/produced (emit trigger reader, NOT dropped)', async () => {
    const state = makeState({
      org_feature_flags: threePlFlag(),
      production_runs: [productionRow('in_progress')],
    });
    setActiveMockState(state);

    const req = new Request(`https://example.test/production-runs/${PR_ID}/complete`, {
      method: 'POST',
      headers: idemHeaders(),
      body: JSON.stringify({ quantity_produced: 5, consumed: [] }),
    });
    const res = await handler(req);
    expect(res.status).toBe(200);

    const update = state.updates.find(
      (u) => u.table === 'production_runs' && u.patch.status === 'completed',
    );
    expect(update).toBeDefined();
    // The emit trigger reads payload.consumed / payload.produced; the mirror
    // write must remain until production-run lines are normalised.
    expect(update!.patch).toHaveProperty('payload');
    const payload = update!.patch.payload as Record<string, unknown>;
    expect(payload).toHaveProperty('consumed');
    expect(payload).toHaveProperty('produced');
  });
});

// -----------------------------------------------------------------------------
// manufacturing-api: run transitions
// -----------------------------------------------------------------------------
describe('manufacturing-api transitions: status-equals-from guard (R-W13-FIN-01)', () => {
  const handler = (req: Request) => manufacturingHandler(req);

  it('/start draft -> started succeeds (200) and the UPDATE carries .eq(status, draft)', async () => {
    const state = makeState({
      org_feature_flags: manufacturingFlag(),
      manufacturing_runs: [manufacturingRow('draft')],
    });
    setActiveMockState(state);

    const req = new Request(`https://example.test/manufacturing-runs/${MR_ID}/start`, {
      method: 'POST',
      headers: idemHeaders(),
    });
    const res = await handler(req);
    expect(res.status).toBe(200);

    const update = state.updates.find((u) => u.table === 'manufacturing_runs');
    expect(update).toBeDefined();
    expect(update!.filters).toEqual(
      expect.arrayContaining([{ col: 'status', val: 'draft' }]),
    );
  });

  it('/start loses the compare-and-set -> 409 STATE_CONFLICT', async () => {
    const state: MockState = makeState({
      org_feature_flags: manufacturingFlag(),
      manufacturing_runs: [manufacturingRow('draft')],
    });
    state.raceAdvanceStatusOnSelect = { manufacturing_runs: 'started' };
    setActiveMockState(state);

    const req = new Request(`https://example.test/manufacturing-runs/${MR_ID}/start`, {
      method: 'POST',
      headers: idemHeaders(),
    });
    const res = await handler(req);
    expect(res.status).toBe(409);
    const body = await readJson(res);
    expect(body.error?.code).toBe('STATE_CONFLICT');
  });
});

// -----------------------------------------------------------------------------
// invoicing-api: invoice + credit-note transitions
// -----------------------------------------------------------------------------
describe('invoicing-api transitions: status-equals-from guard (R-W13-FIN-01)', () => {
  const handler = (req: Request) => invoicingHandler(req);

  function invoiceRow(status: string): Record<string, unknown> {
    return {
      id: INV_ID,
      org_id: ORG_A,
      invoice_number: 'INV-2026-00001',
      customer_id: null,
      project_id: null,
      status,
      currency_code: 'USD',
      subtotal_cents: 10000,
      tax_cents: 0,
      total_cents: 10000,
      amount_paid_cents: 0,
      issue_date: '2026-06-01',
      due_date: '2026-06-30',
      sent_at: null,
      paid_at: null,
      cancelled_at: null,
      sent_to: null,
      notes: null,
      created_at: ISO,
      updated_at: ISO,
      deleted_at: null,
    };
  }

  function creditNoteRow(status: string): Record<string, unknown> {
    return {
      id: CN_ID,
      org_id: ORG_A,
      credit_note_number: 'CN-2026-00001',
      customer_id: null,
      source_invoice_id: null,
      status,
      state_changed_at: ISO,
      currency_code: 'USD',
      amount_cents: 10000,
      applied_cents: 0,
      reason: null,
      issued_at: null,
      voided_at: null,
      created_at: ISO,
      updated_at: ISO,
      deleted_at: null,
    };
  }

  it('invoice /transition (draft -> sent) loses the compare-and-set -> 409 STATE_CONFLICT', async () => {
    const state: MockState = makeState({
      invoices: [invoiceRow('draft')],
    });
    state.raceAdvanceStatusOnSelect = { invoices: 'sent' };
    setActiveMockState(state);

    // /transition goes straight through transitionInvoiceTo (a single SELECT).
    const req = new Request(`https://example.test/invoices/${INV_ID}/transition`, {
      method: 'POST',
      headers: idemHeaders(),
      body: JSON.stringify({ to: 'sent' }),
    });
    const res = await handler(req);
    expect(res.status).toBe(409);
    const body = await readJson(res);
    expect(body.error?.code).toBe('STATE_CONFLICT');

    // The transition UPDATE must have carried the status compare-and-set.
    const update = state.updates.find((u) => u.table === 'invoices');
    expect(update).toBeDefined();
    expect(update!.filters).toEqual(
      expect.arrayContaining([{ col: 'status', val: 'draft' }]),
    );
  });

  it('credit note /issue (draft -> issued) loses the compare-and-set -> 409 STATE_CONFLICT', async () => {
    const state: MockState = makeState({
      credit_notes: [creditNoteRow('draft')],
    });
    state.raceAdvanceStatusOnSelect = { credit_notes: 'issued' };
    setActiveMockState(state);

    const req = new Request(`https://example.test/credit-notes/${CN_ID}/issue`, {
      method: 'POST',
      headers: idemHeaders(),
    });
    const res = await handler(req);
    expect(res.status).toBe(409);
    const body = await readJson(res);
    expect(body.error?.code).toBe('STATE_CONFLICT');

    const update = state.updates.find((u) => u.table === 'credit_notes');
    expect(update).toBeDefined();
    expect(update!.filters).toEqual(
      expect.arrayContaining([{ col: 'status', val: 'draft' }]),
    );
  });

  it('credit note /issue (draft -> issued) succeeds (200) and the UPDATE carries .eq(status, draft)', async () => {
    const state = makeState({
      credit_notes: [creditNoteRow('draft')],
    });
    setActiveMockState(state);

    const req = new Request(`https://example.test/credit-notes/${CN_ID}/issue`, {
      method: 'POST',
      headers: idemHeaders(),
    });
    const res = await handler(req);
    expect(res.status).toBe(200);

    const update = state.updates.find((u) => u.table === 'credit_notes');
    expect(update).toBeDefined();
    expect(update!.filters).toEqual(
      expect.arrayContaining([{ col: 'status', val: 'draft' }]),
    );
  });
});
