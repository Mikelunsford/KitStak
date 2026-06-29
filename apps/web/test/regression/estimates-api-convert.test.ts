// Regression suite for estimates-api (ADR 0006, P1b).
//
// Proves the estimate -> quote convert path and the draft lifecycle:
//   1. Create snapshots subtotal/total/min_applied server-side from the rate
//      card (rate_micros), never a client-supplied figure.
//   2. Convert builds a real quote: header plus one quote_line_item per engine
//      line, each at the engine's rounded cents (no float, no re-derivation),
//      then recompute_quote_totals, then stamps the estimate converted.
//   3. The $500 project minimum becomes an explicit adjustment line so the
//      quote total equals the estimate total.
//   4. Guards: convert needs a customer (422), only a draft converts (409), and
//      every non-GET is idempotency-gated (400 without a key).
//
// Correctness anchor: the expected cents come from the SAME pure engine the SPA
// uses (@/lib/estimate/engine) priced against DEFAULT_RATE_CARD, and the DB rate
// card the handler reads is seeded FROM DEFAULT_RATE_CARD, so the two must agree.

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

import { computeEstimate, type EstimateInput } from '@/lib/estimate/engine';
import { DEFAULT_RATE_CARD } from '@/lib/estimate/rateCard';

const ORG_A = '00000000-0000-4000-8000-0000000000a1';
const USER_A = '00000000-0000-4000-8000-0000000000b1';
const OWNER = { userId: USER_A, orgId: ORG_A, role: 'org_owner' as const };
const VIEWER = { userId: USER_A, orgId: ORG_A, role: 'viewer' as const };

const CUSTOMER_ID = '00000000-0000-4000-8000-0000000000c1';
const CARD_ID = '00000000-0000-4000-8000-0000000000d1';
const EST_ID = '00000000-0000-4000-8000-0000000000e1';

async function readJson(res: Response): Promise<{ data?: unknown; error?: unknown }> {
  return JSON.parse(await res.text());
}

function idemHeaders(caller = OWNER): Record<string, string> {
  return {
    authorization: bearer(caller),
    'content-type': 'application/json',
    'idempotency-key': crypto.randomUUID(),
  };
}

function inserted(state: MockState, table: string): Array<Record<string, unknown>> {
  return state.inserts.filter((r) => r.table === table).map((r) => r.row);
}

// DB rate_card_lines seeded from the canonical default card, so the handler's
// loadRateCardLines reproduces computeEstimate(input, DEFAULT_RATE_CARD).
function seedCardLines(): Array<Record<string, unknown>> {
  return DEFAULT_RATE_CARD.map((l, i) => ({
    id: `00000000-0000-4000-8000-00000000f${i.toString(16).padStart(3, '0')}`,
    org_id: ORG_A,
    rate_card_id: CARD_ID,
    code: l.code,
    group_key: l.group,
    label: l.label,
    rate_micros: l.rateMicros,
    position: i,
  }));
}

function baseInput(over: Partial<EstimateInput>): EstimateInput {
  return {
    family: 'display', engine: 'timestudy',
    qty: 0, studyMin: 0, studySec: 0, inflationPct: 0, markup: 0,
    touches: 0, baseRateMicros: 0,
    inboundPallets: 0, inboundMode: 'pallet', palletsOut: 0, palletGrade: 'a',
    labelQty: 0, storagePallets: 0, storageMonths: 0,
    ecomOrders: 0, ecomPieces: 0, programmingHrs: 0, shopHours: 0, setupOn: false,
    ...over,
  };
}

// A multi-line display job comfortably over the $500 minimum (no adjustment).
const DISPLAY_INPUT = baseInput({
  family: 'display', engine: 'timestudy',
  qty: 1000, studySec: 15, inflationPct: 10, markup: 2.5,
  inboundPallets: 5, palletsOut: 8, labelQty: 1000,
  storagePallets: 50, storageMonths: 2, setupOn: true,
});

// The inputs jsonb stored on the estimate row (family/engine live in columns).
function inputsJson(input: EstimateInput): Record<string, unknown> {
  const rest: Record<string, unknown> = { ...input };
  delete rest.family;
  delete rest.engine;
  return rest;
}

