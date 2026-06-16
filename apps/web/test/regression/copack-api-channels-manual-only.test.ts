// Regression suite for the Co-Pack channels manual-only decision
// (R-W13-COPACK-01).
//
// Channels are manual only until a real connector exists. The kind enum and the
// sales_channels CHECK constraint still permit the legacy 'shopify' / 'amazon' /
// 'other' values so historical rows read back without a migration, but a new
// channel (or a kind change) may only be 'manual'. The copack-api create / patch
// handlers reject a non-manual kind with VALIDATION_ERROR 422 (a plain input-
// validity rule, never a 403/404), and the server is the authority.
//
// Probes:
//   1. POST /sales-channels with kind 'manual' is accepted (no 4xx).
//   2. POST /sales-channels with kind 'shopify' is rejected 422.
//   3. PATCH /sales-channels/:id changing kind to 'amazon' is rejected 422.
//   4. A pre-existing 'shopify' row still reads back via GET (legacy read-back).

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

const CHANNEL_ID = '00000000-0000-4000-8000-0000000000f1';

function stateWithFlag(extra: Record<string, Array<Record<string, unknown>>> = {}) {
  return makeState({
    org_feature_flags: [
      { org_id: ORG_A, flag_key: 'plugins.copack_ecom', is_enabled: true, config: {} },
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

describe('copack-api channels are manual only', () => {
  let handler: (req: Request) => Promise<Response> | Response;

  beforeAll(async () => {
    installDenoShim();
    resetCapturedHandler();
    await import('../../../../supabase/functions/copack-api/index.ts');
    handler = capturedHandler();
  });

  afterEach(() => {
    clearActiveMockState();
    invalidateFlagCache(ORG_A);
  });

  it('accepts a manual channel create (no 4xx)', async () => {
    setActiveMockState(stateWithFlag({ sales_channels: [] }));
    const req = new Request('https://example.test/sales-channels', {
      method: 'POST',
      headers: idemHeaders(),
      body: JSON.stringify({ name: 'Storefront', kind: 'manual' }),
    });
    const res = await handler(req);
    expect(res.status).not.toBe(422);
    expect(res.status).not.toBe(403);
    expect(res.status).not.toBe(404);
  });

  it('rejects a shopify channel create with 422', async () => {
    setActiveMockState(stateWithFlag({ sales_channels: [] }));
    const req = new Request('https://example.test/sales-channels', {
      method: 'POST',
      headers: idemHeaders(),
      body: JSON.stringify({ name: 'Shop', kind: 'shopify' }),
    });
    const res = await handler(req);
    expect(res.status).toBe(422);
    const body = await readJson(res);
    expect(body.error).toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('rejects a patch changing kind to amazon with 422', async () => {
    setActiveMockState(
      stateWithFlag({
        sales_channels: [
          {
            id: CHANNEL_ID,
            org_id: ORG_A,
            name: 'Storefront',
            kind: 'manual',
            is_active: true,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            deleted_at: null,
          },
        ],
      }),
    );
    const req = new Request(`https://example.test/sales-channels/${CHANNEL_ID}`, {
      method: 'PATCH',
      headers: idemHeaders(),
      body: JSON.stringify({ kind: 'amazon' }),
    });
    const res = await handler(req);
    expect(res.status).toBe(422);
    const body = await readJson(res);
    expect(body.error).toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('still reads back a legacy shopify channel row via GET', async () => {
    setActiveMockState(
      stateWithFlag({
        sales_channels: [
          {
            id: CHANNEL_ID,
            org_id: ORG_A,
            name: 'Legacy Shop',
            kind: 'shopify',
            is_active: true,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            deleted_at: null,
          },
        ],
      }),
    );
    const req = new Request('https://example.test/sales-channels', {
      method: 'GET',
      headers: { authorization: bearer(OWNER) },
    });
    const res = await handler(req);
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(Array.isArray(body.data)).toBe(true);
    expect((body.data as Array<{ kind: string }>)[0]?.kind).toBe('shopify');
  });
});
