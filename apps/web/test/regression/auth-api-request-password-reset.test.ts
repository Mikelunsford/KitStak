// Regression suite for the password-reset chassis (F-Wave9-INVITE-PASSWORD-
// SETUP-01 backend). POST /auth/request-password-reset on auth-api.
//
// Public, anti-enumeration endpoint. Mirrors the posture of
// /portal/request-signin-link: every code path returns the same envelope
// `{ accepted: true }` with status 200 regardless of whether the email
// resolves to an auth.users row, whether generateLink succeeds, or whether
// the notifications insert errors. The only differentiator a probe could
// observe is timing.
//
// Covers:
//   1. Anti-leak: unknown email -> 200, accepted:true, no generateLink call,
//      no notifications insert.
//   2. Anti-leak: generateLink internal error -> 200, no notifications row.
//   3. Anti-leak: malformed body -> 200, no listUsers call, no generateLink.
//   4. Happy path: known email -> generateLink(type=recovery), queues a
//      notifications row with org_id null + entity_type 'auth' + the
//      payload.kind tag.
//   5. Email normalisation: trim + lowercase before lookup.

import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
  installDenoShim,
  capturedHandler,
  resetCapturedHandler,
} from './_helpers/deno-shim.ts';
import { makeState } from './_helpers/supabase-mock.ts';
import {
  setActiveMockState,
  clearActiveMockState,
} from './_helpers/supabase-stub.ts';

const USER_ID = '00000000-0000-4000-8000-0000000000c1';
const USER_EMAIL = 'operator@example.test';

function postReset(
  body: Record<string, unknown> | string | undefined,
): Request {
  const init: RequestInit = {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'idempotency-key': crypto.randomUUID(),
    },
  };
  if (body !== undefined) {
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
  }
  return new Request(
    'https://example.test/auth/request-password-reset',
    init,
  );
}

function readJsonStatus(res: Response): Promise<{
  status: number;
  json: { data?: { accepted?: boolean }; error?: { code?: string } };
}> {
  return res.text().then((t) => ({ status: res.status, json: JSON.parse(t) }));
}

describe('auth-api POST /auth/request-password-reset - F-Wave9-INVITE-PASSWORD-SETUP-01', () => {
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

  it('anti-leak: unknown email returns 200 accepted:true with no side effects', async () => {
    const state = makeState();
    state.authAdminListUsersResult = { data: { users: [] }, error: null };
    setActiveMockState(state);

    const res = await handler(postReset({ email: 'nobody@example.test' }));
    const { status, json } = await readJsonStatus(res);

    expect(status).toBe(200);
    expect(json.data?.accepted).toBe(true);
    expect(state.authAdminGenerateLinkCalls).toHaveLength(0);
    expect(
      state.inserts.filter((i) => i.table === 'notifications'),
    ).toHaveLength(0);
  });

  it('anti-leak: generateLink internal error returns 200; no notifications row', async () => {
    const state = makeState();
    state.authAdminListUsersResult = {
      data: { users: [{ id: USER_ID, email: USER_EMAIL }] },
      error: null,
    };
    state.authAdminGenerateLinkResult = {
      data: { user: null, properties: null },
      error: { message: 'Rate limit exceeded' },
    };
    setActiveMockState(state);

    const res = await handler(postReset({ email: USER_EMAIL }));
    const { status, json } = await readJsonStatus(res);
    expect(status).toBe(200);
    expect(json.data?.accepted).toBe(true);
    expect(
      state.inserts.filter((i) => i.table === 'notifications'),
    ).toHaveLength(0);
  });

  it('anti-leak: malformed body returns 200 accepted:true (no 4xx differentiator)', async () => {
    const state = makeState();
    setActiveMockState(state);

    const res = await handler(postReset('not-json-body'));
    const { status, json } = await readJsonStatus(res);
    expect(status).toBe(200);
    expect(json.data?.accepted).toBe(true);
    expect(state.authAdminListUsersCalls).toHaveLength(0);
    expect(state.authAdminGenerateLinkCalls).toHaveLength(0);
  });

  it('happy path: known email triggers recovery generateLink + queues notifications row', async () => {
    const state = makeState();
    state.authAdminListUsersResult = {
      data: { users: [{ id: USER_ID, email: USER_EMAIL }] },
      error: null,
    };
    state.authAdminGenerateLinkResult = {
      data: {
        user: { id: USER_ID, email: USER_EMAIL },
        properties: {
          action_link:
            'https://www.kitstak.com/auth/recovery#access_token=fresh&type=recovery',
        },
      },
      error: null,
    };
    setActiveMockState(state);

    const res = await handler(postReset({ email: USER_EMAIL }));
    const { status, json } = await readJsonStatus(res);
    expect(status).toBe(200);
    expect(json.data?.accepted).toBe(true);

    expect(state.authAdminGenerateLinkCalls).toHaveLength(1);
    expect(state.authAdminGenerateLinkCalls[0]).toMatchObject({
      type: 'recovery',
      email: USER_EMAIL,
      options: { redirectTo: 'https://www.kitstak.com/auth/recovery' },
    });

    const notifInsert = state.inserts.find((i) => i.table === 'notifications');
    expect(notifInsert).toBeDefined();
    expect(notifInsert?.row).toMatchObject({
      org_id: null,
      recipient_user_id: USER_ID,
      entity_type: 'auth',
      channel: 'email',
    });
    expect((notifInsert?.row.payload as Record<string, unknown>)?.kind).toBe(
      'password_reset',
    );
    expect((notifInsert?.row.payload as Record<string, unknown>)?.to).toBe(
      USER_EMAIL,
    );
    expect(notifInsert?.row.body).toContain(
      'https://www.kitstak.com/auth/recovery#access_token=fresh&type=recovery',
    );
    expect(notifInsert?.row.body).toContain('expires in one hour');
  });

  it('normalises email (trim + lowercase) before lookup', async () => {
    const state = makeState();
    state.authAdminListUsersResult = {
      data: { users: [{ id: USER_ID, email: USER_EMAIL }] },
      error: null,
    };
    state.authAdminGenerateLinkResult = {
      data: {
        user: { id: USER_ID, email: USER_EMAIL },
        properties: { action_link: 'https://www.kitstak.com/auth/recovery#tok=x' },
      },
      error: null,
    };
    setActiveMockState(state);

    const res = await handler(postReset({ email: '  OPERATOR@Example.TEST  ' }));
    expect(res.status).toBe(200);
    expect(state.authAdminListUsersCalls).toHaveLength(1);
    expect(state.authAdminListUsersCalls[0]?.filter).toContain(USER_EMAIL);
    expect(state.authAdminGenerateLinkCalls[0]?.email).toBe(USER_EMAIL);
  });
});
