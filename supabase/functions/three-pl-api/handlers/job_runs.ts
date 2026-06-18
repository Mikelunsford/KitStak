// three-pl-api job-runs handlers. job_runs (parent; floor execution; FSM
// planned / in_progress / completed / closed / cancelled; start / complete /
// close / cancel are RPCs), job_run_daily_logs (child; one day's work; FSM
// draft / posted; post is an RPC that emits the consumed / produced
// movements), and the daily-log consumed / produced line items (editable only
// while the parent log is draft). Handler bodies moved verbatim from the
// former monolithic index.ts during the R-W13-DX-01 structural split; no
// behaviour change.

import type { RouteCtx } from '../../_shared/route.ts';
import { ApiError, ok, internalError } from '../../_shared/responses.ts';
import {
  admin, parseBody, parseUuidParam, respondWithIdempotency, created, requireCap,
} from '../../_shared/handler-helpers.ts';
import { requireCaller } from '../../_shared/tenant.ts';
import { assertRefInOrg } from '../../_shared/crud.ts';
import { nextDocNumber } from '../../_shared/numbering.ts';
import {
  JobRunSchema,
  JobRunCreateSchema,
  JobRunPatchSchema,
  JobRunDailyLogSchema,
  JobRunDailyLogCreateSchema,
  JobRunDailyLogPatchSchema,
  JobRunDailyLogConsumedLineSchema,
  JobRunDailyLogConsumedLineCreateSchema,
  JobRunDailyLogConsumedLineUpdateSchema,
  JobRunDailyLogProducedLineSchema,
  JobRunDailyLogProducedLineCreateSchema,
  JobRunDailyLogProducedLineUpdateSchema,
} from '../../_shared/types/threepl.ts';
import {
  BUNDLE, nowIso, loadJobRun, assertJobRunParent, loadJobRunDailyLog,
  assertDailyLogParent, nextDailyLogLinePosition, buildTemplateSnapshot,
} from './_helpers.ts';

export async function listJobRuns({ req, url }: RouteCtx): Promise<Response> {
  const caller = requireCaller(req);
  const status = url.searchParams.get('status');
  const projectId = url.searchParams.get('project_id');
  const accountId = url.searchParams.get('account_id');
  let q = admin()
    .from('job_runs').select('*')
    .eq('org_id', caller.orgId).is('deleted_at', null)
    .order('created_at', { ascending: false }).limit(200);
  if (status) q = q.eq('status', status);
  if (projectId) q = q.eq('project_id', projectId);
  if (accountId) q = q.eq('account_id', accountId);
  const { data, error } = await q;
  if (error) throw internalError(BUNDLE, error);
  return ok((data ?? []).map((r) => JobRunSchema.parse(r)));
}

