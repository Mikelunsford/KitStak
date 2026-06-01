// Regression suite for Path B2 - POST /customers/:id/invite-to-portal in
// crm-api, MAGICLINK-01 revision. Covers:
//   1. Capability gate (caller without crm.customers.invite_to_portal -> 403)
//   2. Missing recipient (no primary_email + no override -> 422)
//   3. Happy path (calls auth.admin.generateLink with type=magiclink + the
//      portal redirectTo, calls create_portal_membership RPC, queues a
//      notifications row carrying the action_link via the email channel,
//      returns the membership_id + user_id + email + customer_id envelope)
//   4. Tenant guard (customer from a different org -> 404)
//   5. email_override beats customer.primary_email
//
// Closes the testable side of F-Wave9-PORTAL-INVITE-MAGICLINK-01.

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
const USER_A = '00000000-0000-4000-8000-0000000000b1';
const CUSTOMER_A = '00000000-0000-4000-8000-0000000000c1';
const CUSTOMER_NO_EMAIL = '00000000-0000-4000-8000-0000000000c2';
const CUSTOMER_OTHER_ORG = '00000000-0000-4000-8000-0000000000c3';
const NEW_USER_ID = '00000000-0000-4000-8000-0000000000d1';

const OWNER = { userId: USER_A, orgId: ORG_A, role: 'org_owner' as const };
const VIEWER = { userId: USER_A, orgId: ORG_A, role: 'viewer' as const };

