// TanStack Query hooks for the Job Builder run-scoped build artifacts (ADR 0006
// P2c): labels, scope-of-work steps, the build timeline, and the approval
// jacket, plus the build-from-quote orchestration. Mirrors useJobRuns: shared
// cache config, list/detail reads, and mutations that invalidate the artifact
// key (and, for the jacket, the run detail because the jacket gates start).

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import {
  jobRunsKeys,
  jobRunLabelsKeys,
  jobRunSowStepsKeys,
  jobRunTimelineKeys,
  jobRunJacketKeys,
} from '@/lib/queryKeys/threepl';
import {
  listJobRunLabels,
  createJobRunLabel,
  patchJobRunLabel,
  deleteJobRunLabel,
  listJobRunSowSteps,
  createJobRunSowStep,
  patchJobRunSowStep,
  deleteJobRunSowStep,
  getJobRunTimeline,
  upsertJobRunTimeline,
  getJobRunJacket,
  ensureJobRunJacket,
  transitionJobRunJacket,
  buildJobFromQuote,
  type JobRunLabelCreate,
  type JobRunLabelPatch,
  type JobRunSowStepCreate,
  type JobRunSowStepPatch,
  type JobRunTimelinePatch,
  type JobRunJacketTransition,
  type BuildJobFromQuoteRequest,
} from '@/lib/services/jobArtifactsService';

const C = { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 as const };

// A disabled query needs a stable, never-fetched key when the run id is absent.
const noop = (suffix: string) =>
  ['threepl', 'job_runs', 'detail', '__none__', suffix] as const;

// ---------------------------------------------------------------------------
// labels
// ---------------------------------------------------------------------------

export function useJobRunLabels(runId: string | undefined) {
  return useQuery({
    queryKey: runId ? jobRunLabelsKeys.byRun(runId) : noop('labels'),
    queryFn: () => listJobRunLabels(runId as string),
    enabled: !!runId,
    ...C,
  });
}

export function useCreateJobRunLabel(runId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: JobRunLabelCreate) => createJobRunLabel(runId, input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: jobRunLabelsKeys.byRun(runId) }),
  });
}

export function usePatchJobRunLabel(runId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { labelId: string; input: JobRunLabelPatch }) =>
      patchJobRunLabel(runId, args.labelId, args.input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: jobRunLabelsKeys.byRun(runId) }),
  });
}

export function useDeleteJobRunLabel(runId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (labelId: string) => deleteJobRunLabel(runId, labelId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: jobRunLabelsKeys.byRun(runId) }),
  });
}

// ---------------------------------------------------------------------------
// scope-of-work steps
// ---------------------------------------------------------------------------

export function useJobRunSowSteps(runId: string | undefined) {
  return useQuery({
    queryKey: runId ? jobRunSowStepsKeys.byRun(runId) : noop('sow-steps'),
    queryFn: () => listJobRunSowSteps(runId as string),
    enabled: !!runId,
    ...C,
  });
}

export function useCreateJobRunSowStep(runId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: JobRunSowStepCreate) => createJobRunSowStep(runId, input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: jobRunSowStepsKeys.byRun(runId) }),
  });
}

export function usePatchJobRunSowStep(runId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { stepId: string; input: JobRunSowStepPatch }) =>
      patchJobRunSowStep(runId, args.stepId, args.input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: jobRunSowStepsKeys.byRun(runId) }),
  });
}

export function useDeleteJobRunSowStep(runId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (stepId: string) => deleteJobRunSowStep(runId, stepId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: jobRunSowStepsKeys.byRun(runId) }),
  });
}

// ---------------------------------------------------------------------------
// timeline (singleton per run)
// ---------------------------------------------------------------------------

export function useJobRunTimeline(runId: string | undefined) {
  return useQuery({
    queryKey: runId ? jobRunTimelineKeys.byRun(runId) : noop('timeline'),
    queryFn: () => getJobRunTimeline(runId as string),
    enabled: !!runId,
    ...C,
  });
}

export function useUpsertJobRunTimeline(runId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: JobRunTimelinePatch) => upsertJobRunTimeline(runId, input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: jobRunTimelineKeys.byRun(runId) }),
  });
}

// ---------------------------------------------------------------------------
// jacket (singleton per run; gates start, so mutations also sweep run detail)
// ---------------------------------------------------------------------------

export function useJobRunJacket(runId: string | undefined) {
  return useQuery({
    queryKey: runId ? jobRunJacketKeys.byRun(runId) : noop('jacket'),
    queryFn: () => getJobRunJacket(runId as string),
    enabled: !!runId,
    ...C,
  });
}

function invalidateJacket(qc: ReturnType<typeof useQueryClient>, runId: string): void {
  void qc.invalidateQueries({ queryKey: jobRunJacketKeys.byRun(runId) });
  void qc.invalidateQueries({ queryKey: jobRunsKeys.detail(runId) });
}

export function useEnsureJobRunJacket(runId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => ensureJobRunJacket(runId),
    onSuccess: () => invalidateJacket(qc, runId),
  });
}

export function useTransitionJobRunJacket(runId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: JobRunJacketTransition) => transitionJobRunJacket(runId, input),
    onSuccess: () => invalidateJacket(qc, runId),
  });
}

// ---------------------------------------------------------------------------
// build-from-quote
// ---------------------------------------------------------------------------

export function useBuildJobFromQuote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { quoteId: string; input?: BuildJobFromQuoteRequest }) =>
      buildJobFromQuote(args.quoteId, args.input ?? {}),
    onSuccess: () => void qc.invalidateQueries({ queryKey: jobRunsKeys.all }),
  });
}
