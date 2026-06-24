// invoicing-api recurring-schedules handlers (ADR 0005 Phase 2, schedule CRUD).
//   GET    /recurring-schedules              (?project_id= filter)
//   POST   /recurring-schedules
//   POST   /recurring-schedules/:id/pause    (active -> paused)
//   POST   /recurring-schedules/:id/resume   (paused -> active)
//   POST   /recurring-schedules/:id/end       (active|paused -> ended)
//
// Operationalises the migration 0138 generator: that function no-ops until a
// recurring_schedules row exists, so this is the surface that turns recurring
// billing on for a project. The daily pg_cron generator (service_role) does the
// drafting; this endpoint only manages the schedule row.
//
// Authorization: reads gate on invoices.read, writes on invoices.write (the
// "invoicing write caps" the 0138 header named). The table also carries
// Pattern A RLS restricting the direct authenticated write path to the finance
// roles; this edge path runs service-role with an explicit org_id filter, so
// requireCap is the authority and every query is org-scoped by hand. Rows are
// returned as-read (the SPA service re-validates against the canon schema).

import type { RouteCtx } from '../../_shared/route.ts';
import { ApiError, ok } from '../../_shared/responses.ts';
import {
  admin,
  created,
  parseBody,
  parseUuidParam,
  requireCap,
  respondWithIdempotency,
} from '../../_shared/handler-helpers.ts';
import { requireCaller, type Caller } from '../../_shared/tenant.ts';
import { assertRefInOrg } from '../../_shared/crud.ts';
import {
  CreateRecurringScheduleRequestSchema,
  type RecurringScheduleStatus,
} from '../../_shared/types/finance.ts';
import { BUNDLE } from '../_helpers.ts';

const RECURRING_SCHEDULE_COLS =
  'id, org_id, project_id, cadence, next_run_on, status, last_run_on, ' +
  'last_invoice_id, created_at, updated_at';

// Target status -> the statuses it may be reached from. pause/resume are the
// reversible pair; end is terminal (ended has no outbound transition). A
// request that does not match is a STATE_CONFLICT 409, never a silent no-op.
const SCHEDULE_TRANSITIONS: Record<RecurringScheduleStatus, RecurringScheduleStatus[]> = {
  active: ['paused'], // resume
  paused: ['active'], // pause
  ended: ['active', 'paused'], // end
};

interface RecurringScheduleRow {
  id: string;
  org_id: string;
  project_id: string;
  cadence: string;
  next_run_on: string;
  status: string;
  last_run_on: string | null;
  last_invoice_id: string | null;
  created_at: string;
  updated_at: string;
}

async function fetchScheduleRow(
  caller: Caller,
  id: string,
): Promise<RecurringScheduleRow> {
  const { data, error } = await admin()
    .from('recurring_schedules')
    .select(RECURRING_SCHEDULE_COLS)
    .eq('id', id)
    .eq('org_id', caller.orgId)
    .maybeSingle();
  if (error) {
    throw new ApiError('INTERNAL_ERROR', 500, 'recurring schedule lookup failed', {
      detail: error.message,
    });
  }
  if (!data) throw new ApiError('NOT_FOUND', 404, 'recurring schedule not found');
  return data as unknown as RecurringScheduleRow;
}

export async function listRecurringSchedules({ req, url }: RouteCtx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'invoices.read');

  let query = admin()
    .from('recurring_schedules')
    .select(RECURRING_SCHEDULE_COLS)
    .eq('org_id', caller.orgId);

  const projectId = url.searchParams.get('project_id');
  if (projectId) query = query.eq('project_id', parseUuidParam(projectId, 'project_id'));

  query = query.order('created_at', { ascending: false });

  const { data, error } = await query;
  if (error) {
    throw new ApiError('INTERNAL_ERROR', 500, 'recurring schedule list failed', {
      detail: error.message,
    });
  }
  return ok(data ?? []);
}

