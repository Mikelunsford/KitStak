// 3PL Job Run service (Wave 12 Phase A6). Lives under the plugin-gated
// three-pl-api bundle (plugins.three_pl), sibling to supplyPlansService.
//
// A job_run is the day-by-day floor execution of a project. Its FSM
// (planned -> in_progress -> completed -> closed; cancel off planned/in_progress)
// moves via server RPCs (start / complete / close / cancel), not table writes.
// Each day's work is a job_run_daily_log; posting a draft log emits the spine
// consumed / produced stock_movements. The apiClient attaches the
// Idempotency-Key for non-GET requests, so handlers never hand-roll it.

import { z } from 'zod';

import { apiRequest } from '@/lib/apiClient';
import { serverListQs, type ServerListParams } from '@/lib/services/serverListQs';
import {
  JobRunSchema,
  JobRunDailyLogSchema,
  JobRunDailyLogConsumedLineSchema,
  JobRunDailyLogProducedLineSchema,
  type JobRun,
  type JobRunStatus,
  type JobRunCreate,
  type JobRunPatch,
  type JobRunDailyLog,
  type JobRunDailyLogCreate,
  type JobRunDailyLogPatch,
  type JobRunDailyLogConsumedLine,
  type JobRunDailyLogConsumedLineCreate,
  type JobRunDailyLogConsumedLineUpdate,
  type JobRunDailyLogProducedLine,
  type JobRunDailyLogProducedLineCreate,
  type JobRunDailyLogProducedLineUpdate,
} from '@/lib/types/threepl';

export type {
  JobRun,
  JobRunStatus,
  JobRunCreate,
  JobRunPatch,
  JobRunDailyLog,
  JobRunDailyLogCreate,
  JobRunDailyLogPatch,
  JobRunDailyLogConsumedLine,
  JobRunDailyLogConsumedLineCreate,
  JobRunDailyLogConsumedLineUpdate,
  JobRunDailyLogProducedLine,
  JobRunDailyLogProducedLineCreate,
  JobRunDailyLogProducedLineUpdate,
};

const BASE = '/three-pl-api/job-runs';

// ---------------------------------------------------------------------------
// job_runs
// ---------------------------------------------------------------------------

export type ListJobRunsFilters = {
  status?: JobRunStatus;
  project_id?: string;
  account_id?: string;
};

function jobRunsQs(f: ListJobRunsFilters): string {
  const p = new URLSearchParams();
  if (f.status) p.set('status', f.status);
  if (f.project_id) p.set('project_id', f.project_id);
  if (f.account_id) p.set('account_id', f.account_id);
  const s = p.toString();
  return s ? `?${s}` : '';
}

// Workstream C (UI scan): the list route now returns a keyset page envelope
// { items, next_cursor } (Shape A / DATA-cursor) on every request, mirroring
// inventory warehouses / copack. The legacy flat-list reader extracts items.
const JobRunListEnvelope = z.object({
  items: z.array(JobRunSchema),
  next_cursor: z.string().nullable().optional(),
});

export async function listJobRuns(
  filters: ListJobRunsFilters = {},
): Promise<JobRun[]> {
  const raw = await apiRequest<unknown>(`${BASE}${jobRunsQs(filters)}`, {
    method: 'GET',
  });
  return JobRunListEnvelope.parse(raw).items;
}

export async function listJobRunsPage(
  params: ServerListParams,
): Promise<{ items: JobRun[]; next_cursor: string | null }> {
  const raw = await apiRequest<unknown>(`${BASE}${serverListQs(params)}`, {
    method: 'GET',
  });
  const parsed = JobRunListEnvelope.parse(raw);
  return { items: parsed.items, next_cursor: parsed.next_cursor ?? null };
}

export async function getJobRun(id: string): Promise<JobRun> {
  const data = await apiRequest<unknown>(`${BASE}/${id}`, { method: 'GET' });
  return JobRunSchema.parse(data);
}

export async function createJobRun(input: JobRunCreate): Promise<JobRun> {
  const data = await apiRequest<unknown>(BASE, { method: 'POST', body: input });
  return JobRunSchema.parse(data);
}

export async function updateJobRun(
  id: string,
  input: JobRunPatch,
): Promise<JobRun> {
  const data = await apiRequest<unknown>(`${BASE}/${id}`, {
    method: 'PATCH',
    body: input,
  });
  return JobRunSchema.parse(data);
}

export async function softDeleteJobRun(
  id: string,
): Promise<{ id: string; deleted: boolean }> {
  return apiRequest<{ id: string; deleted: boolean }>(`${BASE}/${id}`, {
    method: 'DELETE',
  });
}

// FSM transitions. Each is a server RPC; the response is the updated run.
export async function startJobRun(id: string): Promise<JobRun> {
  const data = await apiRequest<unknown>(`${BASE}/${id}/start`, { method: 'POST' });
  return JobRunSchema.parse(data);
}

export async function completeJobRun(id: string): Promise<JobRun> {
  const data = await apiRequest<unknown>(`${BASE}/${id}/complete`, { method: 'POST' });
  return JobRunSchema.parse(data);
}

export async function closeJobRun(id: string): Promise<JobRun> {
  const data = await apiRequest<unknown>(`${BASE}/${id}/close`, { method: 'POST' });
  return JobRunSchema.parse(data);
}

export async function cancelJobRun(id: string): Promise<JobRun> {
  const data = await apiRequest<unknown>(`${BASE}/${id}/cancel`, { method: 'POST' });
  return JobRunSchema.parse(data);
}

