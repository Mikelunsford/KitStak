// Regression suite for the PATCH /members/:user_id endpoint
// (F-Wave9-STAFF-INVITE-PATCH-01 backend). Covers:
//   1. Cap gate: org_admin allowed; sales and viewer denied.
//   2. Cross-tenant target returns 404, not 403, per Pattern A.
//   3. Self-deactivate returns 422 CANNOT_DEACTIVATE_SELF (cannot lock self out).
//   4. Privilege escalation: org_admin promoting to org_owner returns 403
//      FORBIDDEN_ROLE_ESCALATION; org_owner can promote to org_owner.
//   5. Happy path: role change returns the updated row in OrgMemberRowSchema
//      shape; deactivate returns the row with is_active=false.
//   6. Idempotency-Key missing returns 400 IDEMPOTENCY_KEY_REQUIRED.

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

const OWNER_USER_ID  = '00000000-0000-4000-8000-0000000000b1';
const ADMIN_USER_ID  = '00000000-0000-4000-8000-0000000000b2';
const VIEWER_USER_ID = '00000000-0000-4000-8000-0000000000b3';
const SALES_USER_ID  = '00000000-0000-4000-8000-0000000000b4';
const TARGET_USER_ID = '00000000-0000-4000-8000-0000000000c1';
const ORG_B_USER_ID  = '00000000-0000-4000-8000-0000000000c2';

const ROLE_OWNER_ID  = '00000000-0000-4000-8000-00000000e001';
const ROLE_ADMIN_ID  = '00000000-0000-4000-8000-00000000e002';
const ROLE_VIEWER_ID = '00000000-0000-4000-8000-00000000e003';
const ROLE_SALES_ID  = '00000000-0000-4000-8000-00000000e004';
const ROLE_OPS_ID    = '00000000-0000-4000-8000-00000000e005';

const OWNER  = { userId: OWNER_USER_ID,  orgId: ORG_A, role: 'org_owner' as const };
const ADMIN  = { userId: ADMIN_USER_ID,  orgId: ORG_A, role: 'org_admin' as const };
const SALES  = { userId: SALES_USER_ID,  orgId: ORG_A, role: 'sales'     as const };
const VIEWER = { userId: VIEWER_USER_ID, orgId: ORG_A, role: 'viewer'    as const };

function makePatchState() {
  return makeState({
    org_memberships: [
      {
        id: '00000000-0000-4000-8000-00000000f001',
        user_id: OWNER_USER_ID,
        org_id: ORG_A,
        is_active: true,
        created_at: '2026-05-01T10:00:00Z',
        role_id: ROLE_OWNER_ID,
        role: { code: 'org_owner', label: 'Owner' },
      },
      {
        id: '00000000-0000-4000-8000-00000000f002',
        user_id: ADMIN_USER_ID,
        org_id: ORG_A,
        is_active: true,
        created_at: '2026-05-02T10:00:00Z',
        role_id: ROLE_ADMIN_ID,
        role: { code: 'org_admin', label: 'Admin' },
      },
      {
        id: '00000000-0000-4000-8000-00000000f003',
        user_id: TARGET_USER_ID,
        org_id: ORG_A,
        is_active: true,
        created_at: '2026-05-03T10:00:00Z',
        role_id: ROLE_SALES_ID,
        role: { code: 'sales', label: 'Sales' },
      },
      {
        id: '00000000-0000-4000-8000-00000000f004',
        user_id: ORG_B_USER_ID,
        org_id: ORG_B,
        is_active: true,
        created_at: '2026-05-04T10:00:00Z',
        role_id: ROLE_OWNER_ID,
        role: { code: 'org_owner', label: 'Owner' },
      },
    ],
    profiles: [
      { user_id: OWNER_USER_ID,  email: 'owner@example.test',  display_name: 'Owner' },
      { user_id: ADMIN_USER_ID,  email: 'admin@example.test',  display_name: 'Admin' },
      { user_id: TARGET_USER_ID, email: 'target@example.test', display_name: 'Target' },
      { user_id: ORG_B_USER_ID,  email: 'orgb@example.test',   display_name: 'Org B' },
    ],
    roles: [
      { id: ROLE_OWNER_ID,  code: 'org_owner', label: 'Owner' },
      { id: ROLE_ADMIN_ID,  code: 'org_admin', label: 'Admin' },
      { id: ROLE_SALES_ID,  code: 'sales',     label: 'Sales' },
      { id: ROLE_OPS_ID,    code: 'ops',       label: 'Ops' },
      { id: ROLE_VIEWER_ID, code: 'viewer',    label: 'Viewer' },
    ],
    organizations: [
      { id: ORG_A, display_name: 'Acme 3PL', status: 'active', deleted_at: null },
    ],
  });
}

function readJsonStatus(res: Response): Promise<{
  status: number;
  json: { data?: unknown; error?: { code?: string; message?: string } };
}> {
  return res.text().then((t) => ({ status: res.status, json: JSON.parse(t) }));
}

function patch(
  caller: { userId: string; orgId: string; role: string },
  targetUserId: string,
  body: Record<string, unknown>,
  idempotencyKey: string = crypto.randomUUID(),
): Request {
  return new Request(`https://example.test/members/${targetUserId}`, {
    method: 'PATCH',
    headers: {
      authorization: bearer(caller),
      'content-type': 'application/json',
      'idempotency-key': idempotencyKey,
    },
    body: JSON.stringify(body),
  });
}

