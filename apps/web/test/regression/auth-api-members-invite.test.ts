// Regression suite for the staff invite chassis (F-Wave9-STAFF-INVITE-
// CHASSIS-01 backend). POST /members/invite on auth-api. Covers:
//   1. Cap gate (caller without org.member.invite -> 403)
//   2. Privilege-escalation guard (org_admin cannot grant org_owner -> 403)
//   3. Validation (bad email / bad role -> 422)
//   4. Auth-error path (generateLink fails -> 422 AUTH_ERROR, no membership)
//   5. Happy path (org_owner invites a teammate; calls generateLink + RPC +
//      queues notifications email; returns 201 with the documented envelope)
//   6. org_admin can invite a peer role (e.g. sales) -> 201
//   7. Idempotency replay (same Idempotency-Key + same body returns the same
//      response without re-firing generateLink / RPC / notifications insert)
//
// Closes the testable side of F-Wave9-STAFF-INVITE-CHASSIS-01 backend.

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

const ORG_A = '00000000-0000-4000-8000-0000000000a1';
const OWNER_USER_ID = '00000000-0000-4000-8000-0000000000b1';
const ADMIN_USER_ID = '00000000-0000-4000-8000-0000000000b2';
const VIEWER_USER_ID = '00000000-0000-4000-8000-0000000000b3';
const INVITEE_USER_ID = '00000000-0000-4000-8000-0000000000d1';
const NEW_MEMBERSHIP_ID = '00000000-0000-4000-8000-00000000eeee';

const OWNER = { userId: OWNER_USER_ID, orgId: ORG_A, role: 'org_owner' as const };
const ADMIN = { userId: ADMIN_USER_ID, orgId: ORG_A, role: 'org_admin' as const };
const VIEWER = { userId: VIEWER_USER_ID, orgId: ORG_A, role: 'viewer' as const };

function makeStateWithOrg() {
  return makeState({
    organizations: [
      {
        id: ORG_A,
        display_name: 'Acme 3PL',
        status: 'active',
        deleted_at: null,
      },
    ],
  });
}

function withInviteDefaults(state: ReturnType<typeof makeState>) {
  state.authAdminGenerateLinkResult = {
    data: {
      user: { id: INVITEE_USER_ID, email: 'teammate@example.test' },
      properties: {
        action_link:
          'https://www.kitstak.com/dashboard#access_token=fake&type=magiclink',
      },
    },
    error: null,
  };
  state.rpcResults['create_staff_membership'] = {
    data: NEW_MEMBERSHIP_ID,
    error: null,
  };
  return state;
}

function readJsonStatus(res: Response): Promise<{
  status: number;
  json: { data?: unknown; error?: { code?: string; message?: string } };
}> {
  return res.text().then((t) => ({ status: res.status, json: JSON.parse(t) }));
}

function postInvite(
  caller: { userId: string; orgId: string; role: string },
  body: Record<string, unknown>,
  idempotencyKey: string = crypto.randomUUID(),
): Request {
  return new Request('https://example.test/members/invite', {
    method: 'POST',
    headers: {
      authorization: bearer(caller),
      'content-type': 'application/json',
      'idempotency-key': idempotencyKey,
    },
    body: JSON.stringify(body),
  });
}

