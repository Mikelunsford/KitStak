// Regression suite for GET /auth-api/me password_set
// (F-Wave10-WELCOME-PASSWORD-SERVER-GATE-01).
//
// getMe now reports whether the caller already has a password set, read from
// the service-role-only user_has_password RPC. The SPA uses it to show the
// "set a password" onboarding nudge only to users who have none, instead of
// re-nagging on a fresh browser / cleared storage.
//
// Coverage:
//   1. password_set is true when user_has_password returns true.
//   2. password_set is false when user_has_password returns false.
//   3. password_set defaults to true (suppress the nudge) when the lookup
//      errors, so a transient failure never breaks the dashboard load or
//      produces a spurious prompt.

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

const ORG_ID = '00000000-0000-4000-8000-0000000000a1';
const USER_ID = '00000000-0000-4000-8000-0000000000b1';
const CALLER = { userId: USER_ID, orgId: ORG_ID, role: 'org_owner' as const };

function meRequest(): Request {
  return new Request('https://example.test/me', {
    method: 'GET',
    headers: { authorization: bearer(CALLER) },
  });
}

function readJsonStatus(res: Response): Promise<{
  status: number;
  json: { data?: { password_set?: unknown }; error?: { code?: string } };
}> {
  return res.text().then((t) => ({ status: res.status, json: JSON.parse(t) }));
}

describe('auth-api GET /me - password_set server gate', () => {
  let handler: (req: Request) => Promise<Response> | Response;

  beforeAll(async () => {
    installDenoShim();
    resetCapturedHandler();
    await import('../../../../supabase/functions/auth-api/index.ts');
    handler = capturedHandler();
  });

  afterEach(() => {
    clearActiveMockState();
  });

  it('password_set is true when user_has_password returns true', async () => {
    const state = makeState({});
    state.rpcResults['user_has_password'] = { data: true, error: null };
    setActiveMockState(state);

    const res = await handler(meRequest());
    const { status, json } = await readJsonStatus(res);

    expect(status).toBe(200);
    expect(json.data?.password_set).toBe(true);
  });

  it('password_set is false when user_has_password returns false', async () => {
    const state = makeState({});
    state.rpcResults['user_has_password'] = { data: false, error: null };
    setActiveMockState(state);

    const res = await handler(meRequest());
    const { status, json } = await readJsonStatus(res);

    expect(status).toBe(200);
    expect(json.data?.password_set).toBe(false);
  });

  it('password_set defaults to true (suppress nudge) when the lookup errors', async () => {
    const state = makeState({});
    state.rpcResults['user_has_password'] = {
      data: null,
      error: { message: 'auth lookup failed' },
    };
    setActiveMockState(state);

    const res = await handler(meRequest());
    const { status, json } = await readJsonStatus(res);

    expect(status).toBe(200);
    expect(json.data?.password_set).toBe(true);
  });
});
