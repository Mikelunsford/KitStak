// TanStack Query hooks for WMS Putaway (Wave 12 Body B Phase B3). Mirrors
// useJobRuns: shared cache config, list/detail reads, and mutations that
// invalidate the entity key plus the task's audit timeline so the detail
// HISTORY rail reflects the latest state. The FSM transitions (start / complete
// / cancel) go through the server RPCs; completing a task also moves stock, so
// the success handler invalidates the putaway key and the audit timeline.

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { track } from '@/lib/analytics';
import { buildPutawayTransitionedProps } from '@/lib/hooks/pillarAnalytics';
import { auditLogKeys } from '@/lib/queryKeys/auditLog';
import { wmsPutawayKeys } from '@/lib/queryKeys/wms';
import { transitionInvalidationKeys } from './transitionInvalidation';
import {
  listWmsPutaway,
  getWmsPutaway,
  createWmsPutaway,
  setWmsPutawayDestination,
  startWmsPutaway,
  completeWmsPutaway,
  cancelWmsPutaway,
  type PutawayTask,
  type PutawayTaskCreate,
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

function useTransitionWmsPutaway(
  id: string,
  fn: (id: string) => Promise<PutawayTask>,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => fn(id),
    onSuccess: (task) => {
      // R-W13-UX-01: invalidate the detail key explicitly (not only via the
      // `all` prefix) so the StateStepper, action buttons, and totals on the
      // task detail page refresh the instant the transition succeeds, with no
      // manual reload. transitionInvalidationKeys sweeps the detail key, the
      // entity tree, and the audit timeline, and the key set is tested.
      for (const queryKey of transitionInvalidationKeys(wmsPutawayKeys, PUTAWAY_ENTITY, id)) {
        void qc.invalidateQueries({ queryKey });
      }
      // R-W13-OBS-01: emit the putaway FSM transition funnel event. Task id
      // and post-transition status enum only; no bin labels or quantities.
      track('putaway_transitioned', buildPutawayTransitionedProps(task.id, task.status));
    },
  });
}

// Set the destination bin on a still-open task. Like the transitions, it
// invalidates the putaway cache and the task's audit timeline (the field edit is
// audited with the status unchanged).
export function useSetWmsPutawayDestination(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (actualLocationId: string) =>
      setWmsPutawayDestination(id, actualLocationId),
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
