// Regression suite for the per-user dashboard preferences endpoints
// (Personalization): GET /dashboard/prefs and PUT /dashboard/prefs in the
// dashboard-api bundle.
//
// Constitutional invariants protected:
//   - RLS Pattern A + owner scope: every read/write scopes to BOTH
//     org_id = caller.orgId AND user_id = caller.userId (migration 0128). The
//     cross-tenant probe asserts a caller in another org sees no prefs; the
//     same-org other-user probe asserts a user never sees a peer's layout.
//   - Idempotency: the PUT enforces the Idempotency-Key header (a missing key
//     is a 400; the same key with a different body is a 409 conflict).

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
const USER_OTHER = '00000000-0000-4000-8000-0000000000b2';
const OWNER_A = { userId: USER_A, orgId: ORG_A, role: 'org_owner' as const };
const OWNER_B = { userId: USER_A, orgId: ORG_B, role: 'org_owner' as const };

const IDEM_KEY = '11111111-1111-4111-8111-111111111111';

async function readJson(
  res: Response,
): Promise<{ data?: unknown; error?: { code?: string } }> {
  return JSON.parse(await res.text());
}

function prefsFixture() {
  return makeState({
    user_dashboard_prefs: [
      {
        org_id: ORG_A,
        user_id: USER_A,
        section_key: 'sell',
        config: { widgets: { pipeline: { hidden: true, order: 2 } } },
      },
      {
        org_id: ORG_A,
        user_id: USER_A,
        section_key: 'money',
        config: { widgets: { aging: { order: 0 } } },
      },
      // Same org, different user: must never appear for USER_A.
      {
        org_id: ORG_A,
        user_id: USER_OTHER,
        section_key: 'buy',
        config: { widgets: { spend: { hidden: true } } },
      },
    ],
  });
}

describe('dashboard-api dashboard prefs (Personalization)', () => {
  let handler: (req: Request) => Promise<Response> | Response;

  beforeAll(async () => {
    installDenoShim();
    resetCapturedHandler();
    await import('../../../../supabase/functions/dashboard-api/index.ts');
    handler = capturedHandler();
  });

  afterEach(() => {
    clearActiveMockState();
  });

  function getPrefs(caller = OWNER_A) {
    const req = new Request('https://example.test/dashboard/prefs', {
      method: 'GET',
      headers: { authorization: bearer(caller) },
    });
    return handler(req);
  }

  function putPref(
    body: unknown,
    opts: { caller?: typeof OWNER_A; key?: string | null } = {},
  ) {
    const caller = opts.caller ?? OWNER_A;
    const headers: Record<string, string> = {
      authorization: bearer(caller),
      'content-type': 'application/json',
    };
    if (opts.key !== null) {
      headers['idempotency-key'] = opts.key ?? IDEM_KEY;
    }
    const req = new Request('https://example.test/dashboard/prefs', {
      method: 'PUT',
      headers,
      body: JSON.stringify(body),
    });
    return handler(req);
  }

  it('GET returns the caller own layouts as a section -> config map', async () => {
    setActiveMockState(prefsFixture());
    const res = await getPrefs();
    expect(res.status).toBe(200);
    const body = await readJson(res);
    const sections = (body.data as { sections: Record<string, unknown> })
      .sections;
    expect(sections.sell).toEqual({
      widgets: { pipeline: { hidden: true, order: 2 } },
    });
    expect(sections.money).toEqual({ widgets: { aging: { order: 0 } } });
    // A peer's layout in the same org is never returned (owner scope).
    expect(sections.buy).toBeUndefined();
  });

  it('GET returns no prefs for a cross-tenant caller (RLS Pattern A)', async () => {
    setActiveMockState(prefsFixture());
    const res = await getPrefs(OWNER_B);
    expect(res.status).toBe(200);
    const body = await readJson(res);
    const sections = (body.data as { sections: Record<string, unknown> })
      .sections;
    expect(sections).toEqual({});
  });

  it('PUT upserts a section layout and a follow-up GET reflects it', async () => {
    setActiveMockState(makeState({}));
    const config = { widgets: { pipeline: { hidden: false, order: 1 } } };
    const putRes = await putPref({ section_key: 'sell', config });
    expect(putRes.status).toBe(200);
    const putBody = await readJson(putRes);
    expect(putBody.data).toEqual({ section_key: 'sell', config });

    const getRes = await getPrefs();
    const getBody = await readJson(getRes);
    const sections = (getBody.data as { sections: Record<string, unknown> })
      .sections;
    expect(sections.sell).toEqual(config);
  });

  it('PUT rejects an unknown section_key (canon enum)', async () => {
    setActiveMockState(makeState({}));
    const res = await putPref({ section_key: 'bogus', config: {} });
    expect(res.status).toBe(422);
    const body = await readJson(res);
    expect(body.error?.code).toBe('VALIDATION_ERROR');
  });

  it('PUT requires an Idempotency-Key header (constitution gate)', async () => {
    setActiveMockState(makeState({}));
    const res = await putPref(
      { section_key: 'sell', config: {} },
      { key: null },
    );
    expect(res.status).toBe(400);
    const body = await readJson(res);
    expect(body.error?.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });

  it('PUT with the same key but a different body is a 409 conflict', async () => {
    setActiveMockState(makeState({}));
    const first = await putPref({
      section_key: 'sell',
      config: { widgets: { pipeline: { order: 1 } } },
    });
    expect(first.status).toBe(200);

    const second = await putPref({
      section_key: 'sell',
      config: { widgets: { pipeline: { order: 9 } } },
    });
    expect(second.status).toBe(409);
    const body = await readJson(second);
    expect(body.error?.code).toBe('IDEMPOTENCY_CONFLICT');
  });
});