export async function createRecurringSchedule(ctx: RouteCtx): Promise<Response> {
  const caller = requireCaller(ctx.req);
  requireCap(caller, 'invoices.write');
  const body = await parseBody(ctx.req, CreateRecurringScheduleRequestSchema);

  return respondWithIdempotency(
    ctx.req,
    caller,
    BUNDLE,
    `${ctx.req.method} /recurring-schedules`,
    body,
    async () => {
      // Org-scoped existence check on the project: a cross-tenant or missing
      // project_id resolves to 404, never a leak (assertRefInOrg contract).
      await assertRefInOrg('projects', caller, body.project_id);

      // One live schedule per project: reject when an active or paused schedule
      // already exists so the daily generator can never double-bill a project.
      const { data: live, error: liveErr } = await admin()
        .from('recurring_schedules')
        .select('id')
        .eq('org_id', caller.orgId)
        .eq('project_id', body.project_id)
        .in('status', ['active', 'paused'])
        .limit(1);
      if (liveErr) {
        throw new ApiError('INTERNAL_ERROR', 500, 'recurring schedule lookup failed', {
          detail: liveErr.message,
        });
      }
      if (live && (live as unknown[]).length > 0) {
        throw new ApiError(
          'STATE_CONFLICT',
          409,
          'a recurring schedule already exists for this project',
        );
      }

      // next_run_on defaults to today: the operator turned recurring billing on,
      // so the next daily cron run drafts the first invoice. An explicit date
      // (e.g. the first of next month) wins. The generator advances next_run_on
      // by one month per run, so billing recurs on the start day each month.
      const nextRunOn = body.next_run_on?.trim() || new Date().toISOString().slice(0, 10);

      const insert = {
        org_id: caller.orgId,
        project_id: body.project_id,
        cadence: body.cadence ?? 'monthly',
        next_run_on: nextRunOn,
        status: 'active',
        created_by: caller.userId,
        updated_by: caller.userId,
      };
      const { data, error } = await admin()
        .from('recurring_schedules')
        .insert(insert)
        .select(RECURRING_SCHEDULE_COLS)
        .single();
      if (error) {
        throw new ApiError('INTERNAL_ERROR', 500, 'recurring schedule insert failed', {
          detail: error.message,
        });
      }
      return created(data);
    },
  );
}

// Shared status transition. Reads the current status, validates the move
// against SCHEDULE_TRANSITIONS, then applies a compare-and-set UPDATE filtered
// on the read status (`.eq('status', from)`). A concurrent transition that
// already advanced the row leaves 0 rows matched, surfaced as STATE_CONFLICT
// 409 (the same lost-write guard the invoice transitions use, R-W13-FIN-01).
async function transitionScheduleTo(
  caller: Caller,
  id: string,
  to: RecurringScheduleStatus,
): Promise<unknown> {
  const row = await fetchScheduleRow(caller, id);
  const from = row.status as RecurringScheduleStatus;
  if (!SCHEDULE_TRANSITIONS[to].includes(from)) {
    throw new ApiError(
      'STATE_CONFLICT',
      409,
      `recurring schedule transition ${from} -> ${to} not allowed`,
    );
  }
  const { data, error } = await admin()
    .from('recurring_schedules')
    .update({
      status: to,
      updated_by: caller.userId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('org_id', caller.orgId)
    .eq('status', from)
    .select(RECURRING_SCHEDULE_COLS)
    .maybeSingle();
  if (error) {
    throw new ApiError('INTERNAL_ERROR', 500, 'recurring schedule transition failed', {
      detail: error.message,
    });
  }
  if (!data) {
    throw new ApiError(
      'STATE_CONFLICT',
      409,
      `recurring schedule transition ${from} -> ${to} not allowed`,
    );
  }
  return data;
}

export async function pauseRecurringSchedule(ctx: RouteCtx): Promise<Response> {
  const caller = requireCaller(ctx.req);
  requireCap(caller, 'invoices.write');
  const id = parseUuidParam(ctx.params.id!);
  return respondWithIdempotency(
    ctx.req,
    caller,
    BUNDLE,
    `${ctx.req.method} /recurring-schedules/:id/pause`,
    null,
    async () => ok(await transitionScheduleTo(caller, id, 'paused')),
  );
}

export async function resumeRecurringSchedule(ctx: RouteCtx): Promise<Response> {
  const caller = requireCaller(ctx.req);
  requireCap(caller, 'invoices.write');
  const id = parseUuidParam(ctx.params.id!);
  return respondWithIdempotency(
    ctx.req,
    caller,
    BUNDLE,
    `${ctx.req.method} /recurring-schedules/:id/resume`,
    null,
    async () => ok(await transitionScheduleTo(caller, id, 'active')),
  );
}

export async function endRecurringSchedule(ctx: RouteCtx): Promise<Response> {
  const caller = requireCaller(ctx.req);
  requireCap(caller, 'invoices.write');
  const id = parseUuidParam(ctx.params.id!);
  return respondWithIdempotency(
    ctx.req,
    caller,
    BUNDLE,
    `${ctx.req.method} /recurring-schedules/:id/end`,
    null,
    async () => ok(await transitionScheduleTo(caller, id, 'ended')),
  );
}
