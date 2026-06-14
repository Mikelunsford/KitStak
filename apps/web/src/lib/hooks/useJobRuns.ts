// TanStack Query hooks for the 3PL Job Run (Wave 12 Phase A6). Mirrors
// useSupplyPlans: shared cache config, list/detail reads, and mutations that
// invalidate the entity key plus the run's audit timeline. The FSM transitions
// and daily-log posting also invalidate the run's daily logs (and the posting
// rewrites stock). Daily-log line mutations invalidate that log's line key.

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { auditLogKeys } from '@/lib/queryKeys/auditLog';
import {
  jobRunsKeys,
  jobRunDailyLogsKeys,
  jobRunDailyLogLinesKeys,
} from '@/lib/queryKeys/threepl';
import {
  listJobRuns,
  getJobRun,
  createJobRun,
  updateJobRun,
  softDeleteJobRun,
  startJobRun,
  completeJobRun,
  closeJobRun,
  cancelJobRun,
  listJobRunDailyLogs,
  createJobRunDailyLog,
  updateJobRunDailyLog,
  deleteJobRunDailyLog,
  postJobRunDailyLog,
  listJobRunDailyLogConsumedLines,
  createJobRunDailyLogConsumedLine,
  updateJobRunDailyLogConsumedLine,
  deleteJobRunDailyLogConsumedLine,
  listJobRunDailyLogProducedLines,
  createJobRunDailyLogProducedLine,
  updateJobRunDailyLogProducedLine,
  deleteJobRunDailyLogProducedLine,
  type JobRun,
  type JobRunCreate,
  type JobRunPatch,
  type ListJobRunsFilters,
  type JobRunDailyLogCreate,
  type JobRunDailyLogPatch,
  type JobRunDailyLogConsumedLineCreate,
  type JobRunDailyLogConsumedLineUpdate,
  type JobRunDailyLogProducedLineCreate,
  type JobRunDailyLogProducedLineUpdate,
} from '@/lib/services/jobRunsService';

const C = { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 as const };

// job_run entity_type for the audit timeline (migration 0098 audit trigger).
const JOB_RUN_ENTITY = 'job_run';

// ---------------------------------------------------------------------------
// job_runs
// ---------------------------------------------------------------------------

export function useJobRunsList(filters: ListJobRunsFilters = {}) {
  return useQuery({
    queryKey: jobRunsKeys.list(filters),
    queryFn: () => listJobRuns(filters),
    ...C,
  });
}

export function useJobRun(id: string | undefined) {
  return useQuery({
    queryKey: id
      ? jobRunsKeys.detail(id)
      : ['threepl', 'job_runs', 'detail', 'noop'],
    queryFn: () => getJobRun(id as string),
    enabled: !!id,
    ...C,
  });
}

export function useCreateJobRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: JobRunCreate) => createJobRun(input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: jobRunsKeys.all });
    },
  });
}

export function useUpdateJobRun(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: JobRunPatch) => updateJobRun(id, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: jobRunsKeys.all });
      void qc.invalidateQueries({ queryKey: auditLogKeys.byEntity(JOB_RUN_ENTITY, id) });
    },
  });
}

export function useSoftDeleteJobRun(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => softDeleteJobRun(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: jobRunsKeys.all });
      void qc.invalidateQueries({ queryKey: auditLogKeys.byEntity(JOB_RUN_ENTITY, id) });
    },
  });
}

function useTransitionJobRun(id: string, fn: (id: string) => Promise<JobRun>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => fn(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: jobRunsKeys.all });
      void qc.invalidateQueries({ queryKey: auditLogKeys.byEntity(JOB_RUN_ENTITY, id) });
    },
  });
}

export function useStartJobRun(id: string) {
  return useTransitionJobRun(id, startJobRun);
}
export function useCompleteJobRun(id: string) {
  return useTransitionJobRun(id, completeJobRun);
}
export function useCloseJobRun(id: string) {
  return useTransitionJobRun(id, closeJobRun);
}
export function useCancelJobRun(id: string) {
  return useTransitionJobRun(id, cancelJobRun);
}

// ---------------------------------------------------------------------------
// job_run_daily_logs
// ---------------------------------------------------------------------------

export function useJobRunDailyLogs(runId: string | undefined) {
  return useQuery({
    queryKey: runId
      ? jobRunDailyLogsKeys.byRun(runId)
      : ['threepl', 'job_runs', 'detail', '__none__', 'daily-logs'],
    queryFn: () => listJobRunDailyLogs(runId as string),
    enabled: !!runId,
    ...C,
  });
}

