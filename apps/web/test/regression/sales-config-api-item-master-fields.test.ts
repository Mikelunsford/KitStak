// Regression suite for Wave 13 Phase B (R-W13-CAT-01). The item master gains
// four additive catalog attributes: unit_of_measure (free-text label), a
// distinct purchasing cost (cost_cents, BIGINT cents), reorder_point (numeric
// threshold), and barcode/UPC. Migration 0115 adds the columns; the
// sales-config-api ItemWriteSchema accepts them and the genericCreate /
// genericUpdate handlers persist them via the spread-the-validated-body path.
//
// These tests drive the live sales-config-api handler through the in-memory
// Supabase mock (mirrors copack-api-basic.test.ts) and assert the new fields
// round-trip on POST /items (create) and PATCH /items/:id (edit). The
// constitutional cents-wire convention is exercised: cost_cents goes out as a
// digit string and is persisted as-is.

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
import { invalidateFlagCache } from '../../../../supabase/functions/_shared/feature-flags.ts';

const ORG_A = '00000000-0000-4000-8000-0000000000a1';
const USER_A = '00000000-0000-4000-8000-0000000000b1';
const OWNER = { userId: USER_A, orgId: ORG_A, role: 'org_owner' as const };

const ITEM_ID = '00000000-0000-4000-8000-0000000000e1';

function makeStateWithGate(extra: Record<string, Array<Record<string, unknown>>> = {}) {
  return makeState({
    org_feature_flags: [
      {
        org_id: ORG_A,
        flag_key: 'plugins.three_pl',
        is_enabled: true,
        config: {},
      },
    ],
    ...extra,
  });
}

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

describe('sales-config-api — item master fields (R-W13-CAT-01)', () => {
  let handler: (req: Request) => Promise<Response> | Response;

  beforeAll(async () => {
    installDenoShim();
    resetCapturedHandler();
    await import('../../../../supabase/functions/sales-config-api/index.ts');
    handler = capturedHandler();
  });

  afterEach(() => {
    clearActiveMockState();
    invalidateFlagCache(ORG_A);
  });

  it('POST /items persists unit_of_measure, cost_cents, reorder_point, barcode', async () => {
    setActiveMockState(makeStateWithGate());
    const req = new Request('https://example.test/items', {
      method: 'POST',
      headers: idemHeaders(),
      body: JSON.stringify({
        sku: 'WIDGET-1',
        name: 'Widget',
        unit_price_cents: '1500',
        unit_of_measure: 'case',
        cost_cents: '900',
        reorder_point: 12,
        barcode: '012345678905',
      }),
    });
    const res = await handler(req);
    expect(res.status).toBe(201);
    const body = await readJson(res);
    expect(body.data).toMatchObject({
      sku: 'WIDGET-1',
      name: 'Widget',
      unit_of_measure: 'case',
      cost_cents: '900',
      reorder_point: 12,
      barcode: '012345678905',
      org_id: ORG_A,
    });
  });

  it('POST /items accepts the new fields as null (all four are nullable)', async () => {
    setActiveMockState(makeStateWithGate());
    const req = new Request('https://example.test/items', {
      method: 'POST',
      headers: idemHeaders(),
      body: JSON.stringify({
        sku: 'WIDGET-2',
        name: 'Plain Widget',
        unit_of_measure: null,
        cost_cents: null,
        reorder_point: null,
        barcode: null,
      }),
    });
    const res = await handler(req);
    expect(res.status).toBe(201);
    const body = await readJson(res);
    expect(body.data).toMatchObject({
      sku: 'WIDGET-2',
      unit_of_measure: null,
      cost_cents: null,
      reorder_point: null,
      barcode: null,
    });
  });

  it('PATCH /items/:id updates the new catalog fields', async () => {
    setActiveMockState(makeStateWithGate({
      items: [
        {
          id: ITEM_ID,
          org_id: ORG_A,
          sku: 'WIDGET-3',
          name: 'Widget Three',
          unit_price_cents: 1000,
          unit_cost_cents: null,
          cost_cents: null,
          unit_of_measure: null,
          reorder_point: null,
          barcode: null,
          currency_code: 'USD',
          is_active: true,
          is_taxable: true,
          is_sellable: true,
          is_purchasable: false,
          metadata: {},
          deleted_at: null,
        },
      ],
    }));
    const req = new Request(`https://example.test/items/${ITEM_ID}`, {
      method: 'PATCH',
      headers: idemHeaders(),
      body: JSON.stringify({
        unit_of_measure: 'pallet',
        cost_cents: '2500',
        reorder_point: 5,
        barcode: '99887766',
      }),
    });
    const res = await handler(req);
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.data).toMatchObject({
      id: ITEM_ID,
      unit_of_measure: 'pallet',
      cost_cents: '2500',
      reorder_point: 5,
      barcode: '99887766',
    });
  });

  it('POST /items rejects a negative reorder_point', async () => {
    setActiveMockState(makeStateWithGate());
    const req = new Request('https://example.test/items', {
      method: 'POST',
      headers: idemHeaders(),
      body: JSON.stringify({
        sku: 'WIDGET-BAD',
        name: 'Bad Widget',
        reorder_point: -3,
      }),
    });
    const res = await handler(req);
    expect(res.status).toBe(422);
    const body = await readJson(res);
    expect(body.error).toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});
