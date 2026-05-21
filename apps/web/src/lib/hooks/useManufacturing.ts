// Manufacturing TanStack Query hooks. Path A5 of the Manufacturing wiring
// plan. Pillar 2.
//
// Mirrors the useOps.ts canon:
//   - C = { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 } per the
//     SPA constitution defaults.
//   - Every mutation invalidates the relevant manufacturingRunsKeys AND
//     auditLogKeys.byEntity('manufacturing_run', id) per F-Wave6-AUDIT-02 /
//     F-Wave7-AUDIT-CACHE-SWEEP-01. The DB writes audit_log rows on state
//     transitions; SPA must invalidate the timeline so the operator sees the
//     entry without refresh.
//   - Mutation hooks return the `mutation` object (callers use mutation.error
//     for inline rendering per F-Wave7-MUTATION-ERRORS-SWEEP-01).

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { auditLogKeys } from '@/lib/queryKeys/auditLog';
import { manufacturingRunsKeys } from '@/lib/queryKeys/manufacturing';
import {
  listManufacturingRuns, getManufacturingRun, createManufacturingRun,
  updateManufacturingRun, deleteManufacturingRun,
  startManufacturingRun, completeManufacturingRun, cancelManufacturingRun,
  listConsumedLineItems, createConsumedLineItem, updateConsumedLineItem,
  deleteConsumedLineItem,
  listProducedLineItems, createProducedLineItem, updateProducedLineItem,
  deleteProducedLineItem,
  type ListManufacturingRunsFilters,
  type ManufacturingRunCreate,
  type ManufacturingRunPatch,
  type ManufacturingRunConsumedLineItemCreate,
  type ManufacturingRunConsumedLineItemUpdate,
  type ManufacturingRunProducedLineItemCreate,
  type ManufacturingRunProducedLineItemUpdate,
} from '@/lib/services/manufacturingService';

const C = { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 as const };

// --- parent runs ---

export function useManufacturingRunsList(filters: ListManufacturingRunsFilters = {}) {
  return useQuery({
    queryKey: manufacturingRunsKeys.list(filters),
    queryFn: () => listManufacturingRuns(filters),
    ...C,
  });
}

export function useManufacturingRun(id: string | undefined) {
  return useQuery({
    queryKey: id
      ? manufacturingRunsKeys.detail(id)
      : ['manufacturing', 'runs', 'detail', 'noop'],
    queryFn: () => getManufacturingRun(id as string),
    enabled: !!id,
    ...C,
  });
}

export function useCreateManufacturingRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ManufacturingRunCreate) => createManufacturingRun(input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: manufacturingRunsKeys.all });
    },
  });
}

export function useUpdateManufacturingRun(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ManufacturingRunPatch) => updateManufacturingRun(id, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: manufacturingRunsKeys.all });
      void qc.invalidateQueries({ queryKey: auditLogKeys.byEntity('manufacturing_run', id) });
    },
  });
}

export function useDeleteManufacturingRun(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => deleteManufacturingRun(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: manufacturingRunsKeys.all });
      void qc.invalidateQueries({ queryKey: auditLogKeys.byEntity('manufacturing_run', id) });
    },
  });
}

export function useStartManufacturingRun(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => startManufacturingRun(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: manufacturingRunsKeys.all });
      void qc.invalidateQueries({ queryKey: auditLogKeys.byEntity('manufacturing_run', id) });
    },
  });
}

export function useCompleteManufacturingRun(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => completeManufacturingRun(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: manufacturingRunsKeys.all });
      void qc.invalidateQueries({ queryKey: auditLogKeys.byEntity('manufacturing_run', id) });
    },
  });
}

export function useCancelManufacturingRun(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => cancelManufacturingRun(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: manufacturingRunsKeys.all });
      void qc.invalidateQueries({ queryKey: auditLogKeys.byEntity('manufacturing_run', id) });
    },
  });
}

// --- consumed line items ---

export function useManufacturingRunConsumedLines(runId: string | undefined) {
  return useQuery({
    queryKey: runId
      ? manufacturingRunsKeys.consumed(runId)
      : ['manufacturing', 'runs', 'detail', '__none__', 'consumed'],
    queryFn: () => listConsumedLineItems(runId as string),
    enabled: !!runId,
    ...C,
  });
}

export function useAddConsumedLine(runId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ManufacturingRunConsumedLineItemCreate) =>
      createConsumedLineItem(runId, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: manufacturingRunsKeys.consumed(runId) });
      void qc.invalidateQueries({ queryKey: manufacturingRunsKeys.detail(runId) });
      void qc.invalidateQueries({ queryKey: auditLogKeys.byEntity('manufacturing_run', runId) });
    },
  });
}

export function useUpdateConsumedLine(runId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { lineId: string; body: ManufacturingRunConsumedLineItemUpdate }) =>
      updateConsumedLineItem(runId, args.lineId, args.body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: manufacturingRunsKeys.consumed(runId) });
      void qc.invalidateQueries({ queryKey: manufacturingRunsKeys.detail(runId) });
      void qc.invalidateQueries({ queryKey: auditLogKeys.byEntity('manufacturing_run', runId) });
    },
  });
}

export function useDeleteConsumedLine(runId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (lineId: string) => deleteConsumedLineItem(runId, lineId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: manufacturingRunsKeys.consumed(runId) });
      void qc.invalidateQueries({ queryKey: manufacturingRunsKeys.detail(runId) });
      void qc.invalidateQueries({ queryKey: auditLogKeys.byEntity('manufacturing_run', runId) });
    },
  });
}

// --- produced line items ---

export function useManufacturingRunProducedLines(runId: string | undefined) {
  return useQuery({
    queryKey: runId
      ? manufacturingRunsKeys.produced(runId)
      : ['manufacturing', 'runs', 'detail', '__none__', 'produced'],
    queryFn: () => listProducedLineItems(runId as string),
    enabled: !!runId,
    ...C,
  });
}

export function useAddProducedLine(runId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ManufacturingRunProducedLineItemCreate) =>
      createProducedLineItem(runId, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: manufacturingRunsKeys.produced(runId) });
      void qc.invalidateQueries({ queryKey: manufacturingRunsKeys.detail(runId) });
      void qc.invalidateQueries({ queryKey: auditLogKeys.byEntity('manufacturing_run', runId) });
    },
  });
}

export function useUpdateProducedLine(runId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { lineId: string; body: ManufacturingRunProducedLineItemUpdate }) =>
      updateProducedLineItem(runId, args.lineId, args.body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: manufacturingRunsKeys.produced(runId) });
      void qc.invalidateQueries({ queryKey: manufacturingRunsKeys.detail(runId) });
      void qc.invalidateQueries({ queryKey: auditLogKeys.byEntity('manufacturing_run', runId) });
    },
  });
}

export function useDeleteProducedLine(runId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (lineId: string) => deleteProducedLineItem(runId, lineId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: manufacturingRunsKeys.produced(runId) });
      void qc.invalidateQueries({ queryKey: manufacturingRunsKeys.detail(runId) });
      void qc.invalidateQueries({ queryKey: auditLogKeys.byEntity('manufacturing_run', runId) });
    },
  });
}