export function useCreateJobRunDailyLog(runId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: JobRunDailyLogCreate) =>
      createJobRunDailyLog(runId, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: jobRunDailyLogsKeys.byRun(runId) });
    },
  });
}

export function useUpdateJobRunDailyLog(runId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { logId: string; body: JobRunDailyLogPatch }) =>
      updateJobRunDailyLog(runId, args.logId, args.body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: jobRunDailyLogsKeys.byRun(runId) });
    },
  });
}

export function useDeleteJobRunDailyLog(runId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (logId: string) => deleteJobRunDailyLog(runId, logId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: jobRunDailyLogsKeys.byRun(runId) });
    },
  });
}

// Posting flips the log draft -> posted, rewrites its lines, and emits the spine
// stock movements. Invalidate the run's daily logs and detail (which sweeps the
// log's line keys). The run's own audit timeline (entity_type job_run) is not
// touched: the post writes job_run_daily_log audit rows, not job_run rows.
export function usePostJobRunDailyLog(runId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (logId: string) => postJobRunDailyLog(runId, logId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: jobRunDailyLogsKeys.byRun(runId) });
      void qc.invalidateQueries({ queryKey: jobRunsKeys.detail(runId) });
    },
  });
}

// ---------------------------------------------------------------------------
// job_run_daily_log line items
// ---------------------------------------------------------------------------

export function useJobRunDailyLogConsumedLines(
  runId: string | undefined,
  logId: string | undefined,
) {
  return useQuery({
    queryKey:
      runId && logId
        ? [...jobRunDailyLogLinesKeys.byLog(runId, logId), 'consumed']
        : ['threepl', 'job_runs', 'detail', '__none__', 'lines', 'consumed'],
    queryFn: () =>
      listJobRunDailyLogConsumedLines(runId as string, logId as string),
    enabled: !!runId && !!logId,
    ...C,
  });
}

export function useJobRunDailyLogProducedLines(
  runId: string | undefined,
  logId: string | undefined,
) {
  return useQuery({
    queryKey:
      runId && logId
        ? [...jobRunDailyLogLinesKeys.byLog(runId, logId), 'produced']
        : ['threepl', 'job_runs', 'detail', '__none__', 'lines', 'produced'],
    queryFn: () =>
      listJobRunDailyLogProducedLines(runId as string, logId as string),
    enabled: !!runId && !!logId,
    ...C,
  });
}

export function useCreateJobRunDailyLogConsumedLine(runId: string, logId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: JobRunDailyLogConsumedLineCreate) =>
      createJobRunDailyLogConsumedLine(runId, logId, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: jobRunDailyLogLinesKeys.byLog(runId, logId) });
    },
  });
}

export function useUpdateJobRunDailyLogConsumedLine(runId: string, logId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { lineId: string; body: JobRunDailyLogConsumedLineUpdate }) =>
      updateJobRunDailyLogConsumedLine(runId, logId, args.lineId, args.body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: jobRunDailyLogLinesKeys.byLog(runId, logId) });
    },
  });
}

export function useDeleteJobRunDailyLogConsumedLine(runId: string, logId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (lineId: string) =>
      deleteJobRunDailyLogConsumedLine(runId, logId, lineId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: jobRunDailyLogLinesKeys.byLog(runId, logId) });
    },
  });
}

export function useCreateJobRunDailyLogProducedLine(runId: string, logId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: JobRunDailyLogProducedLineCreate) =>
      createJobRunDailyLogProducedLine(runId, logId, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: jobRunDailyLogLinesKeys.byLog(runId, logId) });
    },
  });
}

export function useUpdateJobRunDailyLogProducedLine(runId: string, logId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { lineId: string; body: JobRunDailyLogProducedLineUpdate }) =>
      updateJobRunDailyLogProducedLine(runId, logId, args.lineId, args.body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: jobRunDailyLogLinesKeys.byLog(runId, logId) });
    },
  });
}

export function useDeleteJobRunDailyLogProducedLine(runId: string, logId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (lineId: string) =>
      deleteJobRunDailyLogProducedLine(runId, logId, lineId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: jobRunDailyLogLinesKeys.byLog(runId, logId) });
    },
  });
}

export type { JobRun };
