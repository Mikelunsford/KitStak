// Regression suite for rate-cards-api (ADR 0006, P1b).
//
// Covers the CRUD surface for the Estimate Engine's pricing source:
//   1. Create / list / get a card and its lines (org-scoped, settings cap).
//   2. Promoting a card to default first clears the org's other default, so the
//      partial unique index (one default per org) never collides.
//   3. The write cap is settings.write (owner/admin), so a settings-read-only
//      role (sales) is forbidden from creating a card (403) but may still read.
//   4. Every non-GET is idempotency-gated (400 without a key).

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
const SALES = { userId: USER_A, orgId: ORG_A, role: 'sales' as const };

const CARD_ID = '00000000-0000-4000-8000-0000000000d1';

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

describe('rate-cards-api CRUD', () => {
  let handler: (req: Request) => Promise<Response> | Response;

  beforeAll(async () => {
    installDenoShim();
    resetCapturedHandler();
    await import('../../../../supabase/functions/rate-cards-api/index.ts');
    handler = capturedHandler();
  });

  afterEach(() => {
    clearActiveMockState();
  });

  it('creates a card with server-set org/audit columns', async () => {
    const state = makeState({ rate_cards: [] });
    setActiveMockState(state);
    const res = await handler(new Request('https://example.test/rate-cards', {
      method: 'POST',
      headers: idemHeaders(),
      body: JSON.stringify({ name: 'West DC rates', currency_code: 'USD' }),
    }));
    expect(res.status).toBe(201);
    const row = inserted(state, 'rate_cards')[0];
    expect(row).toMatchObject({
      name: 'West DC rates',
      currency_code: 'USD',
      is_default: false,
      status: 'active',
      org_id: ORG_A,
      created_by: USER_A,
    });
  });

  it('promoting a new card to default clears the org existing default first', async () => {
    const state = makeState({
      rate_cards: [{ id: CARD_ID, org_id: ORG_A, is_default: true, deleted_at: null }],
    });
    setActiveMockState(state);
    const res = await handler(new Request('https://example.test/rate-cards', {
      method: 'POST',
      headers: idemHeaders(),
      body: JSON.stringify({ name: 'New default', is_default: true }),
    }));
    expect(res.status).toBe(201);
    // a clear-defaults UPDATE fired on rate_cards before the insert
    const clear = state.updates.find(
      (u) => u.table === 'rate_cards' && u.patch.is_default === false,
    );
    expect(clear).toBeDefined();
    expect(inserted(state, 'rate_cards')[0]).toMatchObject({ is_default: true });
  });

  it('adds a line to a card, scoped to the org', async () => {
    const state = makeState({
      rate_cards: [{ id: CARD_ID, org_id: ORG_A, is_default: true, deleted_at: null }],
      rate_card_lines: [],
    });
    setActiveMockState(state);
    const res = await handler(new Request(`https://example.test/rate-cards/${CARD_ID}/lines`, {
      method: 'POST',
      headers: idemHeaders(),
      body: JSON.stringify({ code: 'CON-LABOR', group_key: 'constants', label: 'Labor', rate_micros: 25_000_000 }),
    }));
    expect(res.status).toBe(201);
    const row = inserted(state, 'rate_card_lines')[0];
    expect(row).toMatchObject({
      rate_card_id: CARD_ID,
      org_id: ORG_A,
      code: 'CON-LABOR',
      rate_micros: 25_000_000,
    });
  });

  it('gets a card with its lines', async () => {
    const state = makeState({
      rate_cards: [{ id: CARD_ID, org_id: ORG_A, name: 'Default', is_default: true, deleted_at: null }],
      rate_card_lines: [
        { id: 'l1', org_id: ORG_A, rate_card_id: CARD_ID, code: 'CON-LABOR', rate_micros: 25_000_000, position: 0 },
      ],
    });
    setActiveMockState(state);
    const res = await handler(new Request(`https://example.test/rate-cards/${CARD_ID}`, {
      method: 'GET',
      headers: { authorization: bearer(OWNER) },
    }));
    expect(res.status).toBe(200);
    const data = (await readJson(res)).data as { rate_card: { id: string }; lines: unknown[] };
    expect(data.rate_card.id).toBe(CARD_ID);
    expect(data.lines).toHaveLength(1);
  });

  it('lists the org cards (settings.read) for a non-admin role', async () => {
    const state = makeState({
      rate_cards: [{ id: CARD_ID, org_id: ORG_A, name: 'Default', is_default: true, deleted_at: null, created_at: '2026-06-29T00:00:00Z' }],
    });
    setActiveMockState(state);
    const res = await handler(new Request('https://example.test/rate-cards', {
      method: 'GET',
      headers: { authorization: bearer(SALES) },
    }));
    expect(res.status).toBe(200);
    const data = (await readJson(res)).data as { items: unknown[] };
    expect(data.items).toHaveLength(1);
  });

  it('forbids creating a card without settings.write (sales 403)', async () => {
    const state = makeState({ rate_cards: [] });
    setActiveMockState(state);
    const res = await handler(new Request('https://example.test/rate-cards', {
      method: 'POST',
      headers: idemHeaders(SALES),
      body: JSON.stringify({ name: 'Nope' }),
    }));
    expect(res.status).toBe(403);
    expect(inserted(state, 'rate_cards')).toHaveLength(0);
  });

  it('rejects a create with no Idempotency-Key (400) and writes nothing', async () => {
    const state = makeState({ rate_cards: [] });
    setActiveMockState(state);
    const res = await handler(new Request('https://example.test/rate-cards', {
      method: 'POST',
      headers: { authorization: bearer(OWNER), 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'NoKey' }),
    }));
    expect(res.status).toBe(400);
    expect(inserted(state, 'rate_cards')).toHaveLength(0);
  });
});