export async function createJobRun({ req }: RouteCtx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'threepl.job_run.create');
  const body = await parseBody(req, JobRunCreateSchema);
  return respondWithIdempotency(req, caller, BUNDLE, '/job-runs', body, async () => {
    // Optional spine refs; a cross-tenant or missing ref resolves to
    // NOT_FOUND 404 (never copied).
    if (body.project_id) { await assertRefInOrg('projects', caller, body.project_id); }
    if (body.account_id) { await assertRefInOrg('three_pl_accounts', caller, body.account_id); }
    if (body.warehouse_id) { await assertRefInOrg('warehouses', caller, body.warehouse_id); }
    // Freeze the source job-template snapshot at creation (decision 2):
    // an explicit template freezes a fresh snapshot; else inherit the
    // project's frozen snapshot (set at convert). Org-scoped throughout.
    let jobTemplateId = body.job_template_id ?? null;
    let snapshot: Record<string, unknown> | null = null;
    if (body.job_template_id) {
      await assertRefInOrg('job_templates', caller, body.job_template_id);
      snapshot = await buildTemplateSnapshot(caller, body.job_template_id);
    } else if (body.project_id) {
      const { data: proj, error: perr } = await admin().from('projects')
        .select('job_template_snapshot, source_job_template_id')
        .eq('org_id', caller.orgId).eq('id', body.project_id).maybeSingle();
      if (perr) throw internalError(BUNDLE, perr);
      if (proj) {
        snapshot = (proj.job_template_snapshot as Record<string, unknown> | null) ?? null;
        jobTemplateId = (proj.source_job_template_id as string | null) ?? null;
      }
    }
    const runNumber = body.run_number?.trim()
      ? body.run_number.trim()
      : await nextDocNumber(caller.orgId, 'job_run');
    const insert: Record<string, unknown> = {
      org_id: caller.orgId,
      run_number: runNumber,
      project_id: body.project_id ?? null,
      account_id: body.account_id ?? null,
      job_template_id: jobTemplateId,
      job_template_snapshot: snapshot,
      warehouse_id: body.warehouse_id ?? null,
      status: 'planned',
      notes: body.notes ?? null,
      payload: body.payload ?? {},
      created_by: caller.userId,
      updated_by: caller.userId,
    };
    const { data, error } = await admin().from('job_runs')
      .insert(insert).select('*').single();
    if (error) throw internalError(BUNDLE, error);
    return created(JobRunSchema.parse(data));
  });
}

export async function getJobRun({ req, params }: RouteCtx): Promise<Response> {
  const caller = requireCaller(req);
  parseUuidParam(params.id);
  const row = await loadJobRun(caller, params.id);
  return ok(row);
}

export async function patchJobRun({ req, params }: RouteCtx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'threepl.job_run.update');
  parseUuidParam(params.id);
  const body = await parseBody(req, JobRunPatchSchema);
  return respondWithIdempotency(req, caller, BUNDLE, '/job-runs/:id', body, async () => {
    await assertJobRunParent(caller, params.id);
    if (body.project_id) { await assertRefInOrg('projects', caller, body.project_id); }
    if (body.account_id) { await assertRefInOrg('three_pl_accounts', caller, body.account_id); }
    if (body.job_template_id) { await assertRefInOrg('job_templates', caller, body.job_template_id); }
    if (body.warehouse_id) { await assertRefInOrg('warehouses', caller, body.warehouse_id); }
    const patch: Record<string, unknown> = {
      updated_by: caller.userId,
      updated_at: nowIso(),
    };
    if (body.project_id !== undefined) patch.project_id = body.project_id;
    if (body.account_id !== undefined) patch.account_id = body.account_id;
    if (body.job_template_id !== undefined) patch.job_template_id = body.job_template_id;
    if (body.warehouse_id !== undefined) patch.warehouse_id = body.warehouse_id;
    if (body.run_number !== undefined) patch.run_number = body.run_number;
    if (body.notes !== undefined) patch.notes = body.notes;
    if (body.payload !== undefined) patch.payload = body.payload;
    const { data, error } = await admin().from('job_runs')
      .update(patch)
      .eq('org_id', caller.orgId).eq('id', params.id).is('deleted_at', null)
      .select('*').maybeSingle();
    if (error) throw internalError(BUNDLE, error);
    if (!data) throw new ApiError('NOT_FOUND', 404);
    return ok(JobRunSchema.parse(data));
  });
}

export async function deleteJobRun({ req, params }: RouteCtx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'threepl.job_run.update');
  parseUuidParam(params.id);
  return respondWithIdempotency(req, caller, BUNDLE, '/job-runs/:id-delete', null, async () => {
    await assertJobRunParent(caller, params.id);
    const { data, error } = await admin().from('job_runs')
      .update({ deleted_at: nowIso(), updated_by: caller.userId, updated_at: nowIso() })
      .eq('org_id', caller.orgId).eq('id', params.id).is('deleted_at', null)
      .select('id').maybeSingle();
    if (error) throw internalError(BUNDLE, error);
    if (!data) throw new ApiError('NOT_FOUND', 404);
    return ok({ id: params.id, deleted: true });
  });
}

