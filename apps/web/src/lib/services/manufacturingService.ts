// Manufacturing service. Lives under bundle-gated manufacturing-api.
// Path A5 of the Manufacturing wiring plan. Pillar 2.
//
// The edge function bundle gates on plugins.manufacturing and returns 404
// for orgs that lack the flag (constitution rule: bundle gate off -> 404).
// The Idempotency-Key header is auto-injected by apiClient for non-GET.

import { apiRequest } from '@/lib/apiClient';
import {
  ManufacturingRunSchema,
  ManufacturingRunConsumedLineItemSchema,
  ManufacturingRunProducedLineItemSchema,
  type ManufacturingRun,
  type ManufacturingRunStatus,
  type ManufacturingRunCreate,
  type ManufacturingRunPatch,
  type ManufacturingRunConsumedLineItem,
  type ManufacturingRunConsumedLineItemCreate,
  type ManufacturingRunConsumedLineItemUpdate,
  type ManufacturingRunProducedLineItem,
  type ManufacturingRunProducedLineItemCreate,
  type ManufacturingRunProducedLineItemUpdate,
} from '@/lib/types/vendors_inventory_ops';

export type {
  ManufacturingRun,
  ManufacturingRunStatus,
  ManufacturingRunCreate,
  ManufacturingRunPatch,
  ManufacturingRunConsumedLineItem,
  ManufacturingRunConsumedLineItemCreate,
  ManufacturingRunConsumedLineItemUpdate,
  ManufacturingRunProducedLineItem,
  ManufacturingRunProducedLineItemCreate,
  ManufacturingRunProducedLineItemUpdate,
};

export type ListManufacturingRunsFilters = {
  status?: ManufacturingRunStatus | 'all';
  warehouse_id?: string;
  // F-Wave9-AUDIT-V3-WAVE-C4-01: project_id filter so ProjectDetailPage
  // can ask the server for only manufacturing runs bound to a given
  // project. Mirrors the receiving_orders / shipments project_id filter
  // shape. Backed by manufacturing_runs_project_id_idx (migration 0063).
  project_id?: string;
};

function runsQs(f: ListManufacturingRunsFilters): string {
  const p = new URLSearchParams();
  if (f.status && f.status !== 'all') p.set('status', f.status);
  if (f.warehouse_id) p.set('warehouse_id', f.warehouse_id);
  if (f.project_id) p.set('project_id', f.project_id);
  const s = p.toString();
  return s ? `?${s}` : '';
}

// --- parent runs ---

export async function listManufacturingRuns(
  filters: ListManufacturingRunsFilters = {},
): Promise<ManufacturingRun[]> {
  const data = await apiRequest<unknown>(
    `/manufacturing-api/manufacturing-runs${runsQs(filters)}`,
    { method: 'GET' },
  );
  return (data as ManufacturingRun[]).map((r) => ManufacturingRunSchema.parse(r));
}

export async function getManufacturingRun(id: string): Promise<ManufacturingRun> {
  const data = await apiRequest<unknown>(
    `/manufacturing-api/manufacturing-runs/${id}`,
    { method: 'GET' },
  );
  return ManufacturingRunSchema.parse(data);
}

export async function createManufacturingRun(
  input: ManufacturingRunCreate,
): Promise<ManufacturingRun> {
  const data = await apiRequest<unknown>(
    '/manufacturing-api/manufacturing-runs',
    { method: 'POST', body: input },
  );
  return ManufacturingRunSchema.parse(data);
}

export async function updateManufacturingRun(
  id: string, input: ManufacturingRunPatch,
): Promise<ManufacturingRun> {
  const data = await apiRequest<unknown>(
    `/manufacturing-api/manufacturing-runs/${id}`,
    { method: 'PATCH', body: input },
  );
  return ManufacturingRunSchema.parse(data);
}

export async function deleteManufacturingRun(
  id: string,
): Promise<{ id: string; deleted: boolean }> {
  return apiRequest<{ id: string; deleted: boolean }>(
    `/manufacturing-api/manufacturing-runs/${id}`,
    { method: 'DELETE' },
  );
}