function makeStateWithCustomers() {
  return makeState({
    // crm-api now gates on the three commerce pillar plugins (OR predicate)
    // per F-Wave9-SALES-CONFIG-3PL-GATE-01. Enable plugins.three_pl so the
    // bundle dispatcher passes the gate and these handler-level assertions
    // reach the route table instead of the 404 surface.
    org_feature_flags: [
      { org_id: ORG_A, flag_key: 'plugins.three_pl', is_enabled: true, config: {} },
    ],
    customers: [
      {
        id: CUSTOMER_A,
        org_id: ORG_A,
        display_name: 'Acme Co.',
        kind: 'business',
        status: 'active',
        primary_email: 'customer@example.test',
        primary_phone: null,
        tax_id: null,
        billing_address: null,
        shipping_address: null,
        default_currency_code: 'USD',
        default_payment_terms_days: null,
        tags: [],
        deleted_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        id: CUSTOMER_NO_EMAIL,
        org_id: ORG_A,
        display_name: 'No Email Co.',
        kind: 'business',
        status: 'active',
        primary_email: null,
        primary_phone: null,
        tax_id: null,
        billing_address: null,
        shipping_address: null,
        default_currency_code: 'USD',
        default_payment_terms_days: null,
        tags: [],
        deleted_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        id: CUSTOMER_OTHER_ORG,
        org_id: ORG_B,
        display_name: 'Other Tenant Co.',
        kind: 'business',
        status: 'active',
        primary_email: 'other@example.test',
        primary_phone: null,
        tax_id: null,
        billing_address: null,
        shipping_address: null,
        default_currency_code: 'USD',
        default_payment_terms_days: null,
        tags: [],
        deleted_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ],
  });
}

function readJsonStatus(res: Response): Promise<{
  status: number;
  json: { data?: unknown; error?: { code?: string; message?: string } };
}> {
  return res.text().then((t) => ({ status: res.status, json: JSON.parse(t) }));
}

function postInvite(
  customerId: string,
  caller: { userId: string; orgId: string; role: string },
  body: Record<string, unknown> = {},
): Request {
  return new Request(
    `https://example.test/customers/${customerId}/invite-to-portal`,
    {
      method: 'POST',
      headers: {
        authorization: bearer(caller),
        'content-type': 'application/json',
        'idempotency-key': crypto.randomUUID(),
      },
      body: JSON.stringify(body),
    },
  );
}

describe('crm-api POST /customers/:id/invite-to-portal - Path B2', () => {
  let handler: (req: Request) => Promise<Response> | Response;

  beforeAll(async () => {
    installDenoShim();
    resetCapturedHandler();
    await import('../../../../supabase/functions/crm-api/index.ts');
    handler = capturedHandler();
  });

  afterEach(() => {
    clearActiveMockState();
  });

  it('cap-gates: viewer without crm.customers.invite_to_portal returns 403', async () => {
    setActiveMockState(makeStateWithCustomers());
    const res = await handler(postInvite(CUSTOMER_A, VIEWER));
    const { status, json } = await readJsonStatus(res);
    expect(status).toBe(403);
    expect(json.error?.code).toBe('FORBIDDEN');
  });

  it('returns 422 when customer has no primary_email and no override provided', async () => {
    setActiveMockState(makeStateWithCustomers());
    const res = await handler(postInvite(CUSTOMER_NO_EMAIL, OWNER));
    const { status, json } = await readJsonStatus(res);
    expect(status).toBe(422);
    expect(json.error?.code).toBe('VALIDATION_ERROR');
    expect(json.error?.message).toMatch(/primary_email/i);
  });

  it('cross-tenant customer surfaces as 404 (constitutional contract)', async () => {
    setActiveMockState(makeStateWithCustomers());
    const res = await handler(postInvite(CUSTOMER_OTHER_ORG, OWNER));
    const { status, json } = await readJsonStatus(res);
    expect(status).toBe(404);
    expect(json.error?.code).toBe('NOT_FOUND');
  });

  it('happy path: calls auth.admin.generateLink + RPC + queues email + returns envelope', async () => {
    const state = makeStateWithCustomers();
    state.authAdminGenerateLinkResult = {
      data: {
        user: { id: NEW_USER_ID, email: 'customer@example.test' },
        properties: {
          action_link:
            'https://www.kitstak.com/portal#access_token=fake&type=magiclink',
        },
      },
      error: null,
    };
    state.rpcResults['create_portal_membership'] = {
      data: '00000000-0000-4000-8000-00000000eeee',
      error: null,
    };
    setActiveMockState(state);

    const res = await handler(postInvite(CUSTOMER_A, OWNER));
    const { status, json } = await readJsonStatus(res);

    expect(status).toBe(200);
    expect(json.data).toMatchObject({
      membership_id: '00000000-0000-4000-8000-00000000eeee',
      user_id: NEW_USER_ID,
      email: 'customer@example.test',
      customer_id: CUSTOMER_A,
    });

    // Assert auth.admin.generateLink was called with the magiclink type +
    // portal redirectTo so the link lands customers signed-in at /portal.
    expect(state.authAdminGenerateLinkCalls).toHaveLength(1);
    expect(state.authAdminGenerateLinkCalls[0]).toMatchObject({
      type: 'magiclink',
      email: 'customer@example.test',
      options: { redirectTo: 'https://www.kitstak.com/portal' },
    });
    // Defense: the legacy inviteUserByEmail path must not fire.
    expect(state.authAdminInviteCalls).toHaveLength(0);

    // Assert the RPC was called with the right args.
    const rpcCall = state.rpcCalls.find(
      (c) => c.name === 'create_portal_membership',
    );
    expect(rpcCall).toBeDefined();
    expect(rpcCall?.args).toMatchObject({
      p_customer_id: CUSTOMER_A,
      p_user_id: NEW_USER_ID,
      p_org_id: ORG_A,
    });

    // Assert the branded email was queued via notifications + carries the
    // action_link in its body. The drain cron (Path B1) ships it via Resend.
    const notifInsert = state.inserts.find((i) => i.table === 'notifications');
    expect(notifInsert).toBeDefined();
    expect(notifInsert?.row).toMatchObject({
      org_id: ORG_A,
      recipient_user_id: NEW_USER_ID,
      entity_type: 'customer',
      entity_id: CUSTOMER_A,
      channel: 'email',
    });
    expect((notifInsert?.row.payload as Record<string, unknown>)?.to).toBe(
      'customer@example.test',
    );
    expect((notifInsert?.row.payload as Record<string, unknown>)?.kind).toBe(
      'portal_invite',
    );
    expect(notifInsert?.row.body).toContain(
      'https://www.kitstak.com/portal#access_token=fake&type=magiclink',
    );
    expect(notifInsert?.row.body).toContain('No password required');
    expect(notifInsert?.row.subject).toContain('Acme Co.');
  });

  it('email_override wins over customer.primary_email', async () => {
    const state = makeStateWithCustomers();
    state.authAdminGenerateLinkResult = {
      data: {
        user: { id: NEW_USER_ID, email: 'override@example.test' },
        properties: {
          action_link:
            'https://www.kitstak.com/portal#access_token=fake&type=magiclink',
        },
      },
      error: null,
    };
    state.rpcResults['create_portal_membership'] = {
      data: '00000000-0000-4000-8000-00000000eeee',
      error: null,
    };
    setActiveMockState(state);

    const res = await handler(
      postInvite(CUSTOMER_A, OWNER, {
        email_override: 'override@example.test',
      }),
    );
    expect(res.status).toBe(200);
    expect(state.authAdminGenerateLinkCalls[0]?.email).toBe(
      'override@example.test',
    );
    const notifInsert = state.inserts.find((i) => i.table === 'notifications');
    expect((notifInsert?.row.payload as Record<string, unknown>)?.to).toBe(
      'override@example.test',
    );
  });

  it('returns 422 when generateLink reports an auth error', async () => {
    const state = makeStateWithCustomers();
    state.authAdminGenerateLinkResult = {
      data: { user: null, properties: null },
      error: { message: 'Email rate limit exceeded' },
    };
    setActiveMockState(state);

    const res = await handler(postInvite(CUSTOMER_A, OWNER));
    const { status, json } = await readJsonStatus(res);
    expect(status).toBe(422);
    expect(json.error?.code).toBe('VALIDATION_ERROR');
    expect(json.error?.message).toMatch(/magic-link/i);
    // No membership row created on auth failure.
    const rpcCall = state.rpcCalls.find(
      (c) => c.name === 'create_portal_membership',
    );
    expect(rpcCall).toBeUndefined();
  });
});