export async function startJobRun({ req, params }: RouteCtx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'threepl.job_run.start');
  parseUuidParam(params.id);
  return respondWithIdempotency(req, caller, BUNDLE, '/job-runs/:id/start', null, async () => {
    const { error } = await admin().rpc('start_job_run', {
      p_run_id: params.id, p_actor: caller.userId, p_caller_org_id: caller.orgId,
    });
    if (error) {
      if (/NOT_FOUND/.test(error.message)) throw new ApiError('NOT_FOUND', 404);
      if (/STATE_CONFLICT/.test(error.message)) throw new ApiError('STATE_CONFLICT', 409, error.message);
      throw internalError(BUNDLE, error);
    }
    return ok(await loadJobRun(caller, params.id));
  });
}

export async function completeJobRun({ req, params }: RouteCtx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'threepl.job_run.complete');
  parseUuidParam(params.id);
  return respondWithIdempotency(req, caller, BUNDLE, '/job-runs/:id/complete', null, async () => {
    const { error } = await admin().rpc('complete_job_run', {
      p_run_id: params.id, p_actor: caller.userId, p_caller_org_id: caller.orgId,
    });
    if (error) {
      if (/NOT_FOUND/.test(error.message)) throw new ApiError('NOT_FOUND', 404);
      if (/STATE_CONFLICT/.test(error.message)) throw new ApiError('STATE_CONFLICT', 409, error.message);
      throw internalError(BUNDLE, error);
    }
    return ok(await loadJobRun(caller, params.id));
  });
}

export async function closeJobRun({ req, params }: RouteCtx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'threepl.job_run.close');
  parseUuidParam(params.id);
  return respondWithIdempotency(req, caller, BUNDLE, '/job-runs/:id/close', null, async () => {
    const { error } = await admin().rpc('close_job_run', {
      p_run_id: params.id, p_actor: caller.userId, p_caller_org_id: caller.orgId,
    });
    if (error) {
      if (/NOT_FOUND/.test(error.message)) throw new ApiError('NOT_FOUND', 404);
      if (/STATE_CONFLICT/.test(error.message)) throw new ApiError('STATE_CONFLICT', 409, error.message);
      throw internalError(BUNDLE, error);
    }
    return ok(await loadJobRun(caller, params.id));
  });
}

export async function cancelJobRun({ req, params }: RouteCtx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'threepl.job_run.cancel');
  parseUuidParam(params.id);
  return respondWithIdempotency(req, caller, BUNDLE, '/job-runs/:id/cancel', null, async () => {
    const { error } = await admin().rpc('cancel_job_run', {
      p_run_id: params.id, p_actor: caller.userId, p_caller_org_id: caller.orgId,
    });
    if (error) {
      if (/NOT_FOUND/.test(error.message)) throw new ApiError('NOT_FOUND', 404);
      if (/STATE_CONFLICT/.test(error.message)) throw new ApiError('STATE_CONFLICT', 409, error.message);
      throw internalError(BUNDLE, error);
    }
    return ok(await loadJobRun(caller, params.id));
  });
}

// ---------------------------------------------------------------------------
// job_run_daily_logs (child of job_runs; one day's work; FSM draft / posted)
// ---------------------------------------------------------------------------

export async function listJobRunDailyLogs({ req, params }: RouteCtx): Promise<Response> {
  const caller = requireCaller(req);
  parseUuidParam(params.id);
  await assertJobRunParent(caller, params.id);
  const { data, error } = await admin()
    .from('job_run_daily_logs').select('*')
    .eq('org_id', caller.orgId).eq('job_run_id', params.id)
    .order('log_date', { ascending: false }).order('created_at', { ascending: false });
  if (error) throw internalError(BUNDLE, error);
  return ok((data ?? []).map((r) => JobRunDailyLogSchema.parse(r)));
}

