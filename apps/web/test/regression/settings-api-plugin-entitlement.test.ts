// R-W13-BILL-01 regression suite.
//
// Gate: enabling a paid pillar plugin flag (plugins.three_pl,
// plugins.manufacturing, plugins.copack_ecom, plugins.kitforce,
// plugins.kitcost, plugins.wms) requires the org to be on an active or
// trialing subscription. The settings-api flag-write handler reads
// organizations.subscription_status before honouring an enable and returns
// 403 BILLING_REQUIRED when the org is not entitled.
//
// Constitutional separation locked here:
//   - This BILLING_REQUIRED 403 is a flag-WRITE entitlement denial on the
//     settings surface the caller already reaches. It is NOT a bundle gate.
//   - Bundle-gate misses stay 404 NOT_FOUND so a sub-plan tenant cannot
//     enumerate a hidden pillar surface. The final probe asserts that an
//     inventory-api request with plugins.three_pl off still returns 404,
//     confirming the two rails did not collapse into one.
//
// Disabling a paid plugin (is_enabled = false) is always allowed regardless
// of billing state, and non-plugin flags are never gated.

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

const PAID_PLUGIN_FLAG = 'plugins.manufacturing';
const NON_PLUGIN_FLAG = 'finance.journal_entries.enabled';

function idemHeaders(): Record<string, string> {
  return {
    authorization: bearer(OWNER),
    'content-type': 'application/json',
    'idempotency-key': crypto.randomUUID(),
  };
}

async function readJson(
  res: Response,
): Promise<{ data?: unknown; error?: { code?: string } }> {
  return JSON.parse(await res.text());
}

/** settings-api state with one organizations row at the given status. */
function makeSettingsState(subscriptionStatus: string) {
  return makeState({
    organizations: [
      { id: ORG_A, subscription_status: subscriptionStatus },
    ],
  });
}

describe('settings-api — paid-plugin enablement entitlement (R-W13-BILL-01)', () => {
  let handler: (req: Request) => Promise<Response> | Response;

  beforeAll(async () => {
    installDenoShim();
    resetCapturedHandler();
    await import(
      /* @vite-ignore */ '../../../../supabase/functions/settings-api/index.ts'
    );
    handler = capturedHandler();
  });

  afterEach(() => {
    clearActiveMockState();
  });

  function putFlag(
    flagKey: string,
    isEnabled: boolean,
  ): Promise<Response> {
    const req = new Request(
      `https://example.test/flags/${flagKey}`,
      {
        method: 'PUT',
        headers: idemHeaders(),
        body: JSON.stringify({ is_enabled: isEnabled, config: {} }),
      },
    );
    return Promise.resolve(handler(req));
  }

  it('enabling a paid plugin without an active subscription returns 403 BILLING_REQUIRED', async () => {
    setActiveMockState(makeSettingsState('past_due'));
    const res = await putFlag(PAID_PLUGIN_FLAG, true);
    expect(res.status).toBe(403);
    const body = await readJson(res);
    expect(body.error).toMatchObject({ code: 'BILLING_REQUIRED' });
  });

  it('enabling a paid plugin with status active returns 200', async () => {
    setActiveMockState(makeSettingsState('active'));
    const res = await putFlag(PAID_PLUGIN_FLAG, true);
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.data).toMatchObject({
      flag_key: PAID_PLUGIN_FLAG,
      is_enabled: true,
    });
  });

  it('enabling a paid plugin with status trialing returns 200', async () => {
    setActiveMockState(makeSettingsState('trialing'));
    const res = await putFlag(PAID_PLUGIN_FLAG, true);
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.data).toMatchObject({
      flag_key: PAID_PLUGIN_FLAG,
      is_enabled: true,
    });
  });

  it('disabling a paid plugin is allowed even with no active subscription', async () => {
    setActiveMockState(makeSettingsState('canceled'));
    const res = await putFlag(PAID_PLUGIN_FLAG, false);
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.data).toMatchObject({
      flag_key: PAID_PLUGIN_FLAG,
      is_enabled: false,
    });
  });

  it('enabling a non-plugin flag is never gated (200 even when not entitled)', async () => {
    setActiveMockState(makeSettingsState('past_due'));
    const res = await putFlag(NON_PLUGIN_FLAG, true);
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.data).toMatchObject({
      flag_key: NON_PLUGIN_FLAG,
      is_enabled: true,
    });
  });
});

// The entitlement 403 must not bleed into the bundle gate. A gated bundle
// (inventory-api) with the pillar plugin off must still answer 404, never
// 403, so a sub-plan tenant cannot enumerate the surface.
describe('bundle gate stays 404 (distinct from entitlement 403)', () => {
  let inventoryHandler: (req: Request) => Promise<Response> | Response;

  beforeAll(async () => {
    installDenoShim();
    resetCapturedHandler();
    await import(
      /* @vite-ignore */ '../../../../supabase/functions/inventory-api/index.ts'
    );
    inventoryHandler = capturedHandler();
  });

  afterEach(() => {
    clearActiveMockState();
    invalidateFlagCache(ORG_A);
  });

  it('GET /warehouses returns 404 NOT_FOUND when plugins.three_pl is off', async () => {
    setActiveMockState(
      makeState({
        org_feature_flags: [
          {
            org_id: ORG_A,
            flag_key: 'plugins.three_pl',
            is_enabled: false,
            config: {},
          },
        ],
      }),
    );
    const req = new Request('https://example.test/warehouses', {
      method: 'GET',
      headers: { authorization: bearer(OWNER) },
    });
    const res = await inventoryHandler(req);
    expect(res.status).toBe(404);
    const body = await readJson(res);
    expect(body.error).toMatchObject({ code: 'NOT_FOUND' });
  });
});
