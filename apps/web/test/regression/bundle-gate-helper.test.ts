// Unit coverage for the shared bundle-gate dispatcher.
//
// F-Wave9-SALES-CONFIG-3PL-GATE-01. The gate helper grew an OR / anyOf
// predicate so cross-pillar bundles (crm-api, sales-config-api) stay
// reachable for any org holding ANY of the relevant pillar plugins, while
// still returning 404 when ALL are off. This suite exercises the dispatcher
// body (`bundleGateDispatch`) directly with a forged Request so we cover the
// predicate logic, OPTIONS bypass, org-less fall-through, and the
// fail-closed misconfiguration arms without binding a port.
//
// Constitutional rule (CLAUDE.md, 00-canon/01-architecture.md): plugin bundle
// gates return 404 NOT_FOUND. A 403 where a 404 is expected is a release
// blocker. The per-bundle integration probes (crm-api, sales-config-api) live
// in plugin-bundle-gate-crm-salesconfig.test.ts; this file is the helper's
// own unit test.
//
// The flag-key string literals are spelled out here on purpose: the test is
// verifying that exactly those canonical `plugins.*` wire strings gate the
// surface, so importing them from the same module under test would weaken
// the check. They match `_shared/constants.ts` FEATURE_FLAGS verbatim.

import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { installDenoShim } from './_helpers/deno-shim.ts';
import { makeState, bearer } from './_helpers/supabase-mock.ts';
import {
  setActiveMockState,
  clearActiveMockState,
} from './_helpers/supabase-stub.ts';
import type {
  BundleGateOptions,
} from '../../../../supabase/functions/_shared/bundleGate.ts';
import type { Route } from '../../../../supabase/functions/_shared/route.ts';

// Runtime bindings resolved in beforeAll AFTER the Deno shim is installed.
// The edge modules below transitively load `_shared/route.ts`, which calls
// `initSentry()` at module-eval time and reads `Deno.env`. A static import
// would run before any beforeAll and throw `Deno is not defined`, so we
// dynamic-import them once the shim is in place (the same ordering the
// per-bundle regression suites rely on).
let bundleGateDispatch: (
  req: Request,
  opts: BundleGateOptions,
) => Promise<Response>;
let invalidateFlagCache: (orgId?: string) => void;
let ok: (data: unknown) => Response;

const ORG_A = '00000000-0000-4000-8000-0000000000a1';
const USER_A = '00000000-0000-4000-8000-0000000000b1';
const OWNER = { userId: USER_A, orgId: ORG_A, role: 'org_owner' as const };

const BUNDLE = 'gate-helper-test';

const THREE_PL = 'plugins.three_pl';
const MANUFACTURING = 'plugins.manufacturing';
const COPACK = 'plugins.copack_ecom';
const KITCOST = 'plugins.kitcost';
const THREE_PILLARS = [THREE_PL, MANUFACTURING, COPACK] as const;

// A trivial route table whose single handler returns a sentinel 200 body.
// When the gate passes we should see this sentinel; when it fails we should
// see a 404 NOT_FOUND envelope minted by the dispatcher before the table runs.
const PASS_SENTINEL = { gate: 'passed' };
let ROUTES: Route[];

// Seed org_feature_flags so exactly the named keys resolve enabled for ORG_A.
// getFlag reads { is_enabled } per (org_id, flag_key); absent rows fail closed.
function stateWithEnabled(...enabledKeys: string[]) {
  return makeState({
    org_feature_flags: enabledKeys.map((flag_key) => ({
      org_id: ORG_A,
      flag_key,
      is_enabled: true,
      config: {},
    })),
  });
}

function getReq(path = '/probe'): Request {
  return new Request(`https://example.test/${BUNDLE}${path}`, {
    method: 'GET',
    headers: { authorization: bearer(OWNER) },
  });
}

async function readJson(
  res: Response,
): Promise<{ data?: unknown; error?: { code?: string } }> {
  return JSON.parse(await res.text());
}

beforeAll(async () => {
  installDenoShim();
  const gate = await import(
    /* @vite-ignore */ '../../../../supabase/functions/_shared/bundleGate.ts'
  );
  const flags = await import(
    /* @vite-ignore */ '../../../../supabase/functions/_shared/feature-flags.ts'
  );
  const responses = await import(
    /* @vite-ignore */ '../../../../supabase/functions/_shared/responses.ts'
  );
  bundleGateDispatch = gate.bundleGateDispatch;
  invalidateFlagCache = flags.invalidateFlagCache;
  ok = responses.ok;
  ROUTES = [{ method: 'GET', path: '/probe', handler: () => ok(PASS_SENTINEL) }];
});

afterEach(() => {
  clearActiveMockState();
  // getFlag caches per (org_id, flag_key) for 5 minutes; clear between cases
  // so a prior gate-on read cannot mask a subsequent gate-off probe.
  invalidateFlagCache(ORG_A);
});