export async function createJobRunDailyLog({ req, params }: RouteCtx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'threepl.job_run.daily_log.create');
  parseUuidParam(params.id);
  const body = await parseBody(req, JobRunDailyLogCreateSchema);
  return respondWithIdempotency(req, caller, BUNDLE, '/job-runs/:id/daily-logs', body, async () => {
    await assertJobRunParent(caller, params.id);
    if (body.kitforce_time_entry_id) {
      await assertRefInOrg('time_entries', caller, body.kitforce_time_entry_id, { softDelete: false });
    }
    const insert: Record<string, unknown> = {
      org_id: caller.orgId,
      job_run_id: params.id,
      labor_hours: body.labor_hours ?? 0,
      labor_rate_cents: body.labor_rate_cents ?? null,
      kitforce_time_entry_id: body.kitforce_time_entry_id ?? null,
      status: 'draft',
      notes: body.notes ?? null,
      created_by: caller.userId,
      updated_by: caller.userId,
    };
    if (body.log_date) insert.log_date = body.log_date;
    const { data, error } = await admin().from('job_run_daily_logs')
      .insert(insert).select('*').single();
    if (error) throw internalError(BUNDLE, error);
    return created(JobRunDailyLogSchema.parse(data));
  });
}

export async function getJobRunDailyLog({ req, params }: RouteCtx): Promise<Response> {
  const caller = requireCaller(req);
  parseUuidParam(params.id);
  parseUuidParam(params.lid, 'lid');
  return ok(await loadJobRunDailyLog(caller, params.id, params.lid));
}

export async function patchJobRunDailyLog({ req, params }: RouteCtx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'threepl.job_run.daily_log.update');
  parseUuidParam(params.id);
  parseUuidParam(params.lid, 'lid');
  const body = await parseBody(req, JobRunDailyLogPatchSchema);
  return respondWithIdempotency(req, caller, BUNDLE, '/job-runs/:id/daily-logs/:lid', body, async () => {
    await assertDailyLogParent(caller, params.id, params.lid);
    if (body.kitforce_time_entry_id) {
      await assertRefInOrg('time_entries', caller, body.kitforce_time_entry_id, { softDelete: false });
    }
    const patch: Record<string, unknown> = { updated_by: caller.userId };
    if (body.log_date !== undefined) patch.log_date = body.log_date;
    if (body.labor_hours !== undefined) patch.labor_hours = body.labor_hours;
    if (body.labor_rate_cents !== undefined) patch.labor_rate_cents = body.labor_rate_cents;
    if (body.kitforce_time_entry_id !== undefined) patch.kitforce_time_entry_id = body.kitforce_time_entry_id;
    if (body.notes !== undefined) patch.notes = body.notes;
    const { data, error } = await admin().from('job_run_daily_logs')
      .update(patch)
      .eq('org_id', caller.orgId).eq('job_run_id', params.id).eq('id', params.lid)
      .select('*').maybeSingle();
    if (error) throw internalError(BUNDLE, error);
    if (!data) throw new ApiError('NOT_FOUND', 404);
    return ok(JobRunDailyLogSchema.parse(data));
  });
}

export async function deleteJobRunDailyLog({ req, params }: RouteCtx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'threepl.job_run.daily_log.update');
  parseUuidParam(params.id);
  parseUuidParam(params.lid, 'lid');
  return respondWithIdempotency(req, caller, BUNDLE, '/job-runs/:id/daily-logs/:lid-delete', null, async () => {
    // A posted log emitted stock_movements; deleting it would orphan them.
    // Only a draft log may be removed (STATE_CONFLICT 409 otherwise).
    const log = await loadJobRunDailyLog(caller, params.id, params.lid);
    if (log.status !== 'draft') {
      throw new ApiError('STATE_CONFLICT', 409, 'daily log is posted');
    }
    const { data, error } = await admin().from('job_run_daily_logs').delete()
      .eq('org_id', caller.orgId).eq('job_run_id', params.id).eq('id', params.lid)
      .select('id').maybeSingle();
    if (error) throw internalError(BUNDLE, error);
    if (!data) throw new ApiError('NOT_FOUND', 404);
    return ok({ id: params.lid, deleted: true });
  });
}

