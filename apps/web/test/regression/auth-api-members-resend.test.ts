// Regression suite for POST /members/:user_id/resend
// (F-Wave9-STAFF-INVITE-RESEND-01 backend). Covers:
//   1. Cap gate: org_admin allowed; viewer and sales denied.
//   2. Cross-tenant target returns 404 (Pattern A).
//   3. Already-claimed target returns 422 MEMBER_ALREADY_CLAIMED.
//   4. Happy path: generateLink called with magiclink type and dashboard
//      redirect, notifications row queued through the email channel,
//      response shape is { status: 'sent', resent_at }.
//   5. Idempotency-Key required.
//
// The notifications-queue failure path mirrors the invite handler posture:
// failure is logged but does NOT unwind the resend (the membership exists
// and the magic link was generated; the operator can re-click Resend to
// retry queueing).

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
const ORG_B = '00000000-0000-4000-8000-0000000000a2';

const OWNER_USER_ID      = '00000000-0000-4000-8000-0000000000b1';
const VIEWER_USER_ID     = '00000000-0000-4000-8000-0000000000b2';
const SALES_USER_ID      = '00000000-0000-4000-8000-0000000000b3';
const UNCLAIMED_USER_ID  = '00000000-0000-4000-8000-0000000000c1';
const CLAIMED_USER_ID    = '00000000-0000-4000-8000-0000000000c2';
const ORG_B_USER_ID      = '00000000-0000-4000-8000-0000000000c3';

const OWNER  = { userId: OWNER_USER_ID,  orgId: ORG_A, role: 'org_owner' as const };
const VIEWER = { userId: VIEWER_USER_ID, orgId: ORG_A, role: 'viewer'    as const };
const SALES  = { userId: SALES_USER_ID,  orgId: ORG_A, role: 'sales'     as const };

