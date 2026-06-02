// Regression suite for Path B2.5a - POST /portal/request-signin-link in
// auth-api. This endpoint is the customer-portal re-entry surface; an
// anonymous caller posts their email and we ship a fresh magic link via
// the Resend chassis IF AND ONLY IF the email is bound to a customer_user
// org_membership. Every other case returns the same 200 envelope to
// prevent email-existence enumeration.
//
// Covers:
//   1. Anti-leak (200): unknown email returns the canonical envelope and
//      does NOT call generateLink + does NOT insert a notifications row.
//   2. Anti-leak (200): known email but no customer_user membership returns
//      the canonical envelope and does NOT call generateLink.
//   3. Happy path: known email + customer_user membership calls
//      generateLink({ type: 'magiclink' }) + inserts the notifications row
//      carrying the action_link via the email channel + still returns the
//      canonical envelope (no special success leak).
//   4. Anti-leak (200): generateLink internal error returns the canonical
//      envelope and does NOT insert a notifications row.
//   5. Anti-leak (200): malformed body returns the canonical envelope (no
//      4xx differentiator).
//   6. Email normalisation: trims + lowercases before lookup.

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

const ORG_A = '00000000-0000-4000-8000-0000000000a1';
const ORG_B = '00000000-0000-4000-8000-0000000000a2';
const CUSTOMER_USER_ID = '00000000-0000-4000-8000-0000000000b1';
const STAFF_USER_ID = '00000000-0000-4000-8000-0000000000b2';
const CUSTOMER_USER_EMAIL = 'customer@example.test';
const STAFF_EMAIL = 'ops@example.test';

const CANON_MESSAGE =
  'If that email is registered for a Kitstak customer portal, a sign-in link is on its way.';

function makeStateWithMemberships() {
  const state = makeState({
    org_memberships: [
      {
        org_id: ORG_A,
        user_id: CUSTOMER_USER_ID,
        role: { code: 'customer_user' },
        is_active: true,
      },
      {
        org_id: ORG_B,
        user_id: STAFF_USER_ID,
        role: { code: 'ops' },
        is_active: true,
      },
    ],
    // D7: the handler now resolves email -> user_id via a parameterised
    // profiles lookup, then loads the auth user by id (no listUsers filter
    // string). Seed profiles so the lookup can find the user.
    profiles: [
      { user_id: CUSTOMER_USER_ID, email: CUSTOMER_USER_EMAIL },
      { user_id: STAFF_USER_ID, email: STAFF_EMAIL },
    ],
  });
  // Echo the auth user by id with the matching email so the handler's
  // email-confirmation check passes.
  state.authAdminGetUserByIdResults = {
    [CUSTOMER_USER_ID]: {
      data: {
        user: {
          id: CUSTOMER_USER_ID,
          email: CUSTOMER_USER_EMAIL,
          email_confirmed_at: '2026-01-01T00:00:00Z',
        },
      },
      error: null,
    },
    [STAFF_USER_ID]: {
      data: {
        user: {
          id: STAFF_USER_ID,
          email: STAFF_EMAIL,
          email_confirmed_at: '2026-01-01T00:00:00Z',
        },
      },
      error: null,
    },
  };
  return state;
}

function readJsonStatus(res: Response): Promise<{
  status: number;
  json: { data?: { ok?: boolean; message?: string } };
}> {
  return res.text().then((t) => ({ status: res.status, json: JSON.parse(t) }));
}

function postSigninLink(
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
    'https://example.test/portal/request-signin-link',
    init,
  );
}

