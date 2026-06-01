// Regression suite for F-Wave7-UUID-GUARD-01 — handler-boundary UUID guard.
//
// Audit finding (PR #27 / F-Wave6-WAREHOUSE-CREATE-01):
//   A Sidebar link pointed at /3pl-operations/warehouses/new while no /new
//   route was registered. The SPA fell through to /:id with id="new", the
//   handler cast "new" to a Postgres UUID, and 22P02 surfaced as 500.
//
// Defense-in-depth fix (this test):
//   Every handler that reads a :id-style path segment now calls
//   parseUuidParam() before any DB call. A non-UUID lands in
//   400 BAD_REQUEST { code: 'BAD_REQUEST', details: { param, got } }
//   instead of 500 INTERNAL_ERROR.
//
// The SPA-side fix shipped in PR #27 (`/new` registered before `/:id`).
// This test guards the server boundary so any future SPA regression
// still produces a structured 400, not a 500.
//
// We exercise three representative handlers across three bundles:
//   * inventory-api      GET /warehouses/:id      (the original repro)
//   * crm-api            GET /customers/:id       (handlers-as-module style)
//   * vendors-api        GET /vendors/:id         (factory-route style)
//
// The valid-UUID happy path remains unchanged; the rls-probe matrix is the
// authority on that and stays at 48/48 on the PR build. This file only
// asserts the 500-to-400 conversion on the negative path.

import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
  installDenoShim,
  capturedHandler,
  resetCapturedHandler,
} from './_helpers/deno-shim.ts';
import {
  makeState,
  bearer,
} from './_helpers/supabase-mock.ts';
import {
  setActiveMockState,
  clearActiveMockState,
} from './_helpers/supabase-stub.ts';
import { invalidateFlagCache } from '../../../../supabase/functions/_shared/feature-flags.ts';

const ORG_A = '00000000-0000-4000-8000-0000000000a1';
// inventory-api bundle gate (F-Wave9-COWORK-SMOKE-06); without this row
// the dispatcher 404s before the UUID guard fires.
const THREE_PL_ON: Array<Record<string, unknown>> = [
  { org_id: ORG_A, flag_key: 'plugins.three_pl', is_enabled: true, config: {} },
];
const USER_A = '00000000-0000-4000-8000-0000000000b1';
const OWNER = { userId: USER_A, orgId: ORG_A, role: 'org_owner' as const };

async function readJson(res: Response): Promise<{ error: { code: string; message: string; details?: Record<string, unknown> } }> {
  return JSON.parse(await res.text()) as { error: { code: string; message: string; details?: Record<string, unknown> } };
}

describe('F-Wave7-UUID-GUARD-01 — handler-boundary UUID guard', () => {
  let handler: (req: Request) => Promise<Response> | Response;

  describe('inventory-api GET /warehouses/:id', () => {
    beforeAll(async () => {
      installDenoShim();
      resetCapturedHandler();
      // Vitest caches modules per URL; load this handler in its own beforeAll
      // so the captured handler matches the bundle under test.
      await import('../../../../supabase/functions/inventory-api/index.ts');
      handler = capturedHandler();
    });

    afterEach(() => {
      clearActiveMockState();
      invalidateFlagCache(ORG_A);
    });

    it('rejects non-UUID :id with 400 BAD_REQUEST + structured details', async () => {
      setActiveMockState(makeState({ warehouses: [], org_feature_flags: THREE_PL_ON }));

      const req = new Request('https://example.test/warehouses/new', {
        method: 'GET',
        headers: { authorization: bearer(OWNER) },
      });
      const res = await handler(req);

      expect(res.status).toBe(400);
      const body = await readJson(res);
      expect(body.error.code).toBe('BAD_REQUEST');
      expect(body.error.message).toMatch(/Invalid UUID/i);
      expect(body.error.details).toEqual({ param: 'id', got: 'new' });
    });

    it('accepts a valid UUID and proceeds past the guard (404 because empty fixture, not 400)', async () => {
      setActiveMockState(makeState({ warehouses: [], org_feature_flags: THREE_PL_ON }));

      const req = new Request(
        `https://example.test/warehouses/${ORG_A}`,
        {
          method: 'GET',
          headers: { authorization: bearer(OWNER) },
        },
      );
      const res = await handler(req);

      // Empty fixture → handler hits `maybeSingle()` and throws NOT_FOUND.
      // What we care about: not 400 (guard passed) and not 500 (no cast error).
      expect(res.status).toBe(404);
      const body = await readJson(res);
      expect(body.error.code).toBe('NOT_FOUND');
    });
  });

  describe('crm-api GET /customers/:id', () => {
    beforeAll(async () => {
      installDenoShim();
      resetCapturedHandler();
      await import('../../../../supabase/functions/crm-api/index.ts');
      handler = capturedHandler();
    });

    afterEach(() => {
      clearActiveMockState();
      invalidateFlagCache(ORG_A);
    });

    it('rejects non-UUID :id with 400 BAD_REQUEST before any DB call', async () => {
      // crm-api now gates on the three commerce pillar plugins (OR predicate)
      // per F-Wave9-SALES-CONFIG-3PL-GATE-01; without an enabled pillar the
      // dispatcher 404s before the UUID guard fires.
      setActiveMockState(makeState({ customers: [], org_feature_flags: THREE_PL_ON }));

      const req = new Request('https://example.test/customers/not-a-uuid', {
        method: 'GET',
        headers: { authorization: bearer(OWNER) },
      });
      const res = await handler(req);

      expect(res.status).toBe(400);
      const body = await readJson(res);
      expect(body.error.code).toBe('BAD_REQUEST');
      expect(body.error.details).toEqual({ param: 'id', got: 'not-a-uuid' });
    });
  });

  describe('vendors-api GET /vendors/:id', () => {
    beforeAll(async () => {
      installDenoShim();
      resetCapturedHandler();
      await import('../../../../supabase/functions/vendors-api/index.ts');
      handler = capturedHandler();
    });

    afterEach(() => clearActiveMockState());

    it('rejects non-UUID :id with 400 BAD_REQUEST + structured details', async () => {
      setActiveMockState(makeState({ vendors: [] }));

      const req = new Request('https://example.test/vendors/123', {
        method: 'GET',
        headers: { authorization: bearer(OWNER) },
      });
      const res = await handler(req);

      expect(res.status).toBe(400);
      const body = await readJson(res);
      expect(body.error.code).toBe('BAD_REQUEST');
      expect(body.error.details).toEqual({ param: 'id', got: '123' });
    });
  });
});
