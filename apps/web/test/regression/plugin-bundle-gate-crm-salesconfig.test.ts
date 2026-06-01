// F-Wave9-SALES-CONFIG-3PL-GATE-01 regression suite.
//
// Constitutional rule (CLAUDE.md, 00-canon/01-architecture.md):
//   Plugin bundle gates return 404 NOT_FOUND. The entire Edge bundle is
//   hidden when the caller's org lacks the plugin; every method, every path,
//   returns the same envelope so a tenant on a sub-plan cannot enumerate the
//   surface. A 403 where a 404 is expected is a release blocker.
//
// Cowork's 2026-05-26 smoke walk (SMOKE-06) flagged crm-api and
// sales-config-api as UNGATED: any org could reach
// customers/contacts/leads/opportunities and taxes/items/payment-methods
// /pricing-tiers regardless of plugin state. These surfaces are CROSS-PILLAR
// (the 3PL, Manufacturing, and Co-Pack pages all consume them via the
// CustomerPicker / ItemPicker), so they gate on an OR predicate: reachable
// when ANY of the three commerce pillar plugins is on, 404 only when ALL are
// off. This suite locks that in for both bundles via the shared
// _shared/bundleGate.ts helper.

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

// The three commerce pillar plugins that form the OR predicate for both
// cross-pillar bundles. Mirrors the flagKeys list wired in each index.ts.
const PILLARS = ['plugins.three_pl', 'plugins.manufacturing', 'plugins.copack_ecom'];

// All three pillars off -> the gate must 404.
function makeStateAllPillarsOff(
  extra: Record<string, Array<Record<string, unknown>>> = {},
) {
  return makeState({
    org_feature_flags: PILLARS.map((flag_key) => ({
      org_id: ORG_A,
      flag_key,
      is_enabled: false,
      config: {},
    })),
    ...extra,
  });
}

// Exactly one pillar on -> the gate must pass through. Parameterised so each
// probe can prove the OR holds for any single pillar, not just the first.
function makeStateOnePillarOn(
  onFlag: string,
  extra: Record<string, Array<Record<string, unknown>>> = {},
) {
  return makeState({
    org_feature_flags: PILLARS.map((flag_key) => ({
      org_id: ORG_A,
      flag_key,
      is_enabled: flag_key === onFlag,
      config: {},
    })),
    ...extra,
  });
}

async function readJson(
  res: Response,
): Promise<{ data?: unknown; error?: { code?: string } }> {
  return JSON.parse(await res.text());
}

function idemHeaders(): Record<string, string> {
  return {
    authorization: bearer(OWNER),
    'content-type': 'application/json',
    'idempotency-key': crypto.randomUUID(),
  };
}

interface GateProbe {
  bundle: string;
  modulePath: string;
  listPath: string;
  createBody: Record<string, unknown>;
}

const PROBES: GateProbe[] = [
  {
    bundle: 'crm-api',
    modulePath: '../../../../supabase/functions/crm-api/index.ts',
    listPath: '/customers',
    createBody: { display_name: 'Gate Probe Co' },
  },
  {
    bundle: 'sales-config-api',
    modulePath: '../../../../supabase/functions/sales-config-api/index.ts',
    listPath: '/taxes',
    createBody: { code: 'GATE', name: 'Gate Probe Tax', rate_bps: 0 },
  },
];

describe.each(PROBES)('$bundle cross-pillar OR bundle gate', (probe) => {
  let handler: (req: Request) => Promise<Response> | Response;

  beforeAll(async () => {
    installDenoShim();
    resetCapturedHandler();
    await import(/* @vite-ignore */ probe.modulePath);
    handler = capturedHandler();
  });

  afterEach(() => {
    clearActiveMockState();
    invalidateFlagCache(ORG_A);
  });

  it(`GET ${probe.listPath} returns 404 when all three pillar plugins are off`, async () => {
    setActiveMockState(makeStateAllPillarsOff());
    const req = new Request(`https://example.test${probe.listPath}`, {
      method: 'GET',
      headers: { authorization: bearer(OWNER) },
    });
    const res = await handler(req);
    expect(res.status).toBe(404);
    expect((await readJson(res)).error).toMatchObject({ code: 'NOT_FOUND' });
  });

  it(`POST ${probe.listPath} returns 404 when all three pillar plugins are off`, async () => {
    setActiveMockState(makeStateAllPillarsOff());
    const req = new Request(`https://example.test${probe.listPath}`, {
      method: 'POST',
      headers: idemHeaders(),
      body: JSON.stringify(probe.createBody),
    });
    const res = await handler(req);
    expect(res.status).toBe(404);
    expect((await readJson(res)).error).toMatchObject({ code: 'NOT_FOUND' });
  });

  it(`PATCH ${probe.listPath}/:id returns 404 when all three pillar plugins are off`, async () => {
    setActiveMockState(makeStateAllPillarsOff());
    const fakeId = '00000000-0000-4000-8000-00000000ffff';
    const req = new Request(`https://example.test${probe.listPath}/${fakeId}`, {
      method: 'PATCH',
      headers: idemHeaders(),
      body: JSON.stringify({}),
    });
    const res = await handler(req);
    expect(res.status).toBe(404);
  });

  it(`DELETE ${probe.listPath}/:id returns 404 when all three pillar plugins are off`, async () => {
    setActiveMockState(makeStateAllPillarsOff());
    const fakeId = '00000000-0000-4000-8000-00000000ffff';
    const req = new Request(`https://example.test${probe.listPath}/${fakeId}`, {
      method: 'DELETE',
      headers: idemHeaders(),
    });
    const res = await handler(req);
    expect(res.status).toBe(404);
  });

  // The OR must hold for ANY single pillar being on, including the last
  // entry, so an org on manufacturing-only or copack-only still reaches the
  // shared customer/tax surface.
  it.each(PILLARS)(
    `GET ${probe.listPath} does NOT 404 when only %s is on (gate passes through)`,
    async (onFlag) => {
      setActiveMockState(makeStateOnePillarOn(onFlag));
      const req = new Request(`https://example.test${probe.listPath}`, {
        method: 'GET',
        headers: { authorization: bearer(OWNER) },
      });
      const res = await handler(req);
      // Gate passed; any remaining status is downstream handler logic, not
      // the dispatcher's 404.
      expect(res.status).not.toBe(404);
    },
  );

  it(`OPTIONS ${probe.listPath} bypasses the gate (CORS preflight)`, async () => {
    setActiveMockState(makeStateAllPillarsOff());
    const req = new Request(`https://example.test${probe.listPath}`, {
      method: 'OPTIONS',
      headers: {
        origin: 'https://example.test',
        'access-control-request-method': 'GET',
      },
    });
    const res = await handler(req);
    expect(res.status).not.toBe(404);
  });
});
