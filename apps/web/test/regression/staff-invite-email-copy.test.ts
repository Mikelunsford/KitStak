// Regression suite for F-Wave9-INVITE-EMAIL-SUBJECT-COPY-01. The staff
// invite email subject + body must read with the inviting org's display
// name carrying the message. Prior copy read "You have been invited to
// {org} on Kitstak" which collapsed to "You have been invited to Kitstak
// on Kitstak" whenever the inviting org's display_name was literally
// "Kitstak". Rephrased to drop the "on Kitstak" suffix from the subject.
//
// Covers:
//   1. Subject uses "You have been invited to join {orgDisplayName}" and
//      does NOT contain the literal "on Kitstak" suffix.
//   2. Body opens with "You have been invited to join {orgDisplayName} on
//      Kitstak." so the destination is clear even when the subject is
//      truncated by a mail client.
//   3. Fallback: when the organizations lookup errors, the handler must
//      still ship an invite (membership already exists) but the copy
//      falls back to the literal "Kitstak" rather than 500ing the route.

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
const INVITEE_USER_ID = '00000000-0000-4000-8000-0000000000d1';
const NEW_MEMBERSHIP_ID = '00000000-0000-4000-8000-00000000eeee';

const OWNER = { userId: OWNER_USER_ID, orgId: ORG_A, role: 'org_owner' as const };

function makeStateWithOrg(displayName: string) {
  return makeState({
    organizations: [
      {
        id: ORG_A,
        display_name: displayName,
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

describe('auth-api POST /members/invite - email copy (F-Wave9-INVITE-EMAIL-SUBJECT-COPY-01)', () => {
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

  it('subject reads "You have been invited to join {orgDisplayName}" and drops the "on Kitstak" suffix', async () => {
    const state = withInviteDefaults(makeStateWithOrg('Acme 3PL'));
    setActiveMockState(state);

    const res = await handler(
      postInvite(OWNER, { email: 'teammate@example.test', role: 'sales' }),
    );
    expect(res.status).toBe(201);

    const notifInsert = state.inserts.find((i) => i.table === 'notifications');
    expect(notifInsert).toBeDefined();
    const subject = notifInsert?.row.subject as string;
    expect(subject).toBe('You have been invited to join Acme 3PL');
    // Hard contract: the awkward "on Kitstak" suffix must not appear in the
    // subject. The org name carries the destination.
    expect(subject).not.toMatch(/on Kitstak/i);
  });

  it('subject does not collapse to "Kitstak on Kitstak" when the inviting org is literally named Kitstak', async () => {
    const state = withInviteDefaults(makeStateWithOrg('Kitstak'));
    setActiveMockState(state);

    const res = await handler(
      postInvite(OWNER, { email: 'teammate@example.test', role: 'sales' }),
    );
    expect(res.status).toBe(201);

    const notifInsert = state.inserts.find((i) => i.table === 'notifications');
    const subject = notifInsert?.row.subject as string;
    expect(subject).toBe('You have been invited to join Kitstak');
    expect(subject).not.toMatch(/Kitstak on Kitstak/);
  });

  it('body opens with "You have been invited to join {orgDisplayName} on Kitstak."', async () => {
    const state = withInviteDefaults(makeStateWithOrg('Acme 3PL'));
    setActiveMockState(state);

    const res = await handler(
      postInvite(OWNER, { email: 'teammate@example.test', role: 'sales' }),
    );
    expect(res.status).toBe(201);

    const notifInsert = state.inserts.find((i) => i.table === 'notifications');
    const body = notifInsert?.row.body as string;
    expect(body).toContain('You have been invited to join Acme 3PL on Kitstak.');
    // Action link still embedded so the invitee can click through.
    expect(body).toContain(
      'https://www.kitstak.com/dashboard#access_token=fake&type=magiclink',
    );
    // Expiry copy still present.
    expect(body).toContain('This link expires in 24 hours.');
  });

  it('fallback: when the organizations row is missing, subject + body fall back to literal "Kitstak" and the invite still ships (201)', async () => {
    // makeState with NO organizations row: the org lookup via maybeSingle()
    // returns { data: null, error: null }. The handler's fallback branch
    // (orgRow null OR orgLookupErr present) must hold the literal "Kitstak"
    // rather than 500ing the route. The membership already exists so the
    // invitee can still sign in via the magic link.
    const state = withInviteDefaults(
      makeState({
        organizations: [],
      }),
    );
    setActiveMockState(state);

    const res = await handler(
      postInvite(OWNER, { email: 'teammate@example.test', role: 'sales' }),
    );
    // Membership creation succeeded so the invite still ships.
    expect(res.status).toBe(201);

    const notifInsert = state.inserts.find((i) => i.table === 'notifications');
    expect(notifInsert).toBeDefined();
    const subject = notifInsert?.row.subject as string;
    const body = notifInsert?.row.body as string;
    // Fallback path: org display_name is unknown so the literal product
    // name carries the message. Acceptable degraded shape; better than a 500.
    expect(subject).toBe('You have been invited to join Kitstak');
    expect(body).toContain('You have been invited to join Kitstak on Kitstak.');
  });
});