describe('bundleGateDispatch: single flagKey (back-compat)', () => {
  it('returns 404 NOT_FOUND when the single flag is off', async () => {
    setActiveMockState(stateWithEnabled()); // no flags enabled
    const res = await bundleGateDispatch(getReq(), {
      flagKey: THREE_PL,
      routes: ROUTES,
      bundle: BUNDLE,
    });
    expect(res.status).toBe(404);
    expect((await readJson(res)).error).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('passes through to the route table when the single flag is on', async () => {
    setActiveMockState(stateWithEnabled(THREE_PL));
    const res = await bundleGateDispatch(getReq(), {
      flagKey: THREE_PL,
      routes: ROUTES,
      bundle: BUNDLE,
    });
    expect(res.status).toBe(200);
    expect((await readJson(res)).data).toMatchObject(PASS_SENTINEL);
  });

  it('returns 404 when a DIFFERENT flag is on (single-flag is exact)', async () => {
    setActiveMockState(stateWithEnabled(MANUFACTURING));
    const res = await bundleGateDispatch(getReq(), {
      flagKey: THREE_PL,
      routes: ROUTES,
      bundle: BUNDLE,
    });
    expect(res.status).toBe(404);
  });
});

describe('bundleGateDispatch: OR / anyOf flagKeys', () => {
  it('returns 404 NOT_FOUND when ALL listed flags are off', async () => {
    setActiveMockState(stateWithEnabled()); // none enabled
    const res = await bundleGateDispatch(getReq(), {
      flagKeys: THREE_PILLARS,
      routes: ROUTES,
      bundle: BUNDLE,
    });
    expect(res.status).toBe(404);
    expect((await readJson(res)).error).toMatchObject({ code: 'NOT_FOUND' });
  });

  // Prove the OR passes regardless of WHICH single pillar is on, including
  // the last entry so we know the loop does not stop early.
  it.each([THREE_PL, MANUFACTURING, COPACK])(
    'passes when only %s is on',
    async (flag) => {
      setActiveMockState(stateWithEnabled(flag));
      const res = await bundleGateDispatch(getReq(), {
        flagKeys: THREE_PILLARS,
        routes: ROUTES,
        bundle: BUNDLE,
      });
      expect(res.status).toBe(200);
      expect((await readJson(res)).data).toMatchObject(PASS_SENTINEL);
    },
  );

  it('passes when several listed flags are on', async () => {
    setActiveMockState(stateWithEnabled(MANUFACTURING, COPACK));
    const res = await bundleGateDispatch(getReq(), {
      flagKeys: THREE_PILLARS,
      routes: ROUTES,
      bundle: BUNDLE,
    });
    expect(res.status).toBe(200);
  });

  it('returns 404 when only an unrelated flag is on', async () => {
    setActiveMockState(stateWithEnabled(KITCOST));
    const res = await bundleGateDispatch(getReq(), {
      flagKeys: THREE_PILLARS,
      routes: ROUTES,
      bundle: BUNDLE,
    });
    expect(res.status).toBe(404);
  });
});

describe('bundleGateDispatch: OPTIONS preflight bypass', () => {
  it('does NOT 404 on OPTIONS even with all flags off (OR predicate)', async () => {
    setActiveMockState(stateWithEnabled()); // none enabled
    const req = new Request(`https://example.test/${BUNDLE}/probe`, {
      method: 'OPTIONS',
      headers: {
        origin: 'https://example.test',
        'access-control-request-method': 'GET',
      },
    });
    const res = await bundleGateDispatch(req, {
      flagKeys: THREE_PILLARS,
      routes: ROUTES,
      bundle: BUNDLE,
    });
    expect(res.status).not.toBe(404);
  });
});

describe('bundleGateDispatch: org-less caller fall-through', () => {
  // A caller with no resolvable org claim must NOT be gated at the dispatcher;
  // the gate only fires once an org_id resolves so an anonymous probe cannot
  // infer flag state. The request falls through to the route table, where the
  // handler's own requireCaller would issue UNAUTHORIZED / NO_ACTIVE_ORG. Our
  // sentinel handler has no auth check, so we observe the pass-through as 200.
  it('falls through to the route table when no org claim is present', async () => {
    setActiveMockState(stateWithEnabled()); // none enabled; must be ignored
    const req = new Request(`https://example.test/${BUNDLE}/probe`, {
      method: 'GET',
      // no Authorization header -> readCallerContext yields orgId: null
    });
    const res = await bundleGateDispatch(req, {
      flagKeys: THREE_PILLARS,
      routes: ROUTES,
      bundle: BUNDLE,
    });
    expect(res.status).toBe(200);
    expect((await readJson(res)).data).toMatchObject(PASS_SENTINEL);
  });
});

describe('bundleGateDispatch: misconfiguration fails closed', () => {
  it('returns 404 when neither flagKey nor flagKeys is supplied', async () => {
    setActiveMockState(stateWithEnabled(...THREE_PILLARS)); // all on
    const res = await bundleGateDispatch(getReq(), {
      routes: ROUTES,
      bundle: BUNDLE,
    } as BundleGateOptions);
    // Even with every plugin on, an undefined predicate must hide the bundle.
    expect(res.status).toBe(404);
  });

  it('returns 404 when both flagKey and flagKeys are supplied', async () => {
    setActiveMockState(stateWithEnabled(...THREE_PILLARS)); // all on
    const res = await bundleGateDispatch(getReq(), {
      flagKey: THREE_PL,
      flagKeys: THREE_PILLARS,
      routes: ROUTES,
      bundle: BUNDLE,
    });
    expect(res.status).toBe(404);
  });

  it('returns 404 when flagKeys is an empty array', async () => {
    setActiveMockState(stateWithEnabled(...THREE_PILLARS)); // all on
    const res = await bundleGateDispatch(getReq(), {
      flagKeys: [],
      routes: ROUTES,
      bundle: BUNDLE,
    });
    expect(res.status).toBe(404);
  });
});
