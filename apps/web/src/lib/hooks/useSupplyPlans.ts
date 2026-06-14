// TanStack Query hooks for the 3PL Supply Plan (Wave 12 Phase A5). Mirrors
// useJobTemplates: shared cache config, list/detail reads, and mutations that
// invalidate the entity key plus the plan's audit timeline. Release and cancel
// also invalidate the plan's lines (they rewrite available / reserved /
// shortage) and the detail so the new status renders.

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { auditLogKeys } from '@/lib/queryKeys/auditLog';
import { supplyPlansKeys, supplyPlanLinesKeys } from '@/lib/queryKeys/threepl';
import {
  listSupplyPlans,
  getSupplyPlan,
  createSupplyPlan,
  updateSupplyPlan,
  softDeleteSupplyPlan,
  releaseSupplyPlan,
  cancelSupplyPlan,
  listSupplyPlanLines,
  createSupplyPlanLine,
  updateSupplyPlanLine,
  deleteSupplyPlanLine,
  type SupplyPlan,
  type SupplyPlanCreate,
  type SupplyPlanPatch,
  type ListSupplyPlansFilters,
  type SupplyPlanLineCreate,
  type SupplyPlanLineUpdate,
} from '@/lib/services/supplyPlansService';

const C = { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 as const };

// supply_plan entity_type for the audit timeline (migration 0096 audit trigger
// writes rows under this type).
const SUPPLY_PLAN_ENTITY = 'supply_plan';

// ---------------------------------------------------------------------------
// supply_plans
// ---------------------------------------------------------------------------

export function useSupplyPlansList(filters: ListSupplyPlansFilters = {}) {
  return useQuery({
    queryKey: supplyPlansKeys.list(filters),
    queryFn: () => listSupplyPlans(filters),
    ...C,
  });
}

export function useSupplyPlan(id: string | undefined) {
  return useQuery({
    queryKey: id
      ? supplyPlansKeys.detail(id)
      : ['threepl', 'supply_plans', 'detail', 'noop'],
    queryFn: () => getSupplyPlan(id as string),
    enabled: !!id,
    ...C,
  });
}

export function useCreateSupplyPlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SupplyPlanCreate) => createSupplyPlan(input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: supplyPlansKeys.all });
    },
  });
}

export function useUpdateSupplyPlan(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SupplyPlanPatch) => updateSupplyPlan(id, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: supplyPlansKeys.all });
      void qc.invalidateQueries({ queryKey: auditLogKeys.byEntity(SUPPLY_PLAN_ENTITY, id) });
    },
  });
}

export function useSoftDeleteSupplyPlan(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => softDeleteSupplyPlan(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: supplyPlansKeys.all });
      void qc.invalidateQueries({ queryKey: auditLogKeys.byEntity(SUPPLY_PLAN_ENTITY, id) });
    },
  });
}

// Release reserves available stock and records the shortage; it rewrites the
// lines, so invalidate them alongside the plan and its timeline.
export function useReleaseSupplyPlan(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => releaseSupplyPlan(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: supplyPlansKeys.all });
      void qc.invalidateQueries({ queryKey: supplyPlanLinesKeys.byPlan(id) });
      void qc.invalidateQueries({ queryKey: auditLogKeys.byEntity(SUPPLY_PLAN_ENTITY, id) });
    },
  });
}

export function useCancelSupplyPlan(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => cancelSupplyPlan(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: supplyPlansKeys.all });
      void qc.invalidateQueries({ queryKey: supplyPlanLinesKeys.byPlan(id) });
      void qc.invalidateQueries({ queryKey: auditLogKeys.byEntity(SUPPLY_PLAN_ENTITY, id) });
    },
  });
}

// ---------------------------------------------------------------------------
// supply_plan_lines
// ---------------------------------------------------------------------------

export function useSupplyPlanLines(planId: string | undefined) {
  return useQuery({
    queryKey: planId
      ? supplyPlanLinesKeys.byPlan(planId)
      : ['threepl', 'supply_plans', 'detail', '__none__', 'lines'],
    queryFn: () => listSupplyPlanLines(planId as string),
    enabled: !!planId,
    ...C,
  });
}

export function useCreateSupplyPlanLine(planId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SupplyPlanLineCreate) =>
      createSupplyPlanLine(planId, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: supplyPlanLinesKeys.byPlan(planId) });
    },
  });
}

export function useUpdateSupplyPlanLine(planId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { lineId: string; body: SupplyPlanLineUpdate }) =>
      updateSupplyPlanLine(planId, args.lineId, args.body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: supplyPlanLinesKeys.byPlan(planId) });
    },
  });
}

export function useDeleteSupplyPlanLine(planId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (lineId: string) => deleteSupplyPlanLine(planId, lineId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: supplyPlanLinesKeys.byPlan(planId) });
    },
  });
}

export type { SupplyPlan };
