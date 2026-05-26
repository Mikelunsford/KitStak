// Regression suite for the staff members list endpoint
// (F-Wave9-STAFF-INVITE-MEMBERS-LIST-01 backend). GET /members on auth-api.
//
// Coverage:
//   1. Cap gate: viewer is granted org.member.list (200).
//   2. Cap gate: sales is denied org.member.list (403 FORBIDDEN).
//   3. Cap gate: customer_user is denied org.member.list (403 FORBIDDEN).
//   4. Cross-tenant read: caller from org A receives only org A's rows,
//      not org B's. The response is 200 with a filtered list, never 404,
//      per the constitutional Pattern A read rule.
//   5. Happy path: 200, envelope.data is a flat array (not { items }),
//      every row matches the OrgMemberRowSchema shape.
//   6. Profile-missing row is silently dropped so the response always
//      parses cleanly through the Zod schema.

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

const OWNER_USER_ID    = '00000000-0000-4000-8000-0000000000b1';
const ADMIN_USER_ID    = '00000000-0000-4000-8000-0000000000b2';
const VIEWER_USER_ID   = '00000000-0000-4000-8000-0000000000b3';
const SALES_USER_ID    = '00000000-0000-4000-8000-0000000000b4';
const PORTAL_USER_ID   = '00000000-0000-4000-8000-0000000000b5';
const ORG_B_STAFF_ID   = '00000000-0000-4000-8000-0000000000c1';
const NO_PROFILE_USER  = '00000000-0000-4000-8000-0000000000d1';

const ROLE_OWNER_ID  = '00000000-0000-4000-8000-00000000e001';
const ROLE_ADMIN_ID  = '00000000-0000-4000-8000-00000000e002';
const ROLE_VIEWER_ID = '00000000-0000-4000-8000-00000000e003';
const ROLE_SALES_ID  = '00000000-0000-4000-8000-00000000e004';

const OWNER  = { userId: OWNER_USER_ID,  orgId: ORG_A, role: 'org_owner'    as const };
const VIEWER = { userId: VIEWER_USER_ID, orgId: ORG_A, role: 'viewer'       as const };
const SALES  = { userId: SALES_USER_ID,  orgId: ORG_A, role: 'sales'        as const };
const PORTAL = { userId: PORTAL_USER_ID, orgId: ORG_A, role: 'customer_user' as const };

function makeListState() {
  return makeState({
    org_memberships: [
      // Org A members. All active.
      {
        user_id: OWNER_USER_ID,
        org_id: ORG_A,
        is_active: true,
        created_at: '2026-05-01T10:00:00Z',
        role: { code: 'org_owner', label: 'Owner' },
      },
      {
        user_id: ADMIN_USER_ID,
        org_id: ORG_A,
        is_active: true,
        created_at: '2026-05-10T10:00:00Z',
        role: { code: 'org_admin', label: 'Admin' },
      },
      {
        user_id: VIEWER_USER_ID,
        org_id: ORG_A,
        is_active: true,
        created_at: '2026-05-12T10:00:00Z',
        role: { code: 'viewer', label: 'Viewer' },
      },
      {
        user_id: SALES_USER_ID,
        org_id: ORG_A,
        is_active: true,
        created_at: '2026-05-15T10:00:00Z',
        role: { code: 'sales', label: 'Sales' },
      },
      // Org B member. Must NEVER surface in an org A caller's response.
      {
        user_id: ORG_B_STAFF_ID,
        org_id: ORG_B,
        is_active: true,
        created_at: '2026-05-05T10:00:00Z',
        role: { code: 'org_owner', label: 'Owner' },
      },
    ],
    profiles: [
      { user_id: OWNER_USER_ID,  email: 'owner@example.test',  display_name: 'Owner Person' },
      { user_id: ADMIN_USER_ID,  email: 'admin@example.test',  display_name: 'Admin Person' },
      { user_id: VIEWER_USER_ID, email: 'viewer@example.test', display_name: null },
      { user_id: SALES_USER_ID,  email: 'sales@example.test',  display_name: 'Sales Person' },
      { user_id: ORG_B_STAFF_ID, email: 'orgb@example.test',   display_name: 'Org B Owner' },
    ],
    roles: [
      { id: ROLE_OWNER_ID,  code: 'org_owner', label: 'Owner' },
      { id: ROLE_ADMIN_ID,  code: 'org_admin', label: 'Admin' },
      { id: ROLE_VIEWER_ID, code: 'viewer',    label: 'Viewer' },
      { id: ROLE_SALES_ID,  code: 'sales',     label: 'Sales' },
    ],
  });
}

