// three-pl-api job build-artifact handlers (ADR 0006 P2b). The four run-scoped
// artifacts the Job Builder hangs off a job_run (migration 0145):
//   - job_run_labels      labels with their printed data per label kind
//   - job_run_sow_steps   structured scope-of-work steps
//   - job_run_timeline    one build/ship timeline per run (planned + actuals)
//   - job_run_jacket      the approval jacket (state machine, gates start)
//
// Reads are RLS-only (no read cap), matching the bundle convention; every read
// asserts the parent job_run is in the caller's org first, so a cross-tenant
// run id resolves to 404. Writes reuse threepl.job_run.update (editing the
// artifacts is editing the run); the jacket approve / reject is the same cap (a
// dedicated approval cap is a clean follow-up if finer control is wanted). All
// non-GET handlers are idempotency-keyed and org-scoped (Pattern A).
//
// Responses return the raw org-scoped row(s); the SPA service layer parses them
// against the byte-mirrored canon (types/jobbuilder.ts), matching the
// rate-cards-api / estimates-api convention. Request bodies are still validated
// here with parseBody.

import type { RouteCtx } from '../../_shared/route.ts';
import { ApiError, ok, internalError } from '../../_shared/responses.ts';
import {
  admin, parseBody, parseUuidParam, respondWithIdempotency, created, requireCap,
} from '../../_shared/handler-helpers.ts';
import { requireCaller } from '../../_shared/tenant.ts';
import {
  JobRunLabelCreateSchema, JobRunLabelPatchSchema,
  JobRunSowStepCreateSchema, JobRunSowStepPatchSchema,
  JobRunTimelinePatchSchema,
  JobRunJacketTransitionSchema,
} from '../../_shared/types/jobbuilder.ts';
import { BUNDLE, nowIso, assertJobRunParent } from './_helpers.ts';

// Next append position for a run-scoped child table (max(position) + 1).
async function nextArtifactPosition(orgId: string, table: string, runId: string): Promise<number> {
  const { data, error } = await admin().from(table)
    .select('position')
    .eq('org_id', orgId).eq('job_run_id', runId)
    .order('position', { ascending: false }).limit(1).maybeSingle();
  if (error) throw internalError(BUNDLE, error);
  return ((data?.position as number | undefined) ?? -1) + 1;
}

// ---------------------------------------------------------------------------
// job_run_labels
// ---------------------------------------------------------------------------

export async function listJobRunLabels({ req, params }: RouteCtx): Promise<Response> {
  const caller = requireCaller(req);
  parseUuidParam(params.id);
  await assertJobRunParent(caller, params.id);
  const { data, error } = await admin().from('job_run_labels').select('*')
    .eq('org_id', caller.orgId).eq('job_run_id', params.id)
    .order('position', { ascending: true });
  if (error) throw internalError(BUNDLE, error);
  return ok(data ?? []);
}

export async function createJobRunLabel({ req, params }: RouteCtx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'threepl.job_run.update');
  parseUuidParam(params.id);
  const body = await parseBody(req, JobRunLabelCreateSchema);
  return respondWithIdempotency(req, caller, BUNDLE, '/job-runs/:id/labels', body, async () => {
    await assertJobRunParent(caller, params.id);
    const position = body.position ?? await nextArtifactPosition(caller.orgId, 'job_run_labels', params.id);
    const insert = {
      org_id: caller.orgId, job_run_id: params.id,
      label_kind: body.label_kind, size: body.size ?? null,
      data: body.data ?? {}, qty: body.qty ?? 0, position,
      created_by: caller.userId, updated_by: caller.userId,
    };
    const { data, error } = await admin().from('job_run_labels').insert(insert).select('*').single();
    if (error) throw internalError(BUNDLE, error);
    return created(data);
  });
}

export async function patchJobRunLabel({ req, params }: RouteCtx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'threepl.job_run.update');
  parseUuidParam(params.id);
  parseUuidParam(params.labelId, 'labelId');
  const body = await parseBody(req, JobRunLabelPatchSchema);
  return respondWithIdempotency(req, caller, BUNDLE, '/job-runs/:id/labels/:labelId', body, async () => {
    await assertJobRunParent(caller, params.id);
    const patch: Record<string, unknown> = { updated_by: caller.userId, updated_at: nowIso() };
    for (const k of ['label_kind', 'size', 'data', 'qty', 'position'] as const) {
      if (body[k] !== undefined) patch[k] = body[k];
    }
    const { data, error } = await admin().from('job_run_labels').update(patch)
      .eq('org_id', caller.orgId).eq('job_run_id', params.id).eq('id', params.labelId)
      .select('*').maybeSingle();
    if (error) throw internalError(BUNDLE, error);
    if (!data) throw new ApiError('NOT_FOUND', 404);
    return ok(data);
  });
}

