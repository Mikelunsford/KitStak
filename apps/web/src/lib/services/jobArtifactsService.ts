// 3PL Job Builder build-artifact service (ADR 0006 P2c). The four run-scoped
// artifacts the Job Builder hangs off a job_run (migration 0145) plus the
// build-from-quote orchestration, all served by the plugin-gated three-pl-api
// bundle. Sibling to jobRunsService.
//
// The edge handlers return the raw org-scoped row(s); this layer parses them
// against the byte-mirrored canon (lib/types/jobbuilder.ts), matching the
// rate-cards / estimates / job-runs convention. apiClient attaches the
// Idempotency-Key on every non-GET, so handlers never hand-roll it.

import { apiRequest } from '@/lib/apiClient';
import {
  JobRunLabelSchema,
  JobRunSowStepSchema,
  JobRunTimelineSchema,
  JobRunJacketSchema,
  BuildJobFromQuoteResponseSchema,
  type JobRunLabel,
  type JobRunLabelCreate,
  type JobRunLabelPatch,
  type JobRunSowStep,
  type JobRunSowStepCreate,
  type JobRunSowStepPatch,
  type JobRunTimeline,
  type JobRunTimelinePatch,
  type JobRunJacket,
  type JobRunJacketTransition,
  type BuildJobFromQuoteRequest,
  type BuildJobFromQuoteResponse,
} from '@/lib/types/jobbuilder';

export type {
  JobRunLabel,
  JobRunLabelCreate,
  JobRunLabelPatch,
  JobRunSowStep,
  JobRunSowStepCreate,
  JobRunSowStepPatch,
  JobRunTimeline,
  JobRunTimelinePatch,
  JobRunJacket,
  JobRunJacketTransition,
  BuildJobFromQuoteRequest,
  BuildJobFromQuoteResponse,
};

const BASE = '/three-pl-api';
const runBase = (runId: string): string => `${BASE}/job-runs/${runId}`;

type Deleted = { id: string; deleted: boolean };

// ---------------------------------------------------------------------------
// job_run_labels (collection)
// ---------------------------------------------------------------------------

export async function listJobRunLabels(runId: string): Promise<JobRunLabel[]> {
  const data = await apiRequest<unknown>(`${runBase(runId)}/labels`, { method: 'GET' });
  return (data as unknown[]).map((r) => JobRunLabelSchema.parse(r));
}

export async function createJobRunLabel(
  runId: string,
  input: JobRunLabelCreate,
): Promise<JobRunLabel> {
  const data = await apiRequest<unknown>(`${runBase(runId)}/labels`, { method: 'POST', body: input });
  return JobRunLabelSchema.parse(data);
}

export async function patchJobRunLabel(
  runId: string,
  labelId: string,
  input: JobRunLabelPatch,
): Promise<JobRunLabel> {
  const data = await apiRequest<unknown>(`${runBase(runId)}/labels/${labelId}`, { method: 'PATCH', body: input });
  return JobRunLabelSchema.parse(data);
}

export async function deleteJobRunLabel(runId: string, labelId: string): Promise<Deleted> {
  return apiRequest<Deleted>(`${runBase(runId)}/labels/${labelId}`, { method: 'DELETE' });
}

// ---------------------------------------------------------------------------
// job_run_sow_steps (collection)
// ---------------------------------------------------------------------------

export async function listJobRunSowSteps(runId: string): Promise<JobRunSowStep[]> {
  const data = await apiRequest<unknown>(`${runBase(runId)}/sow-steps`, { method: 'GET' });
  return (data as unknown[]).map((r) => JobRunSowStepSchema.parse(r));
}

export async function createJobRunSowStep(
  runId: string,
  input: JobRunSowStepCreate,
): Promise<JobRunSowStep> {
  const data = await apiRequest<unknown>(`${runBase(runId)}/sow-steps`, { method: 'POST', body: input });
  return JobRunSowStepSchema.parse(data);
}

export async function patchJobRunSowStep(
  runId: string,
  stepId: string,
  input: JobRunSowStepPatch,
): Promise<JobRunSowStep> {
  const data = await apiRequest<unknown>(`${runBase(runId)}/sow-steps/${stepId}`, { method: 'PATCH', body: input });
  return JobRunSowStepSchema.parse(data);
}

export async function deleteJobRunSowStep(runId: string, stepId: string): Promise<Deleted> {
  return apiRequest<Deleted>(`${runBase(runId)}/sow-steps/${stepId}`, { method: 'DELETE' });
}

// ---------------------------------------------------------------------------
// job_run_timeline (singleton per run; GET returns the row or null, PUT upserts)
// ---------------------------------------------------------------------------

export async function getJobRunTimeline(runId: string): Promise<JobRunTimeline | null> {
  const data = await apiRequest<unknown>(`${runBase(runId)}/timeline`, { method: 'GET' });
  return data == null ? null : JobRunTimelineSchema.parse(data);
}

export async function upsertJobRunTimeline(
  runId: string,
  input: JobRunTimelinePatch,
): Promise<JobRunTimeline> {
  const data = await apiRequest<unknown>(`${runBase(runId)}/timeline`, { method: 'PUT', body: input });
  return JobRunTimelineSchema.parse(data);
}

// ---------------------------------------------------------------------------
// job_run_jacket (singleton per run; the approval state machine)
// ---------------------------------------------------------------------------

export async function getJobRunJacket(runId: string): Promise<JobRunJacket | null> {
  const data = await apiRequest<unknown>(`${runBase(runId)}/jacket`, { method: 'GET' });
  return data == null ? null : JobRunJacketSchema.parse(data);
}

// Ensure a draft jacket exists (idempotent); returns the existing or new jacket.
export async function ensureJobRunJacket(runId: string): Promise<JobRunJacket> {
  const data = await apiRequest<unknown>(`${runBase(runId)}/jacket`, { method: 'POST', body: {} });
  return JobRunJacketSchema.parse(data);
}

// approve / reject / reopen. reason is required by the server on reject.
export async function transitionJobRunJacket(
  runId: string,
  input: JobRunJacketTransition,
): Promise<JobRunJacket> {
  const data = await apiRequest<unknown>(`${runBase(runId)}/jacket/transition`, { method: 'POST', body: input });
  return JobRunJacketSchema.parse(data);
}

// ---------------------------------------------------------------------------
// build-from-quote: an approved quote becomes a buildable job in one call.
// ---------------------------------------------------------------------------

export async function buildJobFromQuote(
  quoteId: string,
  input: BuildJobFromQuoteRequest = {},
): Promise<BuildJobFromQuoteResponse> {
  const data = await apiRequest<unknown>(`${BASE}/build-from-quote/${quoteId}`, {
    method: 'POST',
    body: input,
  });
  return BuildJobFromQuoteResponseSchema.parse(data);
}