function readJsonStatus(res: Response): Promise<{
  status: number;
  json: { data?: unknown; error?: { code?: string; message?: string } };
}> {
  return res.text().then((t) => ({ status: res.status, json: JSON.parse(t) }));
}

function get(
  caller: { userId: string; orgId: string; role: string },
): Request {
  return new Request('https://example.test/members', {
    method: 'GET',
    headers: {
      authorization: bearer(caller),
    },
  });
}

describe('auth-api GET /members - staff members list', () => {
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

  it('cap-gates: viewer is allowed (org.member.list granted)', async () => {
    setActiveMockState(makeListState());
    const res = await handler(get(VIEWER));
    expect(res.status).toBe(200);
  });

  it('cap-gates: sales is denied (org.member.list not in sales role)', async () => {
    setActiveMockState(makeListState());
    const res = await handler(get(SALES));
    const { status, json } = await readJsonStatus(res);
    expect(status).toBe(403);
    expect(json.error?.code).toBe('FORBIDDEN');
  });

  it('cap-gates: customer_user is denied (org.member.list not granted)', async () => {
    setActiveMockState(makeListState());
    const res = await handler(get(PORTAL));
    const { status, json } = await readJsonStatus(res);
    expect(status).toBe(403);
    expect(json.error?.code).toBe('FORBIDDEN');
  });

  it('cross-tenant: caller from org A sees only org A rows, not org B', async () => {
    setActiveMockState(makeListState());
    const res = await handler(get(OWNER));
    const { status, json } = await readJsonStatus(res);

    expect(status).toBe(200);
    expect(Array.isArray(json.data)).toBe(true);
    const rows = json.data as Array<Record<string, unknown>>;

    // Every returned row is in org A.
    for (const row of rows) {
      expect(row.org_id).toBe(ORG_A);
    }
    // Org B's user must not appear.
    expect(rows.find((r) => r.user_id === ORG_B_STAFF_ID)).toBeUndefined();
  });

  it('happy path: 200, flat array (not { items }), every row has full shape', async () => {
    setActiveMockState(makeListState());
    const res = await handler(get(OWNER));
    const { status, json } = await readJsonStatus(res);

    expect(status).toBe(200);
    // Flat array per F-Wave7-LISTENVELOPE-01. No items wrapper.
    expect(Array.isArray(json.data)).toBe(true);
    const rows = json.data as Array<Record<string, unknown>>;
    expect(rows.length).toBe(4); // 4 org-A members

    // Verify the caller's own row.
    const self = rows.find((r) => r.user_id === OWNER_USER_ID);
    expect(self).toBeDefined();
    expect(self).toMatchObject({
      user_id: OWNER_USER_ID,
      org_id: ORG_A,
      email: 'owner@example.test',
      display_name: 'Owner Person',
      role_code: 'org_owner',
      role_display_name: 'Owner',
      is_active: true,
    });
    expect(typeof self?.created_at).toBe('string');

    // Verify a row with null display_name falls through cleanly.
    const viewerRow = rows.find((r) => r.user_id === VIEWER_USER_ID);
    expect(viewerRow).toBeDefined();
    expect(viewerRow?.display_name).toBeNull();
    expect(viewerRow?.email).toBe('viewer@example.test');
  });

  it('drops members with no profile row so the response always parses cleanly', async () => {
    const state = makeListState();
    // Inject a membership whose user_id has no matching profiles row.
    (state.rows.org_memberships as Array<Record<string, unknown>>).push({
      user_id: NO_PROFILE_USER,
      org_id: ORG_A,
      is_active: true,
      created_at: '2026-05-20T10:00:00Z',
      role: { code: 'ops', label: 'Operations' },
    });
    setActiveMockState(state);

    const res = await handler(get(OWNER));
    const { status, json } = await readJsonStatus(res);

    expect(status).toBe(200);
    const rows = json.data as Array<Record<string, unknown>>;
    // The profile-less membership is dropped; the four well-formed rows remain.
    expect(rows.find((r) => r.user_id === NO_PROFILE_USER)).toBeUndefined();
    expect(rows.length).toBe(4);
  });
});
