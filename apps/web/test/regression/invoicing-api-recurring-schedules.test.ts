// Regression suite for ADR 0005 Phase 2 schedule CRUD: the invoicing-api
// recurring-schedules endpoints, exercised through the real handler under the
// Supabase mock.
//
// Covers create / pause / resume / end / list:
//   - create: 201, inserts an active monthly row, defaults next_run_on, honours
//     an explicit one. Guards: 404 on a missing / cross-org project
//     (assertRefInOrg), 409 when a live (active|paused) schedule already exists,
//     201 again when only an ended schedule remains, 403 without invoices.write.
//   - pause / resume / end: compare-and-set status transition with the right
//     allowed-from set; 409 on a disallowed move, 404 on a missing schedule.
//   - list: org + project filtered.

import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
  installDenoShim,
  capturedHandler,
  resetCapturedHandler,
} from './_helpers/deno-shim.ts';
import { makeState, bearer, type MockState } from './_helpers/supabase-mock.ts';
import {
  setActiveMockState,
  clearActiveMockState,
} from './_helpers/supabase-stub.ts';

const ORG_A = '00000000-0000-4000-8000-0000000000a1';
const USER_A = '00000000-0000-4000-8000-0000000000b1';
const OWNER = { userId: USER_A, orgId: ORG_A, role: 'org_owner' as const };
const VIEWER = { userId: USER_A, orgId: ORG_A, role: 'viewer' as const };

const PROJECT_ID = '00000000-0000-4000-8000-0000000000d1';
const SCHED_1 = '00000000-0000-4000-8000-000000000e01';
const MISSING = '00000000-0000-4000-8000-000000000eff';

function headers(caller = OWNER): Record<string, string> {
  return {
    authorization: bearer(caller),
    'content-type': 'application/json',
    'idempotency-key': crypto.randomUUID(),
  };
}
function post(path: string, body: unknown, caller = OWNER): Request {
  return new Request(`https://example.test${path}`, {
    method: 'POST',
    headers: headers(caller),
    body: JSON.stringify(body),
  });
}
function get(path: string, caller = OWNER): Request {
  return new Request(`https://example.test${path}`, {
    method: 'GET',
    headers: { authorization: bearer(caller) },
  });
}
async function readJson(res: Response): Promise<{
  status: number;
  json: { data?: unknown; error?: { code?: string } };
}> {
  return { status: res.status, json: JSON.parse(await res.text()) };
}

interface StateOpts {
  withProject?: boolean;
  schedules?: Array<Record<string, unknown>>;
}
function makeScheduleState(opts: StateOpts = {}): MockState {
  const projects = opts.withProject === false ? [] : [{ id: PROJECT_ID, org_id: ORG_A }];
  return makeState({
    projects,
    recurring_schedules: opts.schedules ?? [],
  });
}
function scheduleInserts(state: MockState): Array<Record<string, unknown>> {
  return state.inserts
    .filter((i) => i.table === 'recurring_schedules')
    .map((i) => i.row);
}
function scheduleUpdates(state: MockState): Array<{ patch: Record<string, unknown> }> {
  return state.updates.filter((u) => u.table === 'recurring_schedules');
}