// ---------------------------------------------------------------------------
// job_run_daily_logs (one day's work; posting emits the stock movements)
// ---------------------------------------------------------------------------

export async function listJobRunDailyLogs(
  runId: string,
): Promise<JobRunDailyLog[]> {
  const data = await apiRequest<unknown>(`${BASE}/${runId}/daily-logs`, {
    method: 'GET',
  });
  return (data as JobRunDailyLog[]).map((r) => JobRunDailyLogSchema.parse(r));
}

export async function createJobRunDailyLog(
  runId: string,
  input: JobRunDailyLogCreate,
): Promise<JobRunDailyLog> {
  const data = await apiRequest<unknown>(`${BASE}/${runId}/daily-logs`, {
    method: 'POST',
    body: input,
  });
  return JobRunDailyLogSchema.parse(data);
}

export async function updateJobRunDailyLog(
  runId: string,
  logId: string,
  input: JobRunDailyLogPatch,
): Promise<JobRunDailyLog> {
  const data = await apiRequest<unknown>(`${BASE}/${runId}/daily-logs/${logId}`, {
    method: 'PATCH',
    body: input,
  });
  return JobRunDailyLogSchema.parse(data);
}

export async function deleteJobRunDailyLog(
  runId: string,
  logId: string,
): Promise<{ id: string; deleted: boolean }> {
  return apiRequest<{ id: string; deleted: boolean }>(
    `${BASE}/${runId}/daily-logs/${logId}`,
    { method: 'DELETE' },
  );
}

// post: emit the consumed / produced stock movements; draft -> posted.
export async function postJobRunDailyLog(
  runId: string,
  logId: string,
): Promise<JobRunDailyLog> {
  const data = await apiRequest<unknown>(
    `${BASE}/${runId}/daily-logs/${logId}/post`,
    { method: 'POST' },
  );
  return JobRunDailyLogSchema.parse(data);
}

// ---------------------------------------------------------------------------
// job_run_daily_log line items (consumed item_id required; produced nullable).
// Editable only while the parent log is draft.
// ---------------------------------------------------------------------------

export async function listJobRunDailyLogConsumedLines(
  runId: string,
  logId: string,
): Promise<JobRunDailyLogConsumedLine[]> {
  const data = await apiRequest<unknown>(
    `${BASE}/${runId}/daily-logs/${logId}/consumed-lines`,
    { method: 'GET' },
  );
  return (data as JobRunDailyLogConsumedLine[]).map((r) =>
    JobRunDailyLogConsumedLineSchema.parse(r),
  );
}

export async function createJobRunDailyLogConsumedLine(
  runId: string,
  logId: string,
  input: JobRunDailyLogConsumedLineCreate,
): Promise<JobRunDailyLogConsumedLine> {
  const data = await apiRequest<unknown>(
    `${BASE}/${runId}/daily-logs/${logId}/consumed-lines`,
    { method: 'POST', body: input },
  );
  return JobRunDailyLogConsumedLineSchema.parse(data);
}

export async function updateJobRunDailyLogConsumedLine(
  runId: string,
  logId: string,
  lineId: string,
  input: JobRunDailyLogConsumedLineUpdate,
): Promise<JobRunDailyLogConsumedLine> {
  const data = await apiRequest<unknown>(
    `${BASE}/${runId}/daily-logs/${logId}/consumed-lines/${lineId}`,
    { method: 'PATCH', body: input },
  );
  return JobRunDailyLogConsumedLineSchema.parse(data);
}

export async function deleteJobRunDailyLogConsumedLine(
  runId: string,
  logId: string,
  lineId: string,
): Promise<{ id: string; deleted: boolean }> {
  return apiRequest<{ id: string; deleted: boolean }>(
    `${BASE}/${runId}/daily-logs/${logId}/consumed-lines/${lineId}`,
    { method: 'DELETE' },
  );
}

export async function listJobRunDailyLogProducedLines(
  runId: string,
  logId: string,
): Promise<JobRunDailyLogProducedLine[]> {
  const data = await apiRequest<unknown>(
    `${BASE}/${runId}/daily-logs/${logId}/produced-lines`,
    { method: 'GET' },
  );
  return (data as JobRunDailyLogProducedLine[]).map((r) =>
    JobRunDailyLogProducedLineSchema.parse(r),
  );
}

export async function createJobRunDailyLogProducedLine(
  runId: string,
  logId: string,
  input: JobRunDailyLogProducedLineCreate,
): Promise<JobRunDailyLogProducedLine> {
  const data = await apiRequest<unknown>(
    `${BASE}/${runId}/daily-logs/${logId}/produced-lines`,
    { method: 'POST', body: input },
  );
  return JobRunDailyLogProducedLineSchema.parse(data);
}

export async function updateJobRunDailyLogProducedLine(
  runId: string,
  logId: string,
  lineId: string,
  input: JobRunDailyLogProducedLineUpdate,
): Promise<JobRunDailyLogProducedLine> {
  const data = await apiRequest<unknown>(
    `${BASE}/${runId}/daily-logs/${logId}/produced-lines/${lineId}`,
    { method: 'PATCH', body: input },
  );
  return JobRunDailyLogProducedLineSchema.parse(data);
}

export async function deleteJobRunDailyLogProducedLine(
  runId: string,
  logId: string,
  lineId: string,
): Promise<{ id: string; deleted: boolean }> {
  return apiRequest<{ id: string; deleted: boolean }>(
    `${BASE}/${runId}/daily-logs/${logId}/produced-lines/${lineId}`,
    { method: 'DELETE' },
  );
}
