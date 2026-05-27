// D-IDEMP-02 regression suite.
//
// Constitutional rule (CLAUDE.md, idempotency rules):
//   Every non-GET handler enforces `Idempotency-Key` (UUID v4). The 2026-05-27
//   drift audit caught admin-console-api's POST /orgs/impersonate leaking
//   501 NOT_IMPLEMENTED when called without an Idempotency-Key header. The
//   handler is a stub today but it is still a non-GET surface, so the
//   invariant applies. Wrapping the stub now also means no one has to
//   remember the wrapper when the real impersonation wiring lands.
//
// Gate order today on POST /orgs/impersonate:
//   1. assertBundleEnabled (platform_admin.enabled OFF -> 404)
//   2. requireCap (caller lacks admin.orgs.impersonate -> 403)
//   3. requireMfaVerified (no verified TOTP -> 403)
//   4. respondWithIdempotency wrapper (missing key -> 400, bad key -> 400)
//   5. stub handler (-> 501 NOT_IMPLEMENTED)
//
// The cap admin.orgs.impersonate is declared in the capability union but
// not granted to any role today (the bundle is deferred). To probe the
// wrapper, this suite mocks `hasCap` so the org_owner caller advances
// past the cap gate, then asserts the idempotency contract fires before
// the 501 path.

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

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

// Grant admin.orgs.impersonate to every role for this suite only. The cap
// is not granted in production today; mocking it lets us prove the
// wrapper sits between the cap gate and the stub.
vi.mock('../../../../supabase/functions/_shared/capabilities.ts', async () => {
  const actual = await vi.importActual<
    typeof import('../../../../supabase/functions/_shared/capabilities.ts')
  >('../../../../supabase/functions/_shared/capabilities.ts');
  return {
    ...actual,
    hasCap: (_role: unknown, cap: unknown) => {
      if (cap === 'admin.orgs.impersonate') return true;
      // Fall through to the real matrix for every other cap so we never
      // accidentally widen the surface.
      return (actual.hasCap as (r: unknown, c: unknown) => boolean)(_role, cap);
    },
  };
});

function makeAdminConsoleState() {
  // platform_admin.enabled must be on so assertBundleEnabled does not 404
  // before the idempotency check runs. has_verified_totp must return true
  // so requireMfaVerified does not 403 before the idempotency check runs.
  const state = makeState({
    org_feature_flags: [
      {
        org_id: ORG_A,
        flag_key: 'platform_admin.enabled',
        is_enabled: true,
        config: {},
      },
    ],
  });
  state.rpcResults['has_verified_totp'] = { data: true, error: null };
  return state;
}

async function readJsonStatus(res: Response): Promise<{
  status: number;
  json: { data?: unknown; error?: { code?: string; message?: string } };
}> {
  const text = await res.text();
  return { status: res.status, json: JSON.parse(text) };
}

describe('admin-console-api POST /orgs/impersonate - idempotency gate (D-IDEMP-02)', () => {
  let handler: (req: Request) => Promise<Response> | Response;

  beforeAll(async () => {
    installDenoShim();
    resetCapturedHandler();
    await import(
      '../../../../supabase/functions/admin-console-api/index.ts'
    );
    handler = capturedHandler();
  });

  afterEach(() => {
    invalidateFlagCache();
    clearActiveMockState();
  });

  it('missing Idempotency-Key returns 400 IDEMPOTENCY_KEY_REQUIRED before the 501 path', async () => {
    setActiveMockState(makeAdminConsoleState());
    const req = new Request('https://example.test/orgs/impersonate', {
      method: 'POST',
      headers: {
        authorization: bearer(OWNER),
        'content-type': 'application/json',
      },
    });
    const res = await handler(req);
    const { status, json } = await readJsonStatus(res);
    expect(status).toBe(400);
    expect(json.error?.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });

  it('malformed Idempotency-Key returns 400 IDEMPOTENCY_INVALID_KEY before the 501 path', async () => {
    setActiveMockState(makeAdminConsoleState());
    const req = new Request('https://example.test/orgs/impersonate', {
      method: 'POST',
      headers: {
        authorization: bearer(OWNER),
        'content-type': 'application/json',
        'idempotency-key': 'not-a-uuid',
      },
    });
    const res = await handler(req);
    const { status, json } = await readJsonStatus(res);
    expect(status).toBe(400);
    expect(json.error?.code).toBe('IDEMPOTENCY_INVALID_KEY');
  });

  it('valid Idempotency-Key surfaces the documented 501 NOT_IMPLEMENTED stub', async () => {
    // With every prior gate satisfied (bundle flag on, cap held, MFA
    // verified, idempotency-key valid), the stub itself is what the caller
    // sees. This pins the stub envelope so a later "real" impersonation
    // wave knows what shape it is replacing.
    setActiveMockState(makeAdminConsoleState());
    const req = new Request('https://example.test/orgs/impersonate', {
      method: 'POST',
      headers: {
        authorization: bearer(OWNER),
        'content-type': 'application/json',
        'idempotency-key': crypto.randomUUID(),
      },
    });
    const res = await handler(req);
    const { status, json } = await readJsonStatus(res);
    expect(status).toBe(501);
    expect(json.error?.code).toBe('NOT_IMPLEMENTED');
  });
});
