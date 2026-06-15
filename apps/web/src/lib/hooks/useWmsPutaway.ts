// TanStack Query hooks for WMS Putaway (Wave 12 Body B Phase B3). Mirrors
// useJobRuns: shared cache config, list/detail reads, and mutations that
// invalidate the entity key plus the task's audit timeline so the detail
// HISTORY rail reflects the latest state. The FSM transitions (start / complete
// / cancel) go through the server RPCs; completing a task also moves stock, so
// the success handler invalidates the putaway key and the audit timeline.

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { auditLogKeys } from '@/lib/queryKeys/auditLog';
import { wmsPutawayKeys } from '@/lib/queryKeys/wms';
import {
  listWmsPutaway,
  getWmsPutaway,
  createWmsPutaway,
  updateWmsPutaway,
  softDeleteWmsPutaway,
  startWmsPutaway,
  completeWmsPutaway,
  cancelWmsPutaway,
  type PutawayTask,
  type PutawayTaskCreate,
  type PutawayTaskPatch,
  type ListWmsPutawayFilters,
} from '@/lib/services/wmsPutawayService';

const C = { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 as const };

// putaway_task entity_type for the audit timeline (migration 0109
// audit_append_state_change trigger writes rows under this type).
const PUTAWAY_ENTITY = 'putaway_task';

export function useWmsPutawayList(filters: ListWmsPutawayFilters = {}) {
  return useQuery({
    queryKey: wmsPutawayKeys.list(filters),
    queryFn: () => listWmsPutaway(filters),
    ...C,
  });
}

export function useWmsPutawayTask(id: string | undefined) {
  return useQuery({
    queryKey: id
      ? wmsPutawayKeys.detail(id)
      : ['wms', 'putaway_tasks', 'detail', 'noop'],
    queryFn: () => getWmsPutaway(id as string),
    enabled: !!id,
    ...C,
  });
}

export function useCreateWmsPutaway() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: PutawayTaskCreate) => createWmsPutaway(input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: wmsPutawayKeys.all });
    },
  });
}

export function useUpdateWmsPutaway(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: PutawayTaskPatch) => updateWmsPutaway(id, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: wmsPutawayKeys.all });
      void qc.invalidateQueries({ queryKey: auditLogKeys.byEntity(PUTAWAY_ENTITY, id) });
    },
  });
}

export function useSoftDeleteWmsPutaway(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => softDeleteWmsPutaway(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: wmsPutawayKeys.all });
      void qc.invalidateQueries({ queryKey: auditLogKeys.byEntity(PUTAWAY_ENTITY, id) });
    },
  });
}

function useTransitionWmsPutaway(
  id: string,
  fn: (id: string) => Promise<PutawayTask>,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => fn(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: wmsPutawayKeys.all });
      void qc.invalidateQueries({ queryKey: auditLogKeys.byEntity(PUTAWAY_ENTITY, id) });
    },
  });
}

export function useStartWmsPutaway(id: string) {
  return useTransitionWmsPutaway(id, startWmsPutaway);
}
export function useCompleteWmsPutaway(id: string) {
  return useTransitionWmsPutaway(id, completeWmsPutaway);
}
export function useCancelWmsPutaway(id: string) {
  return useTransitionWmsPutaway(id, cancelWmsPutaway);
}

export type { PutawayTask };
