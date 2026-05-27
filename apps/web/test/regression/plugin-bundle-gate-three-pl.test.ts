// F-Wave9-COWORK-SMOKE-06 regression suite.
//
// Constitutional rule (CLAUDE.md, 00-canon/01-architecture.md):
//   Plugin bundle gates return 404 NOT_FOUND. The entire Edge bundle is
//   hidden when the pillar plugin flag is off; every method, every path,
//   returns the same envelope so a tenant on a sub-plan cannot enumerate
//   the surface.
//
// Cowork's 2026-05-26 smoke walk caught the half-state: ops-api and
// manufacturing-api had the gate, but quotes-api, projects-api, and
// inventory-api did not, so an org with plugins.three_pl=false could
// still create quotes, projects, warehouses, and BOM items end-to-end.
// This suite locks the gate in for all three bundles via the shared
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

function makeStateGateOn(extra: Record<string, Array<Record<string, unknown>>> = {}) {
  return makeState({
    org_feature_flags: [
      { org_id: ORG_A, flag_key: 'plugins.three_pl', is_enabled: true, config: {} },
    ],
    ...extra,
  });
}

function makeStateGateOff(extra: Record<string, Array<Record<string, unknown>>> = {}) {
  return makeState({
    org_feature_flags: [
      { org_id: ORG_A, flag_key: 'plugins.three_pl', is_enabled: false, config: {} },
    ],
    ...extra,
  });
}

async function readJson(res: Response): Promise<{ data?: unknown; error?: { code?: string } }> {
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
    bundle: 'quotes-api',
    modulePath: '../../../../supabase/functions/quotes-api/index.ts',
    listPath: '/quotes',
    createBody: { customer_id: '00000000-0000-4000-8000-0000000000c1' },
  },
  {
    bundle: 'projects-api',
    modulePath: '../../../../supabase/functions/projects-api/index.ts',
    listPath: '/projects',
    createBody: { name: 'gate-probe-project' },
  },
  {
    bundle: 'inventory-api',
    modulePath: '../../../../supabase/functions/inventory-api/index.ts',
    listPath: '/warehouses',
    createBody: {
      code: 'WH-GATE-PROBE',
      display_name: 'Gate Probe Warehouse',
    },
  },
];

describe.each(PROBES)('$bundle — plugins.three_pl bundle gate', (probe) => {
  let handler: (req: Request) => Promise<Response> | Response;

  beforeAll(async () => {
    installDenoShim();
    resetCapturedHandler();
    await import(/* @vite-ignore */ probe.modulePath);
    handler = capturedHandler();
  });

  afterEach(() => {
    clearActiveMockState();
    // The feature-flag reader caches per (org_id, flag_key) for 5 minutes.
    // Tests that flip the gate back-to-back must clear the cache so a
    // prior gate-on read does not mask a subsequent gate-off probe.
    invalidateFlagCache(ORG_A);
  });

  it(`GET ${probe.listPath} returns 404 NOT_FOUND when plugins.three_pl is off`, async () => {
    setActiveMockState(makeStateGateOff());
    const req = new Request(`https://example.test${probe.listPath}`, {
      method: 'GET',
      headers: { authorization: bearer(OWNER) },
    });
    const res = await handler(req);
    expect(res.status).toBe(404);
    const body = await readJson(res);
    expect(body.error).toMatchObject({ code: 'NOT_FOUND' });
  });

  it(`POST ${probe.listPath} returns 404 NOT_FOUND when plugins.three_pl is off`, async () => {
    setActiveMockState(makeStateGateOff());
    const req = new Request(`https://example.test${probe.listPath}`, {
      method: 'POST',
      headers: idemHeaders(),
      body: JSON.stringify(probe.createBody),
    });
    const res = await handler(req);
    expect(res.status).toBe(404);
    const body = await readJson(res);
    expect(body.error).toMatchObject({ code: 'NOT_FOUND' });
  });

  it(`PATCH ${probe.listPath}/:id returns 404 NOT_FOUND when plugins.three_pl is off`, async () => {
    setActiveMockState(makeStateGateOff());
    const fakeId = '00000000-0000-4000-8000-00000000ffff';
    const req = new Request(`https://example.test${probe.listPath}/${fakeId}`, {
      method: 'PATCH',
      headers: idemHeaders(),
      body: JSON.stringify({}),
    });
    const res = await handler(req);
    expect(res.status).toBe(404);
  });

  it(`DELETE ${probe.listPath}/:id returns 404 NOT_FOUND when plugins.three_pl is off`, async () => {
    setActiveMockState(makeStateGateOff());
    const fakeId = '00000000-0000-4000-8000-00000000ffff';
    const req = new Request(`https://example.test${probe.listPath}/${fakeId}`, {
      method: 'DELETE',
      headers: idemHeaders(),
    });
    const res = await handler(req);
    expect(res.status).toBe(404);
  });

  it(`GET ${probe.listPath} returns 200 + [] when plugins.three_pl is on (gate passes through)`, async () => {
    setActiveMockState(makeStateGateOn());
    const req = new Request(`https://example.test${probe.listPath}`, {
      method: 'GET',
      headers: { authorization: bearer(OWNER) },
    });
    const res = await handler(req);
    // Gate passed; we should NOT see a 404 from the dispatcher. Any
    // remaining 4xx is from downstream handler logic, not the gate.
    expect(res.status).not.toBe(404);
  });

  it(`OPTIONS ${probe.listPath} bypasses the gate (CORS preflight)`, async () => {
    setActiveMockState(makeStateGateOff());
    const req = new Request(`https://example.test${probe.listPath}`, {
      method: 'OPTIONS',
      headers: {
        origin: 'https://example.test',
        'access-control-request-method': 'GET',
      },
    });
    const res = await handler(req);
    // Preflight must NOT 404; the browser needs the CORS envelope to
    // learn the surface's allowed methods before any real request fires.
    expect(res.status).not.toBe(404);
  });
});