function makeResendState() {
  const state = makeState({
    org_memberships: [
      {
        id: '00000000-0000-4000-8000-00000000f001',
        user_id: UNCLAIMED_USER_ID,
        org_id: ORG_A,
        is_active: true,
        created_at: '2026-05-03T10:00:00Z',
        role: { code: 'sales' },
      },
      {
        id: '00000000-0000-4000-8000-00000000f002',
        user_id: CLAIMED_USER_ID,
        org_id: ORG_A,
        is_active: true,
        created_at: '2026-05-04T10:00:00Z',
        role: { code: 'sales' },
      },
      {
        id: '00000000-0000-4000-8000-00000000f003',
        user_id: ORG_B_USER_ID,
        org_id: ORG_B,
        is_active: true,
        created_at: '2026-05-05T10:00:00Z',
        role: { code: 'org_owner' },
      },
    ],
    organizations: [
      { id: ORG_A, display_name: 'Acme 3PL', status: 'active', deleted_at: null },
    ],
  });
  // Per-user auth.users overrides so the handler can read email_confirmed_at.
  state.authAdminGetUserByIdResults[UNCLAIMED_USER_ID] = {
    data: {
      user: {
        id: UNCLAIMED_USER_ID,
        email: 'unclaimed@example.test',
        email_confirmed_at: null,
      },
    },
    error: null,
  };
  state.authAdminGetUserByIdResults[CLAIMED_USER_ID] = {
    data: {
      user: {
        id: CLAIMED_USER_ID,
        email: 'claimed@example.test',
        email_confirmed_at: '2026-05-04T11:00:00Z',
      },
    },
    error: null,
  };
  state.authAdminGetUserByIdResults[ORG_B_USER_ID] = {
    data: {
      user: {
        id: ORG_B_USER_ID,
        email: 'orgb@example.test',
        email_confirmed_at: null,
      },
    },
    error: null,
  };
  state.authAdminGenerateLinkResult = {
    data: {
      user: {
        id: UNCLAIMED_USER_ID,
        email: 'unclaimed@example.test',
      },
      properties: {
        action_link:
          'https://www.kitstak.com/dashboard#access_token=fresh&type=magiclink',
      },
    },
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

function postResend(
  caller: { userId: string; orgId: string; role: string },
  targetUserId: string,
  idempotencyKey: string = crypto.randomUUID(),
): Request {
  return new Request(
    `https://example.test/members/${targetUserId}/resend`,
    {
      method: 'POST',
      headers: {
        authorization: bearer(caller),
        'content-type': 'application/json',
        'idempotency-key': idempotencyKey,
      },
      body: JSON.stringify({}),
    },
  );
}

describe('auth-api POST /members/:user_id/resend - per-row resend invite', () => {
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

  it('cap-gates: viewer is denied (org.member.resend not granted) -> 403', async () => {
    setActiveMockState(makeResendState());
    const res = await handler(postResend(VIEWER, UNCLAIMED_USER_ID));
    const { status, json } = await readJsonStatus(res);
    expect(status).toBe(403);
    expect(json.error?.code).toBe('FORBIDDEN');
  });

  it('cap-gates: sales is denied (org.member.resend not granted) -> 403', async () => {
    setActiveMockState(makeResendState());
    const res = await handler(postResend(SALES, UNCLAIMED_USER_ID));
    const { status, json } = await readJsonStatus(res);
    expect(status).toBe(403);
    expect(json.error?.code).toBe('FORBIDDEN');
  });

  it('cross-tenant target returns 404 (Pattern A)', async () => {
    setActiveMockState(makeResendState());
    const res = await handler(postResend(OWNER, ORG_B_USER_ID));
    const { status, json } = await readJsonStatus(res);
    expect(status).toBe(404);
    expect(json.error?.code).toBe('NOT_FOUND');
  });

  it('already-claimed target returns 422 MEMBER_ALREADY_CLAIMED', async () => {
    const state = makeResendState();
    setActiveMockState(state);
    const res = await handler(postResend(OWNER, CLAIMED_USER_ID));
    const { status, json } = await readJsonStatus(res);
    expect(status).toBe(422);
    expect(json.error?.code).toBe('MEMBER_ALREADY_CLAIMED');
    // Hard contract: the guard fires before any link generation or notify.
    expect(state.authAdminGenerateLinkCalls).toHaveLength(0);
    expect(state.inserts.find((i) => i.table === 'notifications'))
      .toBeUndefined();
  });

  it('happy path: generates magic link, queues notifications email, returns sent envelope', async () => {
    const state = makeResendState();
    setActiveMockState(state);
    const res = await handler(postResend(OWNER, UNCLAIMED_USER_ID));
    const { status, json } = await readJsonStatus(res);

    expect(status).toBe(200);
    expect(json.data).toMatchObject({ status: 'sent' });
    expect(typeof (json.data as Record<string, unknown>)?.resent_at).toBe(
      'string',
    );

    // generateLink called with magiclink type and the dashboard redirect.
    expect(state.authAdminGenerateLinkCalls).toHaveLength(1);
    expect(state.authAdminGenerateLinkCalls[0]).toMatchObject({
      type: 'magiclink',
      email: 'unclaimed@example.test',
      options: { redirectTo: 'https://www.kitstak.com/dashboard' },
    });

    // Notifications row queued through the email channel with the org name
    // and the fresh action_link in the body.
    const notifInsert = state.inserts.find((i) => i.table === 'notifications');
    expect(notifInsert).toBeDefined();
    expect(notifInsert?.row).toMatchObject({
      org_id: ORG_A,
      recipient_user_id: UNCLAIMED_USER_ID,
      channel: 'email',
    });
    expect(notifInsert?.row.subject).toContain('Acme 3PL');
    expect(notifInsert?.row.body).toContain(
      'https://www.kitstak.com/dashboard#access_token=fresh&type=magiclink',
    );
    expect((notifInsert?.row.payload as Record<string, unknown>)?.to).toBe(
      'unclaimed@example.test',
    );
    expect((notifInsert?.row.payload as Record<string, unknown>)?.type).toBe(
      'staff_invite_resend',
    );

    // Response intentionally does NOT echo the magic link.
    expect(JSON.stringify(json.data)).not.toContain('action_link');
    expect(JSON.stringify(json.data)).not.toContain('access_token');
  });

  it('idempotency-key required: missing header -> 400 IDEMPOTENCY_KEY_REQUIRED', async () => {
    setActiveMockState(makeResendState());
    const req = new Request(
      `https://example.test/members/${UNCLAIMED_USER_ID}/resend`,
      {
        method: 'POST',
        headers: {
          authorization: bearer(OWNER),
          'content-type': 'application/json',
        },
        body: JSON.stringify({}),
      },
    );
    const res = await handler(req);
    const { status, json } = await readJsonStatus(res);
    expect(status).toBe(400);
    expect(json.error?.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });
});