export async function startManufacturingRun(id: string): Promise<ManufacturingRun> {
  const data = await apiRequest<unknown>(
    `/manufacturing-api/manufacturing-runs/${id}/start`,
    { method: 'POST' },
  );
  return ManufacturingRunSchema.parse(data);
}

export async function completeManufacturingRun(id: string): Promise<ManufacturingRun> {
  const data = await apiRequest<unknown>(
    `/manufacturing-api/manufacturing-runs/${id}/complete`,
    { method: 'POST' },
  );
  return ManufacturingRunSchema.parse(data);
}

export async function cancelManufacturingRun(id: string): Promise<ManufacturingRun> {
  const data = await apiRequest<unknown>(
    `/manufacturing-api/manufacturing-runs/${id}/cancel`,
    { method: 'POST' },
  );
  return ManufacturingRunSchema.parse(data);
}

// --- consumed line items (item_id REQUIRED per migration 0052) ---

export async function listConsumedLineItems(
  runId: string,
): Promise<ManufacturingRunConsumedLineItem[]> {
  const data = await apiRequest<unknown>(
    `/manufacturing-api/manufacturing-runs/${runId}/consumed`,
    { method: 'GET' },
  );
  return (data as ManufacturingRunConsumedLineItem[]).map(
    (r) => ManufacturingRunConsumedLineItemSchema.parse(r),
  );
}

export async function createConsumedLineItem(
  runId: string, input: ManufacturingRunConsumedLineItemCreate,
): Promise<ManufacturingRunConsumedLineItem> {
  const data = await apiRequest<unknown>(
    `/manufacturing-api/manufacturing-runs/${runId}/consumed`,
    { method: 'POST', body: input },
  );
  return ManufacturingRunConsumedLineItemSchema.parse(data);
}

export async function updateConsumedLineItem(
  runId: string, lineId: string, input: ManufacturingRunConsumedLineItemUpdate,
): Promise<ManufacturingRunConsumedLineItem> {
  const data = await apiRequest<unknown>(
    `/manufacturing-api/manufacturing-runs/${runId}/consumed/${lineId}`,
    { method: 'PATCH', body: input },
  );
  return ManufacturingRunConsumedLineItemSchema.parse(data);
}

export async function deleteConsumedLineItem(
  runId: string, lineId: string,
): Promise<{ id: string; deleted: boolean }> {
  return apiRequest<{ id: string; deleted: boolean }>(
    `/manufacturing-api/manufacturing-runs/${runId}/consumed/${lineId}`,
    { method: 'DELETE' },
  );
}

// --- produced line items (item_id NULLABLE per migration 0052) ---

export async function listProducedLineItems(
  runId: string,
): Promise<ManufacturingRunProducedLineItem[]> {
  const data = await apiRequest<unknown>(
    `/manufacturing-api/manufacturing-runs/${runId}/produced`,
    { method: 'GET' },
  );
  return (data as ManufacturingRunProducedLineItem[]).map(
    (r) => ManufacturingRunProducedLineItemSchema.parse(r),
  );
}

export async function createProducedLineItem(
  runId: string, input: ManufacturingRunProducedLineItemCreate,
): Promise<ManufacturingRunProducedLineItem> {
  const data = await apiRequest<unknown>(
    `/manufacturing-api/manufacturing-runs/${runId}/produced`,
    { method: 'POST', body: input },
  );
  return ManufacturingRunProducedLineItemSchema.parse(data);
}

export async function updateProducedLineItem(
  runId: string, lineId: string, input: ManufacturingRunProducedLineItemUpdate,
): Promise<ManufacturingRunProducedLineItem> {
  const data = await apiRequest<unknown>(
    `/manufacturing-api/manufacturing-runs/${runId}/produced/${lineId}`,
    { method: 'PATCH', body: input },
  );
  return ManufacturingRunProducedLineItemSchema.parse(data);
}

export async function deleteProducedLineItem(
  runId: string, lineId: string,
): Promise<{ id: string; deleted: boolean }> {
  return apiRequest<{ id: string; deleted: boolean }>(
    `/manufacturing-api/manufacturing-runs/${runId}/produced/${lineId}`,
    { method: 'DELETE' },
  );
}