describe('auth-api PATCH /members/:user_id - per-row update', () => {
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

  it('cap-gates: viewer is denied (org.member.update not granted) -> 403', async () => {
    setActiveMockState(makePatchState());
    const res = await handler(patch(VIEWER, TARGET_USER_ID, { role: 'ops' }));
    const { status, json } = await readJsonStatus(res);
    expect(status).toBe(403);
    expect(json.error?.code).toBe('FORBIDDEN');
  });

  it('cap-gates: sales is denied (org.member.update not granted) -> 403', async () => {
    setActiveMockState(makePatchState());
    const res = await handler(patch(SALES, TARGET_USER_ID, { role: 'ops' }));
    const { status, json } = await readJsonStatus(res);
    expect(status).toBe(403);
    expect(json.error?.code).toBe('FORBIDDEN');
  });

  it('cap-gates: org_admin is allowed (org.member.update granted)', async () => {
    setActiveMockState(makePatchState());
    const res = await handler(patch(ADMIN, TARGET_USER_ID, { role: 'ops' }));
    expect(res.status).toBe(200);
  });

  it('cross-tenant target returns 404 (Pattern A: hide existence)', async () => {
    setActiveMockState(makePatchState());
    const res = await handler(patch(OWNER, ORG_B_USER_ID, { role: 'ops' }));
    const { status, json } = await readJsonStatus(res);
    expect(status).toBe(404);
    expect(json.error?.code).toBe('NOT_FOUND');
  });

  it('self-deactivate returns 422 CANNOT_DEACTIVATE_SELF', async () => {
    setActiveMockState(makePatchState());
    const res = await handler(
      patch(OWNER, OWNER_USER_ID, { is_active: false }),
    );
    const { status, json } = await readJsonStatus(res);
    expect(status).toBe(422);
    expect(json.error?.code).toBe('CANNOT_DEACTIVATE_SELF');
  });

  it('caller can change their own role (not blocked by self-deactivate guard)', async () => {
    setActiveMockState(makePatchState());
    const res = await handler(
      patch(OWNER, OWNER_USER_ID, { role: 'org_admin' }),
    );
    // Owner changing own role to admin is allowed (not a deactivate); the
    // guard only refuses is_active=false on self.
    expect(res.status).toBe(200);
  });

  it('privilege escalation: org_admin promoting to org_owner -> 403 FORBIDDEN_ROLE_ESCALATION', async () => {
    setActiveMockState(makePatchState());
    const res = await handler(
      patch(ADMIN, TARGET_USER_ID, { role: 'org_owner' }),
    );
    const { status, json } = await readJsonStatus(res);
    expect(status).toBe(403);
    expect(json.error?.code).toBe('FORBIDDEN_ROLE_ESCALATION');
  });

  it('org_owner CAN promote a member to org_owner', async () => {
    setActiveMockState(makePatchState());
    const res = await handler(
      patch(OWNER, TARGET_USER_ID, { role: 'org_owner' }),
    );
    expect(res.status).toBe(200);
  });

  it('happy path: role change returns updated row in OrgMemberRowSchema shape', async () => {
    const state = makePatchState();
    setActiveMockState(state);
    const res = await handler(patch(OWNER, TARGET_USER_ID, { role: 'ops' }));
    const { status, json } = await readJsonStatus(res);
    expect(status).toBe(200);
    expect(json.data).toMatchObject({
      user_id: TARGET_USER_ID,
      org_id: ORG_A,
      email: 'target@example.test',
      role_code: expect.any(String),
      is_active: true,
      claimed: expect.any(Boolean),
    });
    // The UPDATE was issued against org_memberships with role_id mapped from
    // the requested code.
    const updateCall = state.updates.find((u) => u.table === 'org_memberships');
    expect(updateCall).toBeDefined();
    expect(updateCall?.patch.role_id).toBe(ROLE_OPS_ID);
    expect(updateCall?.patch.updated_by).toBe(OWNER_USER_ID);
  });

  it('happy path: deactivate returns row with is_active=false', async () => {
    const state = makePatchState();
    setActiveMockState(state);
    const res = await handler(
      patch(OWNER, TARGET_USER_ID, { is_active: false }),
    );
    const { status, json } = await readJsonStatus(res);
    expect(status).toBe(200);
    const updateCall = state.updates.find((u) => u.table === 'org_memberships');
    expect(updateCall).toBeDefined();
    expect(updateCall?.patch.is_active).toBe(false);
    expect(json.data).toMatchObject({ user_id: TARGET_USER_ID });
  });

  it('validation: empty body returns 422', async () => {
    setActiveMockState(makePatchState());
    const res = await handler(patch(OWNER, TARGET_USER_ID, {}));
    const { status, json } = await readJsonStatus(res);
    expect(status).toBe(422);
    expect(json.error?.code).toBe('VALIDATION_ERROR');
  });

  it('idempotency-key required: missing header -> 400 IDEMPOTENCY_KEY_REQUIRED', async () => {
    setActiveMockState(makePatchState());
    const req = new Request(
      `https://example.test/members/${TARGET_USER_ID}`,
      {
        method: 'PATCH',
        headers: {
          authorization: bearer(OWNER),
          'content-type': 'application/json',
        },
        body: JSON.stringify({ role: 'ops' }),
      },
    );
    const res = await handler(req);
    const { status, json } = await readJsonStatus(res);
    expect(status).toBe(400);
    expect(json.error?.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });
});