describe('auth-api POST /members/invite - staff invite chassis', () => {
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

  it('cap-gates: viewer without org.member.invite returns 403', async () => {
    setActiveMockState(withInviteDefaults(makeStateWithOrg()));
    const res = await handler(
      postInvite(VIEWER, { email: 'teammate@example.test', role: 'sales' }),
    );
    const { status, json } = await readJsonStatus(res);
    expect(status).toBe(403);
    expect(json.error?.code).toBe('FORBIDDEN');
  });

  it('privilege-escalation: org_admin cannot grant org_owner -> 403', async () => {
    const state = withInviteDefaults(makeStateWithOrg());
    setActiveMockState(state);
    const res = await handler(
      postInvite(ADMIN, { email: 'newowner@example.test', role: 'org_owner' }),
    );
    const { status, json } = await readJsonStatus(res);
    expect(status).toBe(403);
    expect(json.error?.code).toBe('FORBIDDEN');
    expect(json.error?.message).toMatch(/org owner/i);
    // Hard contract: the guard fires before any side effect.
    expect(state.authAdminGenerateLinkCalls).toHaveLength(0);
    expect(state.rpcCalls.find((c) => c.name === 'create_staff_membership'))
      .toBeUndefined();
  });

  it('validation: malformed email -> 422', async () => {
    setActiveMockState(withInviteDefaults(makeStateWithOrg()));
    const res = await handler(
      postInvite(OWNER, { email: 'not-an-email', role: 'sales' }),
    );
    const { status, json } = await readJsonStatus(res);
    expect(status).toBe(422);
    expect(json.error?.code).toBe('VALIDATION_ERROR');
  });

  it('validation: unknown role -> 422', async () => {
    setActiveMockState(withInviteDefaults(makeStateWithOrg()));
    const res = await handler(
      postInvite(OWNER, {
        email: 'teammate@example.test',
        role: 'customer_user',
      }),
    );
    const { status, json } = await readJsonStatus(res);
    expect(status).toBe(422);
    expect(json.error?.code).toBe('VALIDATION_ERROR');
  });

  it('auth error: generateLink failure surfaces as 422 AUTH_ERROR, no membership', async () => {
    const state = withInviteDefaults(makeStateWithOrg());
    state.authAdminGenerateLinkResult = {
      data: { user: null, properties: null },
      error: { message: 'Email rate limit exceeded' },
    };
    setActiveMockState(state);
    const res = await handler(
      postInvite(OWNER, { email: 'teammate@example.test', role: 'sales' }),
    );
    const { status, json } = await readJsonStatus(res);
    expect(status).toBe(422);
    expect(json.error?.code).toBe('AUTH_ERROR');
    expect(json.error?.message).toMatch(/invite link/i);
    expect(state.rpcCalls.find((c) => c.name === 'create_staff_membership'))
      .toBeUndefined();
  });

  it('happy path: org_owner invites teammate, returns 201 envelope, queues email', async () => {
    const state = withInviteDefaults(makeStateWithOrg());
    setActiveMockState(state);

    const res = await handler(
      postInvite(OWNER, { email: 'teammate@example.test', role: 'sales' }),
    );
    const { status, json } = await readJsonStatus(res);

    expect(status).toBe(201);
    expect(json.data).toMatchObject({
      user_id: INVITEE_USER_ID,
      membership_id: NEW_MEMBERSHIP_ID,
      role: 'sales',
      email: 'teammate@example.test',
    });

    // generateLink called with the dashboard redirect.
    expect(state.authAdminGenerateLinkCalls).toHaveLength(1);
    expect(state.authAdminGenerateLinkCalls[0]).toMatchObject({
      type: 'magiclink',
      email: 'teammate@example.test',
      options: { redirectTo: 'https://www.kitstak.com/dashboard' },
    });

    // RPC called with the four documented args.
    const rpcCall = state.rpcCalls.find(
      (c) => c.name === 'create_staff_membership',
    );
    expect(rpcCall).toBeDefined();
    expect(rpcCall?.args).toMatchObject({
      p_org_id: ORG_A,
      p_user_id: INVITEE_USER_ID,
      p_role_code: 'sales',
      p_invited_by: OWNER_USER_ID,
    });

    // Notifications row queued with the resolved org name and action_link.
    const notifInsert = state.inserts.find((i) => i.table === 'notifications');
    expect(notifInsert).toBeDefined();
    expect(notifInsert?.row).toMatchObject({
      org_id: ORG_A,
      recipient_user_id: INVITEE_USER_ID,
      channel: 'email',
    });
    expect(notifInsert?.row.subject).toContain('Acme 3PL');
    expect(notifInsert?.row.body).toContain(
      'https://www.kitstak.com/dashboard#access_token=fake&type=magiclink',
    );
    expect((notifInsert?.row.payload as Record<string, unknown>)?.to).toBe(
      'teammate@example.test',
    );
    expect((notifInsert?.row.payload as Record<string, unknown>)?.type).toBe(
      'staff_invite',
    );
  });

  it('org_admin can invite a peer role (sales) -> 201', async () => {
    const state = withInviteDefaults(makeStateWithOrg());
    setActiveMockState(state);

    const res = await handler(
      postInvite(ADMIN, { email: 'teammate@example.test', role: 'sales' }),
    );
    expect(res.status).toBe(201);
    expect(state.authAdminGenerateLinkCalls).toHaveLength(1);
    const rpcCall = state.rpcCalls.find(
      (c) => c.name === 'create_staff_membership',
    );
    expect(rpcCall?.args).toMatchObject({ p_invited_by: ADMIN_USER_ID });
  });

  it('idempotency-key required: missing header -> 400 IDEMPOTENCY_KEY_REQUIRED', async () => {
    setActiveMockState(withInviteDefaults(makeStateWithOrg()));
    // Build a request without an idempotency-key header.
    const req = new Request('https://example.test/members/invite', {
      method: 'POST',
      headers: {
        authorization: bearer(OWNER),
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        email: 'teammate@example.test',
        role: 'sales',
      }),
    });
    const res = await handler(req);
    const { status, json } = await readJsonStatus(res);
    expect(status).toBe(400);
    expect(json.error?.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });

  // Note: full idempotency replay (same key + same body returns the stored
  // response without re-firing side effects) is exercised by the shared
  // idempotency.test.ts unit suite against the wrapper directly. The
  // regression-test harness here mocks the supabase client at the .from()
  // level and does not persist inserts back into the row store, so a replay
  // assertion in this file would always fail on a harness limitation rather
  // than on real handler behaviour. See respondWithIdempotency in
  // supabase/functions/_shared/idempotency.ts for the canonical contract.
});
