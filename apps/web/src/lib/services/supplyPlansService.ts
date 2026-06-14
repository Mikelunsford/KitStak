// 3PL Supply Plan service (Wave 12 Phase A5). Lives under the plugin-gated
// three-pl-api bundle (plugins.three_pl), sibling to jobTemplatesService.
//
// supply_plans resolve a project's material demand against on-hand stock:
// release reserves available stock (spine reserve movements) and surfaces the
// shortage; cancel releases the holds. Release and cancel are server RPCs, not
// table writes. Quantities are numeric on the wire. The apiClient attaches the
// Idempotency-Key for non-GET requests, so handlers never hand-roll it.

import { apiRequest } from '@/lib/apiClient';
import {
  SupplyPlanSchema,
  SupplyPlanLineSchema,
  type SupplyPlan,
  type SupplyPlanStatus,
  type SupplyPlanCreate,
  type SupplyPlanPatch,
  type SupplyPlanLine,
  type SupplyPlanResolution,
  type SupplyPlanLineCreate,
  type SupplyPlanLineUpdate,
} from '@/lib/types/threepl';

export type {
  SupplyPlan,
  SupplyPlanStatus,
  SupplyPlanCreate,
  SupplyPlanPatch,
  SupplyPlanLine,
  SupplyPlanResolution,
  SupplyPlanLineCreate,
  SupplyPlanLineUpdate,
};

const BASE = '/three-pl-api/supply-plans';

// ---------------------------------------------------------------------------
// supply_plans
// ---------------------------------------------------------------------------

export type ListSupplyPlansFilters = {
  status?: SupplyPlanStatus;
  project_id?: string;
};

function supplyPlansQs(f: ListSupplyPlansFilters): string {
  const p = new URLSearchParams();
  if (f.status) p.set('status', f.status);
  if (f.project_id) p.set('project_id', f.project_id);
  const s = p.toString();
  return s ? `?${s}` : '';
}

export async function listSupplyPlans(
  filters: ListSupplyPlansFilters = {},
): Promise<SupplyPlan[]> {
  const data = await apiRequest<unknown>(`${BASE}${supplyPlansQs(filters)}`, {
    method: 'GET',
  });
  return (data as SupplyPlan[]).map((r) => SupplyPlanSchema.parse(r));
}

export async function getSupplyPlan(id: string): Promise<SupplyPlan> {
  const data = await apiRequest<unknown>(`${BASE}/${id}`, { method: 'GET' });
  return SupplyPlanSchema.parse(data);
}

export async function createSupplyPlan(
  input: SupplyPlanCreate,
): Promise<SupplyPlan> {
  const data = await apiRequest<unknown>(BASE, { method: 'POST', body: input });
  return SupplyPlanSchema.parse(data);
}

export async function updateSupplyPlan(
  id: string,
  input: SupplyPlanPatch,
): Promise<SupplyPlan> {
  const data = await apiRequest<unknown>(`${BASE}/${id}`, {
    method: 'PATCH',
    body: input,
  });
  return SupplyPlanSchema.parse(data);
}

export async function softDeleteSupplyPlan(
  id: string,
): Promise<{ id: string; deleted: boolean }> {
  return apiRequest<{ id: string; deleted: boolean }>(`${BASE}/${id}`, {
    method: 'DELETE',
  });
}

// release: reserve available stock per line, record the shortage; draft -> released.
export async function releaseSupplyPlan(id: string): Promise<SupplyPlan> {
  const data = await apiRequest<unknown>(`${BASE}/${id}/release`, {
    method: 'POST',
  });
  return SupplyPlanSchema.parse(data);
}

// cancel: release the holds (reserve_release); -> cancelled.
export async function cancelSupplyPlan(id: string): Promise<SupplyPlan> {
  const data = await apiRequest<unknown>(`${BASE}/${id}/cancel`, {
    method: 'POST',
  });
  return SupplyPlanSchema.parse(data);
}

// fulfill (A6): release the remaining holds (reserve_release); released ->
// fulfilled. Used once a job run has consumed the reserved stock so the spine
// quantity_reserved is not left stale.
export async function fulfillSupplyPlan(id: string): Promise<SupplyPlan> {
  const data = await apiRequest<unknown>(`${BASE}/${id}/fulfill`, {
    method: 'POST',
  });
  return SupplyPlanSchema.parse(data);
}

// ---------------------------------------------------------------------------
// supply_plan_lines (per-item demand resolution)
// ---------------------------------------------------------------------------

export async function listSupplyPlanLines(
  planId: string,
): Promise<SupplyPlanLine[]> {
  const data = await apiRequest<unknown>(`${BASE}/${planId}/lines`, {
    method: 'GET',
  });
  return (data as SupplyPlanLine[]).map((r) => SupplyPlanLineSchema.parse(r));
}

export async function createSupplyPlanLine(
  planId: string,
  input: SupplyPlanLineCreate,
): Promise<SupplyPlanLine> {
  const data = await apiRequest<unknown>(`${BASE}/${planId}/lines`, {
    method: 'POST',
    body: input,
  });
  return SupplyPlanLineSchema.parse(data);
}

export async function updateSupplyPlanLine(
  planId: string,
  lineId: string,
  input: SupplyPlanLineUpdate,
): Promise<SupplyPlanLine> {
  const data = await apiRequest<unknown>(
    `${BASE}/${planId}/lines/${lineId}`,
    { method: 'PATCH', body: input },
  );
  return SupplyPlanLineSchema.parse(data);
}

export async function deleteSupplyPlanLine(
  planId: string,
  lineId: string,
): Promise<{ id: string; deleted: boolean }> {
  return apiRequest<{ id: string; deleted: boolean }>(
    `${BASE}/${planId}/lines/${lineId}`,
    { method: 'DELETE' },
  );
}