export async function postJobRunDailyLog({ req, params }: RouteCtx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'threepl.job_run.daily_log.post');
  parseUuidParam(params.id);
  parseUuidParam(params.lid, 'lid');
  return respondWithIdempotency(req, caller, BUNDLE, '/job-runs/:id/daily-logs/:lid/post', null, async () => {
    // Validate the (run, log) pairing BEFORE the stock-affecting RPC so a
    // mismatched run id resolves to 404 with no movements emitted (matches
    // the sibling line routes).
    await assertDailyLogParent(caller, params.id, params.lid);
    // post_job_run_daily_log (A6) emits the consumed / produced movements and
    // moves draft -> posted. NOT_FOUND (404) cross-tenant / missing;
    // STATE_CONFLICT (409) when not draft. Idempotent on an already-posted log.
    const { error } = await admin().rpc('post_job_run_daily_log', {
      p_log_id: params.lid, p_actor: caller.userId, p_caller_org_id: caller.orgId,
    });
    if (error) {
      if (/NOT_FOUND/.test(error.message)) throw new ApiError('NOT_FOUND', 404);
      if (/STATE_CONFLICT/.test(error.message)) throw new ApiError('STATE_CONFLICT', 409, error.message);
      throw internalError(BUNDLE, error);
    }
    return ok(await loadJobRunDailyLog(caller, params.id, params.lid));
  });
}

// ---------------------------------------------------------------------------
// job_run_daily_log line items (consumed item_id REQUIRED; produced NULLABLE).
// Editable only while the parent log is draft. Reuse the daily_log.update cap.
// ---------------------------------------------------------------------------

export async function listConsumedLines({ req, params }: RouteCtx): Promise<Response> {
  const caller = requireCaller(req);
  parseUuidParam(params.id);
  parseUuidParam(params.lid, 'lid');
  await assertDailyLogParent(caller, params.id, params.lid);
  const { data, error } = await admin()
    .from('job_run_daily_log_consumed_line_items').select('*')
    .eq('org_id', caller.orgId).eq('job_run_daily_log_id', params.lid)
    .order('position', { ascending: true });
  if (error) throw internalError(BUNDLE, error);
  return ok((data ?? []).map((r) => JobRunDailyLogConsumedLineSchema.parse(r)));
}

export async function createConsumedLine({ req, params }: RouteCtx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'threepl.job_run.daily_log.update');
  parseUuidParam(params.id);
  parseUuidParam(params.lid, 'lid');
  const body = await parseBody(req, JobRunDailyLogConsumedLineCreateSchema);
  return respondWithIdempotency(
    req, caller, BUNDLE, '/job-runs/:id/daily-logs/:lid/consumed-lines', body,
    async () => {
      const log = await loadJobRunDailyLog(caller, params.id, params.lid);
      if (log.status !== 'draft') throw new ApiError('STATE_CONFLICT', 409, 'daily log is posted');
      await assertRefInOrg('items', caller, body.item_id);
      const position = body.position ?? await nextDailyLogLinePosition(caller, 'job_run_daily_log_consumed_line_items', params.lid);
      const insert = {
        org_id: caller.orgId,
        job_run_daily_log_id: params.lid,
        item_id: body.item_id,
        quantity: body.quantity ?? 0,
        unit_cost_cents: body.unit_cost_cents ?? null,
        uom: body.uom ?? null,
        supply_source: body.supply_source ?? null,
        position,
        created_by: caller.userId,
        updated_by: caller.userId,
      };
      const { data, error } = await admin()
        .from('job_run_daily_log_consumed_line_items').insert(insert).select('*').single();
      if (error) throw internalError(BUNDLE, error);
      return created(JobRunDailyLogConsumedLineSchema.parse(data));
    },
  );
}