export async function deleteJobRunLabel({ req, params }: RouteCtx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'threepl.job_run.update');
  parseUuidParam(params.id);
  parseUuidParam(params.labelId, 'labelId');
  return respondWithIdempotency(req, caller, BUNDLE, '/job-runs/:id/labels/:labelId-delete', null, async () => {
    const { data, error } = await admin().from('job_run_labels').delete()
      .eq('org_id', caller.orgId).eq('job_run_id', params.id).eq('id', params.labelId)
      .select('id').maybeSingle();
    if (error) throw internalError(BUNDLE, error);
    if (!data) throw new ApiError('NOT_FOUND', 404);
    return ok({ id: params.labelId, deleted: true });
  });
}

// ---------------------------------------------------------------------------
// job_run_sow_steps
// ---------------------------------------------------------------------------

export async function listJobRunSowSteps({ req, params }: RouteCtx): Promise<Response> {
  const caller = requireCaller(req);
  parseUuidParam(params.id);
  await assertJobRunParent(caller, params.id);
  const { data, error } = await admin().from('job_run_sow_steps').select('*')
    .eq('org_id', caller.orgId).eq('job_run_id', params.id)
    .order('position', { ascending: true });
  if (error) throw internalError(BUNDLE, error);
  return ok(data ?? []);
}

export async function createJobRunSowStep({ req, params }: RouteCtx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'threepl.job_run.update');
  parseUuidParam(params.id);
  const body = await parseBody(req, JobRunSowStepCreateSchema);
  return respondWithIdempotency(req, caller, BUNDLE, '/job-runs/:id/sow-steps', body, async () => {
    await assertJobRunParent(caller, params.id);
    const position = body.position ?? await nextArtifactPosition(caller.orgId, 'job_run_sow_steps', params.id);
    const insert = {
      org_id: caller.orgId, job_run_id: params.id,
      step_no: body.step_no ?? position, title: body.title,
      detail: body.detail ?? null, duration_hours: body.duration_hours ?? null, position,
      created_by: caller.userId, updated_by: caller.userId,
    };
    const { data, error } = await admin().from('job_run_sow_steps').insert(insert).select('*').single();
    if (error) throw internalError(BUNDLE, error);
    return created(data);
  });
}

export async function patchJobRunSowStep({ req, params }: RouteCtx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'threepl.job_run.update');
  parseUuidParam(params.id);
  parseUuidParam(params.stepId, 'stepId');
  const body = await parseBody(req, JobRunSowStepPatchSchema);
  return respondWithIdempotency(req, caller, BUNDLE, '/job-runs/:id/sow-steps/:stepId', body, async () => {
    await assertJobRunParent(caller, params.id);
    const patch: Record<string, unknown> = { updated_by: caller.userId, updated_at: nowIso() };
    for (const k of ['step_no', 'title', 'detail', 'duration_hours', 'position'] as const) {
      if (body[k] !== undefined) patch[k] = body[k];
    }
    const { data, error } = await admin().from('job_run_sow_steps').update(patch)
      .eq('org_id', caller.orgId).eq('job_run_id', params.id).eq('id', params.stepId)
      .select('*').maybeSingle();
    if (error) throw internalError(BUNDLE, error);
    if (!data) throw new ApiError('NOT_FOUND', 404);
    return ok(data);
  });
}

export async function deleteJobRunSowStep({ req, params }: RouteCtx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'threepl.job_run.update');
  parseUuidParam(params.id);
  parseUuidParam(params.stepId, 'stepId');
  return respondWithIdempotency(req, caller, BUNDLE, '/job-runs/:id/sow-steps/:stepId-delete', null, async () => {
    const { data, error } = await admin().from('job_run_sow_steps').delete()
      .eq('org_id', caller.orgId).eq('job_run_id', params.id).eq('id', params.stepId)
      .select('id').maybeSingle();
    if (error) throw internalError(BUNDLE, error);
    if (!data) throw new ApiError('NOT_FOUND', 404);
    return ok({ id: params.stepId, deleted: true });
  });
}

// ---------------------------------------------------------------------------
// job_run_timeline (one per run; upsert)
// ---------------------------------------------------------------------------

export async function getJobRunTimeline({ req, params }: RouteCtx): Promise<Response> {
  const caller = requireCaller(req);
  parseUuidParam(params.id);
  await assertJobRunParent(caller, params.id);
  const { data, error } = await admin().from('job_run_timeline').select('*')
    .eq('org_id', caller.orgId).eq('job_run_id', params.id).maybeSingle();
  if (error) throw internalError(BUNDLE, error);
  return ok(data ?? null);
}

