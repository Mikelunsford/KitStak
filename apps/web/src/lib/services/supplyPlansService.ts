// 3PL Supply Plan service (Wave 12 Phase A5). Lives under the plugin-gated
// three-pl-api bundle (plugins.three_pl), sibling to jobTemplatesService.
//
// supply_plans resolve a project's material demand against on-hand stock:
// release reserves available stock (spine reserve movements) and surfaces the
// shortage; cancel releases the holds. Release and cancel are server RPCs, not
// table writes. Quantities are numeric on the wire. The apiClient attaches the
// Idempotency-Key for non-GET requests, so handlers never hand-roll it.

import { z } from 'zod';

import { apiRequest } from '@/lib/apiClient';
import { serverListQs, type ServerListParams } from '@/lib/services/serverListQs';
import {
  SupplyPlanSchema,
  SupplyPlanLineSchema,
  type SupplyPlan,
  type SupplyPlanStatus,
  type SupplyPlanCreate,
  type SupplyPlanLine,
  type SupplyPlanResolution,
  type SupplyPlanLineCreate,
} from '@/lib/types/threepl';

export type {
  SupplyPlan,
  SupplyPlanStatus,
  SupplyPlanCreate,
  SupplyPlanLine,
  SupplyPlanResolution,
  SupplyPlanLineCreate,
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

// Workstream C (UI scan): the list route now returns a keyset page envelope
// { items, next_cursor } (Shape A / DATA-cursor) on every request, mirroring
// inventory warehouses / copack. The legacy flat-list reader extracts items.
const SupplyPlanListEnvelope = z.object({
  items: z.array(SupplyPlanSchema),
  next_cursor: z.string().nullable().optional(),
});

export async function listSupplyPlans(
  filters: ListSupplyPlansFilters = {},
): Promise<SupplyPlan[]> {
  const raw = await apiRequest<unknown>(`${BASE}${supplyPlansQs(filters)}`, {
    method: 'GET',
  });
  return SupplyPlanListEnvelope.parse(raw).items;
}

export async function listSupplyPlansPage(
  params: ServerListParams,
): Promise<{ items: SupplyPlan[]; next_cursor: string | null }> {
  const raw = await apiRequest<unknown>(`${BASE}${serverListQs(params)}`, {
    method: 'GET',
  });
  const parsed = SupplyPlanListEnvelope.parse(raw);
  return { items: parsed.items, next_cursor: parsed.next_cursor ?? null };
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

export async function deleteSupplyPlanLine(
  planId: string,
  lineId: string,
): Promise<{ id: string; deleted: boolean }> {
  return apiRequest<{ id: string; deleted: boolean }>(
    `${BASE}/${planId}/lines/${lineId}`,
    { method: 'DELETE' },
  );
}