describe('auth-api POST /portal/request-signin-link - Path B2.5a', () => {
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

  it('anti-leak: unknown email returns canonical 200 envelope; no generateLink, no notifications', async () => {
    const state = makeStateWithMemberships();
    // profiles lookup misses (email not registered).
    setActiveMockState(state);

    const res = await handler(postSigninLink({ email: 'nobody@example.test' }));
    const { status, json } = await readJsonStatus(res);
    expect(status).toBe(200);
    expect(json.data?.ok).toBe(true);
    expect(json.data?.message).toBe(CANON_MESSAGE);
    expect(state.authAdminGenerateLinkCalls).toHaveLength(0);
    expect(
      state.inserts.filter((i) => i.table === 'notifications'),
    ).toHaveLength(0);
  });

  it('anti-leak: email exists but has no customer_user membership returns canonical 200; no generateLink', async () => {
    const state = makeStateWithMemberships();
    setActiveMockState(state);

    const res = await handler(postSigninLink({ email: STAFF_EMAIL }));
    const { status, json } = await readJsonStatus(res);
    expect(status).toBe(200);
    expect(json.data?.message).toBe(CANON_MESSAGE);
    expect(state.authAdminGenerateLinkCalls).toHaveLength(0);
    expect(
      state.inserts.filter((i) => i.table === 'notifications'),
    ).toHaveLength(0);
  });

  it('happy path: customer_user membership triggers generateLink + notifications row', async () => {
    const state = makeStateWithMemberships();
    state.authAdminGenerateLinkResult = {
      data: {
        user: { id: CUSTOMER_USER_ID, email: CUSTOMER_USER_EMAIL },
        properties: {
          action_link:
            'https://www.kitstak.com/portal#access_token=fresh&type=magiclink',
        },
      },
      error: null,
    };
    setActiveMockState(state);

    const res = await handler(postSigninLink({ email: CUSTOMER_USER_EMAIL }));
    const { status, json } = await readJsonStatus(res);
    expect(status).toBe(200);
    expect(json.data?.message).toBe(CANON_MESSAGE);

    expect(state.authAdminGenerateLinkCalls).toHaveLength(1);
    expect(state.authAdminGenerateLinkCalls[0]).toMatchObject({
      type: 'magiclink',
      email: CUSTOMER_USER_EMAIL,
      options: { redirectTo: 'https://www.kitstak.com/portal' },
    });

    const notifInsert = state.inserts.find((i) => i.table === 'notifications');
    expect(notifInsert).toBeDefined();
    expect(notifInsert?.row).toMatchObject({
      org_id: ORG_A,
      recipient_user_id: CUSTOMER_USER_ID,
      entity_type: 'auth',
      channel: 'email',
    });
    expect((notifInsert?.row.payload as Record<string, unknown>)?.to).toBe(
      CUSTOMER_USER_EMAIL,
    );
    expect((notifInsert?.row.payload as Record<string, unknown>)?.kind).toBe(
      'portal_signin',
    );
    expect(notifInsert?.row.body).toContain(
      'https://www.kitstak.com/portal#access_token=fresh&type=magiclink',
    );
    expect(notifInsert?.row.body).toContain('No password required');
  });

  it('anti-leak: generateLink internal error returns canonical 200; no notifications row', async () => {
    const state = makeStateWithMemberships();
    state.authAdminGenerateLinkResult = {
      data: { user: null, properties: null },
      error: { message: 'Rate limit exceeded' },
    };
    setActiveMockState(state);

    const res = await handler(postSigninLink({ email: CUSTOMER_USER_EMAIL }));
    const { status, json } = await readJsonStatus(res);
    expect(status).toBe(200);
    expect(json.data?.message).toBe(CANON_MESSAGE);
    expect(
      state.inserts.filter((i) => i.table === 'notifications'),
    ).toHaveLength(0);
  });

  it('anti-leak: malformed body returns canonical 200 envelope (no 4xx differentiator)', async () => {
    const state = makeStateWithMemberships();
    setActiveMockState(state);

    const res = await handler(postSigninLink('not-json-body'));
    const { status, json } = await readJsonStatus(res);
    expect(status).toBe(200);
    expect(json.data?.message).toBe(CANON_MESSAGE);
    expect(state.authAdminListUsersCalls).toHaveLength(0);
    expect(state.authAdminGenerateLinkCalls).toHaveLength(0);
  });

  it('normalises email (trim + lowercase) before lookup', async () => {
    const state = makeStateWithMemberships();
    state.authAdminGenerateLinkResult = {
      data: {
        user: { id: CUSTOMER_USER_ID, email: CUSTOMER_USER_EMAIL },
        properties: { action_link: 'https://www.kitstak.com/portal#token=x' },
      },
      error: null,
    };
    setActiveMockState(state);

    const res = await handler(
      postSigninLink({ email: '  CUSTOMER@Example.TEST  ' }),
    );
    expect(res.status).toBe(200);
    // The Zod schema trims + lowercases via .transform() before email
    // validation, so the handler should see the canonical
    // `customer@example.test`, resolve it through the profiles lookup, and
    // load the auth user by id (no listUsers filter string).
    expect(state.authAdminGetUserByIdCalls).toContain(CUSTOMER_USER_ID);
    // Generate was called with the normalised email too.
    expect(state.authAdminGenerateLinkCalls[0]?.email).toBe(
      CUSTOMER_USER_EMAIL,
    );
  });
});