export async function upsertJobRunTimeline({ req, params }: RouteCtx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'threepl.job_run.update');
  parseUuidParam(params.id);
  const body = await parseBody(req, JobRunTimelinePatchSchema);
  return respondWithIdempotency(req, caller, BUNDLE, '/job-runs/:id/timeline', body, async () => {
    await assertJobRunParent(caller, params.id);
    const fields: Record<string, unknown> = {};
    for (const k of [
      'mabd', 'materials_eta', 'build_start', 'build_end', 'ship_date',
      'materials_received_on', 'build_started_on', 'build_ended_on', 'shipped_on', 'notes',
    ] as const) {
      if (body[k] !== undefined) fields[k] = body[k];
    }
    const row = {
      org_id: caller.orgId, job_run_id: params.id, ...fields,
      updated_by: caller.userId, updated_at: nowIso(), created_by: caller.userId,
    };
    const { data, error } = await admin().from('job_run_timeline')
      .upsert(row, { onConflict: 'job_run_id' }).select('*').single();
    if (error) throw internalError(BUNDLE, error);
    return ok(data);
  });
}

// ---------------------------------------------------------------------------
// job_run_jacket (one per run; state machine draft -> approved / rejected)
// ---------------------------------------------------------------------------

export async function getJobRunJacket({ req, params }: RouteCtx): Promise<Response> {
  const caller = requireCaller(req);
  parseUuidParam(params.id);
  await assertJobRunParent(caller, params.id);
  return ok(await loadJacketRow(caller.orgId, params.id));
}

// Ensure a draft jacket exists for the run (idempotent). Returns the existing
// jacket if one is already present, else creates a draft.
export async function ensureJobRunJacket({ req, params }: RouteCtx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'threepl.job_run.update');
  parseUuidParam(params.id);
  return respondWithIdempotency(req, caller, BUNDLE, '/job-runs/:id/jacket', { job_run_id: params.id }, async () => {
    await assertJobRunParent(caller, params.id);
    const existing = await loadJacketRow(caller.orgId, params.id);
    if (existing) return ok(existing);
    const { data, error } = await admin().from('job_run_jacket')
      .insert({
        org_id: caller.orgId, job_run_id: params.id, status: 'draft',
        created_by: caller.userId, updated_by: caller.userId,
      })
      .select('*').single();
    if (error) throw internalError(BUNDLE, error);
    return created(data);
  });
}

// Legal jacket transitions. approve from draft/rejected; reject from draft;
// reopen from approved/rejected back to draft. Anything else is STATE_CONFLICT.
const JACKET_NEXT: Record<'approve' | 'reject' | 'reopen', { from: string[]; to: string }> = {
  approve: { from: ['draft', 'rejected'], to: 'approved' },
  reject: { from: ['draft'], to: 'rejected' },
  reopen: { from: ['approved', 'rejected'], to: 'draft' },
};

export async function transitionJobRunJacket({ req, params }: RouteCtx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'threepl.job_run.update');
  parseUuidParam(params.id);
  const body = await parseBody(req, JobRunJacketTransitionSchema);
  return respondWithIdempotency(req, caller, BUNDLE, '/job-runs/:id/jacket/transition', body, async () => {
    await assertJobRunParent(caller, params.id);
    const jacket = await loadJacketRow(caller.orgId, params.id);
    if (!jacket) throw new ApiError('NOT_FOUND', 404, 'no jacket for this run');
    const rule = JACKET_NEXT[body.decision];
    const from = jacket.status as string;
    if (!rule.from.includes(from)) {
      throw new ApiError('STATE_CONFLICT', 409, `cannot ${body.decision} a ${from} jacket`);
    }
    if (body.decision === 'reject' && !body.reason?.trim()) {
      throw new ApiError('VALIDATION_ERROR', 422, 'a rejection reason is required');
    }
    const patch: Record<string, unknown> = {
      status: rule.to, updated_by: caller.userId, updated_at: nowIso(),
    };
    if (body.decision === 'approve') {
      patch.approved_by = caller.userId; patch.approved_at = nowIso();
      patch.rejected_by = null; patch.rejected_at = null; patch.rejection_reason = null;
    } else if (body.decision === 'reject') {
      patch.rejected_by = caller.userId; patch.rejected_at = nowIso();
      patch.rejection_reason = body.reason ?? null;
      patch.approved_by = null; patch.approved_at = null;
    } else {
      patch.approved_by = null; patch.approved_at = null;
      patch.rejected_by = null; patch.rejected_at = null; patch.rejection_reason = null;
    }
    const { data, error } = await admin().from('job_run_jacket').update(patch)
      .eq('org_id', caller.orgId).eq('job_run_id', params.id)
      .select('*').maybeSingle();
    if (error) throw internalError(BUNDLE, error);
    if (!data) throw new ApiError('NOT_FOUND', 404);
    return ok(data);
  });
}

// Org-scoped jacket row for a run, or null. Shared by the jacket handlers and
// the start-gate in job_runs.ts.
export async function loadJacketRow(
  orgId: string, runId: string,
): Promise<Record<string, unknown> | null> {
  const { data, error } = await admin().from('job_run_jacket').select('*')
    .eq('org_id', orgId).eq('job_run_id', runId).maybeSingle();
  if (error) throw internalError(BUNDLE, error);
  return (data as Record<string, unknown> | null) ?? null;
}