function seedEstimate(input: EstimateInput, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: EST_ID,
    org_id: ORG_A,
    name: 'Acme endcap display',
    customer_id: CUSTOMER_ID,
    rate_card_id: CARD_ID,
    family: input.family,
    engine: input.engine,
    currency_code: 'USD',
    status: 'draft',
    inputs: inputsJson(input),
    notes: null,
    deleted_at: null,
    created_at: '2026-06-29T00:00:00Z',
    ...over,
  };
}

function convertState(input: EstimateInput, estOver: Record<string, unknown> = {}): MockState {
  const state = makeState({
    estimates: [seedEstimate(input, estOver)],
    customers: [{ id: CUSTOMER_ID, org_id: ORG_A, deleted_at: null }],
    rate_cards: [{ id: CARD_ID, org_id: ORG_A, is_default: true, deleted_at: null }],
    rate_card_lines: seedCardLines(),
    quotes: [],
    quote_line_items: [],
  });
  state.rpcResults['next_doc_number'] = { data: 'Q-2026-00001', error: null };
  state.rpcResults['recompute_quote_totals'] = { data: null, error: null };
  return state;
}

async function convert(
  handler: (req: Request) => Promise<Response> | Response,
  body: Record<string, unknown> = {},
  caller = OWNER,
): Promise<Response> {
  const req = new Request(`https://example.test/estimates/${EST_ID}/convert`, {
    method: 'POST',
    headers: idemHeaders(caller),
    body: JSON.stringify(body),
  });
  return handler(req);
}