export async function patchConsumedLine({ req, params }: RouteCtx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'threepl.job_run.daily_log.update');
  parseUuidParam(params.id);
  parseUuidParam(params.lid, 'lid');
  parseUuidParam(params.cid, 'cid');
  const body = await parseBody(req, JobRunDailyLogConsumedLineUpdateSchema);
  return respondWithIdempotency(
    req, caller, BUNDLE, '/job-runs/:id/daily-logs/:lid/consumed-lines/:cid', body,
    async () => {
      const log = await loadJobRunDailyLog(caller, params.id, params.lid);
      if (log.status !== 'draft') throw new ApiError('STATE_CONFLICT', 409, 'daily log is posted');
      if (body.item_id) { await assertRefInOrg('items', caller, body.item_id); }
      const patch: Record<string, unknown> = { updated_by: caller.userId };
      if (body.item_id !== undefined) patch.item_id = body.item_id;
      if (body.quantity !== undefined) patch.quantity = body.quantity;
      if (body.unit_cost_cents !== undefined) patch.unit_cost_cents = body.unit_cost_cents;
      if (body.uom !== undefined) patch.uom = body.uom;
      if (body.supply_source !== undefined) patch.supply_source = body.supply_source;
      if (body.position !== undefined) patch.position = body.position;
      const { data, error } = await admin()
        .from('job_run_daily_log_consumed_line_items').update(patch)
        .eq('org_id', caller.orgId).eq('job_run_daily_log_id', params.lid).eq('id', params.cid)
        .select('*').maybeSingle();
      if (error) throw internalError(BUNDLE, error);
      if (!data) throw new ApiError('NOT_FOUND', 404);
      return ok(JobRunDailyLogConsumedLineSchema.parse(data));
    },
  );
}

export async function deleteConsumedLine({ req, params }: RouteCtx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'threepl.job_run.daily_log.update');
  parseUuidParam(params.id);
  parseUuidParam(params.lid, 'lid');
  parseUuidParam(params.cid, 'cid');
  return respondWithIdempotency(
    req, caller, BUNDLE, '/job-runs/:id/daily-logs/:lid/consumed-lines/:cid-delete', null,
    async () => {
      const log = await loadJobRunDailyLog(caller, params.id, params.lid);
      if (log.status !== 'draft') throw new ApiError('STATE_CONFLICT', 409, 'daily log is posted');
      const { data, error } = await admin()
        .from('job_run_daily_log_consumed_line_items').delete()
        .eq('org_id', caller.orgId).eq('job_run_daily_log_id', params.lid).eq('id', params.cid)
        .select('id').maybeSingle();
      if (error) throw internalError(BUNDLE, error);
      if (!data) throw new ApiError('NOT_FOUND', 404);
      return ok({ id: params.cid, deleted: true });
    },
  );
}

export async function listProducedLines({ req, params }: RouteCtx): Promise<Response> {
  const caller = requireCaller(req);
  parseUuidParam(params.id);
  parseUuidParam(params.lid, 'lid');
  await assertDailyLogParent(caller, params.id, params.lid);
  const { data, error } = await admin()
    .from('job_run_daily_log_produced_line_items').select('*')
    .eq('org_id', caller.orgId).eq('job_run_daily_log_id', params.lid)
    .order('position', { ascending: true });
  if (error) throw internalError(BUNDLE, error);
  return ok((data ?? []).map((r) => JobRunDailyLogProducedLineSchema.parse(r)));
}