describe('invoicing-api recurring schedules (ADR 0005 Phase 2)', () => {
  let handler: (req: Request) => Promise<Response> | Response;

  beforeAll(async () => {
    installDenoShim();
    resetCapturedHandler();
    await import('../../../../supabase/functions/invoicing-api/index.ts');
    handler = capturedHandler();
  });

  afterEach(() => {
    clearActiveMockState();
  });

  it('creates a schedule: 201, active monthly row, org and project stamped', async () => {
    const state = makeScheduleState();
    setActiveMockState(state);

    const res = await handler(post('/recurring-schedules', { project_id: PROJECT_ID }));
    expect((await readJson(res)).status).toBe(201);

    const inserts = scheduleInserts(state);
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({
      org_id: ORG_A,
      project_id: PROJECT_ID,
      cadence: 'monthly',
      status: 'active',
      created_by: USER_A,
      updated_by: USER_A,
    });
    expect(typeof inserts[0].next_run_on).toBe('string');
  });

  it('honours an explicit next_run_on', async () => {
    const state = makeScheduleState();
    setActiveMockState(state);

    await handler(
      post('/recurring-schedules', { project_id: PROJECT_ID, next_run_on: '2026-08-01' }),
    );
    expect(scheduleInserts(state)[0]).toMatchObject({ next_run_on: '2026-08-01' });
  });

  it('returns 404 creating a schedule for a missing or cross-org project', async () => {
    const state = makeScheduleState({ withProject: false });
    setActiveMockState(state);

    const res = await handler(post('/recurring-schedules', { project_id: PROJECT_ID }));
    expect((await readJson(res)).status).toBe(404);
    expect(scheduleInserts(state)).toHaveLength(0);
  });

  it('rejects a second live schedule for the same project (409)', async () => {
    const state = makeScheduleState({
      schedules: [{ id: SCHED_1, org_id: ORG_A, project_id: PROJECT_ID, status: 'active' }],
    });
    setActiveMockState(state);

    const res = await handler(post('/recurring-schedules', { project_id: PROJECT_ID }));
    const { status, json } = await readJson(res);
    expect(status).toBe(409);
    expect(json.error?.code).toBe('STATE_CONFLICT');
    expect(scheduleInserts(state)).toHaveLength(0);
  });

  it('allows a new schedule when only an ended one exists', async () => {
    const state = makeScheduleState({
      schedules: [{ id: SCHED_1, org_id: ORG_A, project_id: PROJECT_ID, status: 'ended' }],
    });
    setActiveMockState(state);

    const res = await handler(post('/recurring-schedules', { project_id: PROJECT_ID }));
    expect((await readJson(res)).status).toBe(201);
    expect(scheduleInserts(state)).toHaveLength(1);
  });

  it('forbids create without invoices.write (viewer 403)', async () => {
    const state = makeScheduleState();
    setActiveMockState(state);

    const res = await handler(post('/recurring-schedules', { project_id: PROJECT_ID }, VIEWER));
    expect((await readJson(res)).status).toBe(403);
    expect(scheduleInserts(state)).toHaveLength(0);
  });

  it('lists schedules filtered by org and project', async () => {
    const state = makeScheduleState({
      schedules: [
        {
          id: SCHED_1,
          org_id: ORG_A,
          project_id: PROJECT_ID,
          status: 'active',
          created_at: '2026-06-01T00:00:00Z',
        },
      ],
    });
    setActiveMockState(state);

    const res = await handler(get(`/recurring-schedules?project_id=${PROJECT_ID}`));
    const { status, json } = await readJson(res);
    expect(status).toBe(200);
    expect(Array.isArray(json.data)).toBe(true);
    expect((json.data as unknown[]).length).toBe(1);
  });

  it('pauses an active schedule (active -> paused)', async () => {
    const state = makeScheduleState({
      schedules: [{ id: SCHED_1, org_id: ORG_A, project_id: PROJECT_ID, status: 'active' }],
    });
    setActiveMockState(state);

    const res = await handler(post(`/recurring-schedules/${SCHED_1}/pause`, {}));
    expect((await readJson(res)).status).toBe(200);
    const u = scheduleUpdates(state).find((u) => u.patch.status === 'paused');
    expect(u?.patch).toMatchObject({ status: 'paused', updated_by: USER_A });
  });

  it('rejects pausing a schedule that is not active (409)', async () => {
    const state = makeScheduleState({
      schedules: [{ id: SCHED_1, org_id: ORG_A, project_id: PROJECT_ID, status: 'paused' }],
    });
    setActiveMockState(state);

    const res = await handler(post(`/recurring-schedules/${SCHED_1}/pause`, {}));
    const { status, json } = await readJson(res);
    expect(status).toBe(409);
    expect(json.error?.code).toBe('STATE_CONFLICT');
    expect(scheduleUpdates(state)).toHaveLength(0);
  });

  it('resumes a paused schedule (paused -> active)', async () => {
    const state = makeScheduleState({
      schedules: [{ id: SCHED_1, org_id: ORG_A, project_id: PROJECT_ID, status: 'paused' }],
    });
    setActiveMockState(state);

    const res = await handler(post(`/recurring-schedules/${SCHED_1}/resume`, {}));
    expect((await readJson(res)).status).toBe(200);
    expect(scheduleUpdates(state).find((u) => u.patch.status === 'active')).toBeTruthy();
  });

  it('ends an active schedule (active -> ended)', async () => {
    const state = makeScheduleState({
      schedules: [{ id: SCHED_1, org_id: ORG_A, project_id: PROJECT_ID, status: 'active' }],
    });
    setActiveMockState(state);

    const res = await handler(post(`/recurring-schedules/${SCHED_1}/end`, {}));
    expect((await readJson(res)).status).toBe(200);
    expect(scheduleUpdates(state).find((u) => u.patch.status === 'ended')).toBeTruthy();
  });

  it('ends a paused schedule (paused -> ended)', async () => {
    const state = makeScheduleState({
      schedules: [{ id: SCHED_1, org_id: ORG_A, project_id: PROJECT_ID, status: 'paused' }],
    });
    setActiveMockState(state);

    const res = await handler(post(`/recurring-schedules/${SCHED_1}/end`, {}));
    expect((await readJson(res)).status).toBe(200);
  });

  it('rejects ending an already-ended schedule (409)', async () => {
    const state = makeScheduleState({
      schedules: [{ id: SCHED_1, org_id: ORG_A, project_id: PROJECT_ID, status: 'ended' }],
    });
    setActiveMockState(state);

    const res = await handler(post(`/recurring-schedules/${SCHED_1}/end`, {}));
    expect((await readJson(res)).status).toBe(409);
  });

  it('returns 404 transitioning a missing schedule', async () => {
    const state = makeScheduleState();
    setActiveMockState(state);

    const res = await handler(post(`/recurring-schedules/${MISSING}/pause`, {}));
    expect((await readJson(res)).status).toBe(404);
  });
});