describe('estimates-api convert + draft lifecycle', () => {
  let handler: (req: Request) => Promise<Response> | Response;

  beforeAll(async () => {
    installDenoShim();
    resetCapturedHandler();
    await import('../../../../supabase/functions/estimates-api/index.ts');
    handler = capturedHandler();
  });

  afterEach(() => {
    clearActiveMockState();
  });

  // -------------------------------------------------------------------------
  // Convert: a multi-line display estimate becomes a quote whose line cents are
  // exactly the engine's, in order, with no minimum adjustment.
  // -------------------------------------------------------------------------

  it('convert builds a quote with one line per engine line at the rounded cents', async () => {
    const state = convertState(DISPLAY_INPUT);
    setActiveMockState(state);

    const expected = computeEstimate(DISPLAY_INPUT, DEFAULT_RATE_CARD);
    expect(expected.minApplied).toBe(false); // sanity: this job clears the minimum
    const expectedLines = [...expected.productionItems, ...expected.passThroughItems];

    const res = await convert(handler);
    expect(res.status).toBe(201);
    const body = await readJson(res);
    expect(body.data).toMatchObject({ estimate_id: EST_ID });

    // Quote header.
    const quotes = inserted(state, 'quotes');
    expect(quotes).toHaveLength(1);
    expect(quotes[0]).toMatchObject({
      org_id: ORG_A,
      number: 'Q-2026-00001',
      customer_id: CUSTOMER_ID,
      currency_code: 'USD',
      state: 'draft',
      title: 'Acme endcap display',
    });

    // One quote line per engine line, in order, at the engine's cents.
    const lines = inserted(state, 'quote_line_items');
    expect(lines).toHaveLength(expectedLines.length);
    lines.forEach((row, i) => {
      expect(row.name).toBe(expectedLines[i].label);
      expect(row.kind).toBe('item');
      expect(row.quantity_e3).toBe(1000);
      expect(row.is_taxable).toBe(false);
      expect(row.unit_price_cents).toBe(String(expectedLines[i].amountCents));
      expect(row.line_total_cents).toBe(String(expectedLines[i].amountCents));
      expect(row.line_tax_cents).toBe('0');
    });

    // Server-authoritative recompute, then the estimate is stamped converted.
    expect(state.rpcCalls.some((c) => c.name === 'recompute_quote_totals')).toBe(true);
    const estUpdate = state.updates.find((u) => u.table === 'estimates');
    expect(estUpdate?.patch).toMatchObject({ status: 'converted' });
  });

  // -------------------------------------------------------------------------
  // The $500 project minimum surfaces as an explicit adjustment line so the
  // quote total equals the estimate total.
  // -------------------------------------------------------------------------

  it('convert adds a project-minimum adjustment line when the minimum applies', async () => {
    const tiny = baseInput({ family: 'valueadd', engine: 'perpiece', qty: 50, baseRateMicros: 100_000 });
    const state = convertState(tiny);
    setActiveMockState(state);

    const expected = computeEstimate(tiny, DEFAULT_RATE_CARD);
    expect(expected.minApplied).toBe(true);

    const res = await convert(handler);
    expect(res.status).toBe(201);

    const lines = inserted(state, 'quote_line_items');
    // one production line ($5.00) + the minimum adjustment ($495.00)
    expect(lines).toHaveLength(2);
    const amounts = lines.map((r) => Number(r.unit_price_cents));
    expect(amounts[0]).toBe(expected.rawCents);
    expect(amounts[1]).toBe(expected.totalCents - expected.rawCents);
    // the two lines sum to the engine total ($500.00)
    expect(amounts[0] + amounts[1]).toBe(expected.totalCents);
    expect(lines[1].name).toBe('Project minimum adjustment');
  });

  // -------------------------------------------------------------------------
  // Guards.
  // -------------------------------------------------------------------------

  it('convert rejects an estimate with no customer (422) and writes no quote', async () => {
    const state = convertState(DISPLAY_INPUT, { customer_id: null });
    setActiveMockState(state);
    const res = await convert(handler);
    expect(res.status).toBe(422);
    expect(inserted(state, 'quotes')).toHaveLength(0);
  });

  it('convert rejects an already-converted estimate (409)', async () => {
    const state = convertState(DISPLAY_INPUT, { status: 'converted' });
    setActiveMockState(state);
    const res = await convert(handler);
    expect(res.status).toBe(409);
    expect(inserted(state, 'quotes')).toHaveLength(0);
  });

  it('convert without an Idempotency-Key is rejected (400) and writes nothing', async () => {
    const state = convertState(DISPLAY_INPUT);
    setActiveMockState(state);
    const req = new Request(`https://example.test/estimates/${EST_ID}/convert`, {
      method: 'POST',
      headers: { authorization: bearer(OWNER), 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    const res = await handler(req);
    expect(res.status).toBe(400);
    expect(inserted(state, 'quotes')).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Create snapshots the totals server-side from the rate card.
  // -------------------------------------------------------------------------

  it('create computes subtotal/total/min_applied from the rate card and stores defaulted inputs', async () => {
    const state = makeState({
      estimates: [],
      customers: [{ id: CUSTOMER_ID, org_id: ORG_A, deleted_at: null }],
      rate_cards: [{ id: CARD_ID, org_id: ORG_A, is_default: true, deleted_at: null }],
      rate_card_lines: seedCardLines(),
    });
    setActiveMockState(state);

    const res = await handler(new Request('https://example.test/estimates', {
      method: 'POST',
      headers: idemHeaders(),
      body: JSON.stringify({
        name: 'Acme endcap display',
        customer_id: CUSTOMER_ID,
        rate_card_id: CARD_ID,
        family: 'display',
        // engine omitted on purpose: resolves to the family's default (timestudy)
        inputs: inputsJson(DISPLAY_INPUT),
      }),
    }));
    expect(res.status).toBe(201);

    const expected = computeEstimate(DISPLAY_INPUT, DEFAULT_RATE_CARD);
    const rows = inserted(state, 'estimates');
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.engine).toBe('timestudy');
    expect(row.status).toBe('draft');
    expect(row.subtotal_cents).toBe(expected.rawCents);
    expect(row.total_cents).toBe(expected.totalCents);
    expect(row.min_applied).toBe(expected.minApplied);
    expect(row.org_id).toBe(ORG_A);
    expect(row.created_by).toBe(USER_A);
    // inputs stored fully defaulted (every engine field present)
    expect(row.inputs).toMatchObject({ qty: 1000, setupOn: true, inboundMode: 'pallet' });
  });

  it('create is forbidden without quotes.quote.write (viewer 403)', async () => {
    const state = makeState({ estimates: [] });
    setActiveMockState(state);
    const res = await handler(new Request('https://example.test/estimates', {
      method: 'POST',
      headers: idemHeaders(VIEWER),
      body: JSON.stringify({ name: 'X', family: 'display' }),
    }));
    expect(res.status).toBe(403);
    expect(inserted(state, 'estimates')).toHaveLength(0);
  });
});