export async function createProducedLine({ req, params }: RouteCtx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'threepl.job_run.daily_log.update');
  parseUuidParam(params.id);
  parseUuidParam(params.lid, 'lid');
  const body = await parseBody(req, JobRunDailyLogProducedLineCreateSchema);
  return respondWithIdempotency(
    req, caller, BUNDLE, '/job-runs/:id/daily-logs/:lid/produced-lines', body,
    async () => {
      const log = await loadJobRunDailyLog(caller, params.id, params.lid);
      if (log.status !== 'draft') throw new ApiError('STATE_CONFLICT', 409, 'daily log is posted');
      if (body.item_id) { await assertRefInOrg('items', caller, body.item_id); }
      const position = body.position ?? await nextDailyLogLinePosition(caller, 'job_run_daily_log_produced_line_items', params.lid);
      const insert = {
        org_id: caller.orgId,
        job_run_daily_log_id: params.lid,
        item_id: body.item_id ?? null,
        quantity: body.quantity ?? 0,
        unit_cost_cents: body.unit_cost_cents ?? null,
        uom: body.uom ?? null,
        position,
        created_by: caller.userId,
        updated_by: caller.userId,
      };
      const { data, error } = await admin()
        .from('job_run_daily_log_produced_line_items').insert(insert).select('*').single();
      if (error) throw internalError(BUNDLE, error);
      return created(JobRunDailyLogProducedLineSchema.parse(data));
    },
  );
}

export async function patchProducedLine({ req, params }: RouteCtx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'threepl.job_run.daily_log.update');
  parseUuidParam(params.id);
  parseUuidParam(params.lid, 'lid');
  parseUuidParam(params.pid, 'pid');
  const body = await parseBody(req, JobRunDailyLogProducedLineUpdateSchema);
  return respondWithIdempotency(
    req, caller, BUNDLE, '/job-runs/:id/daily-logs/:lid/produced-lines/:pid', body,
    async () => {
      const log = await loadJobRunDailyLog(caller, params.id, params.lid);
      if (log.status !== 'draft') throw new ApiError('STATE_CONFLICT', 409, 'daily log is posted');
      if (body.item_id) { await assertRefInOrg('items', caller, body.item_id); }
      const patch: Record<string, unknown> = { updated_by: caller.userId };
      if (body.item_id !== undefined) patch.item_id = body.item_id;
      if (body.quantity !== undefined) patch.quantity = body.quantity;
      if (body.unit_cost_cents !== undefined) patch.unit_cost_cents = body.unit_cost_cents;
      if (body.uom !== undefined) patch.uom = body.uom;
      if (body.position !== undefined) patch.position = body.position;
      const { data, error } = await admin()
        .from('job_run_daily_log_produced_line_items').update(patch)
        .eq('org_id', caller.orgId).eq('job_run_daily_log_id', params.lid).eq('id', params.pid)
        .select('*').maybeSingle();
      if (error) throw internalError(BUNDLE, error);
      if (!data) throw new ApiError('NOT_FOUND', 404);
      return ok(JobRunDailyLogProducedLineSchema.parse(data));
    },
  );
}

export async function deleteProducedLine({ req, params }: RouteCtx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'threepl.job_run.daily_log.update');
  parseUuidParam(params.id);
  parseUuidParam(params.lid, 'lid');
  parseUuidParam(params.pid, 'pid');
  return respondWithIdempotency(
    req, caller, BUNDLE, '/job-runs/:id/daily-logs/:lid/produced-lines/:pid-delete', null,
    async () => {
      const log = await loadJobRunDailyLog(caller, params.id, params.lid);
      if (log.status !== 'draft') throw new ApiError('STATE_CONFLICT', 409, 'daily log is posted');
      const { data, error } = await admin()
        .from('job_run_daily_log_produced_line_items').delete()
        .eq('org_id', caller.orgId).eq('job_run_daily_log_id', params.lid).eq('id', params.pid)
        .select('id').maybeSingle();
      if (error) throw internalError(BUNDLE, error);
      if (!data) throw new ApiError('NOT_FOUND', 404);
      return ok({ id: params.pid, deleted: true });
    },
  );
}
