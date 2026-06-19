// WMS Putaway service (Wave 12 Body B Phase B3). Lives under the plugin-gated
// wms-api bundle (plugins.wms, defaults off). A putaway_task is a directed move
// of received stock from a dock to a final bin. Its FSM
// (suggested -> in_progress -> done; non-done -> cancelled) moves via the server
// RPCs (start / complete / cancel), not table writes. Completing a task emits a
// warehouse-flat internal move (transfer_out at the dock + transfer_in at the
// bin). The apiClient attaches the Idempotency-Key for non-GET requests, so
// handlers never hand-roll it.

import { apiRequest, apiRequestWithMeta } from '@/lib/apiClient';
import { serverListQs, metaCursor, type ServerListParams } from '@/lib/services/serverListQs';
import {
  PutawayTaskSchema,
  type PutawayTask,
  type PutawayTaskStatus,
  type PutawayTaskCreate,
  type PutawayTaskPatch,
} from '@/lib/types/wms';

export type {
  PutawayTask,
  PutawayTaskStatus,
  PutawayTaskCreate,
  PutawayTaskPatch,
};

const BASE = '/wms-api/putaway';

export type ListWmsPutawayFilters = {
  status?: PutawayTaskStatus;
  warehouse_id?: string;
};

function putawayQs(f: ListWmsPutawayFilters): string {
  const p = new URLSearchParams();
  if (f.status) p.set('status', f.status);
  if (f.warehouse_id) p.set('warehouse_id', f.warehouse_id);
  const s = p.toString();
  return s ? `?${s}` : '';
}

export async function listWmsPutaway(
  filters: ListWmsPutawayFilters = {},
): Promise<PutawayTask[]> {
  const data = await apiRequest<unknown>(`${BASE}${putawayQs(filters)}`, {
    method: 'GET',
  });
  return (data as PutawayTask[]).map((r) => PutawayTaskSchema.parse(r));
}

// UI scan Workstream C: server-driven list toolbar page (sort, keyset; no text
// search column on the task). The putaway list returns its rows in `data` and
// next_cursor in `meta`, so this reads the full envelope via apiRequestWithMeta
// (META-cursor shape).
export async function listWmsPutawayPage(
  params: ServerListParams,
): Promise<{ items: PutawayTask[]; next_cursor: string | null }> {
  const env = await apiRequestWithMeta<unknown>(`${BASE}${serverListQs(params)}`, {
    method: 'GET',
  });
  return {
    items: (env.data as PutawayTask[]).map((r) => PutawayTaskSchema.parse(r)),
    next_cursor: metaCursor(env.meta),
  };
}

export async function getWmsPutaway(id: string): Promise<PutawayTask> {
  const data = await apiRequest<unknown>(`${BASE}/${id}`, { method: 'GET' });
  return PutawayTaskSchema.parse(data);
}

export async function createWmsPutaway(
  input: PutawayTaskCreate,
): Promise<PutawayTask> {
  const data = await apiRequest<unknown>(BASE, { method: 'POST', body: input });
  return PutawayTaskSchema.parse(data);
}

export async function updateWmsPutaway(
  id: string,
  input: PutawayTaskPatch,
): Promise<PutawayTask> {
  const data = await apiRequest<unknown>(`${BASE}/${id}`, {
    method: 'PATCH',
    body: input,
  });
  return PutawayTaskSchema.parse(data);
}

export async function softDeleteWmsPutaway(
  id: string,
): Promise<{ id: string; deleted: boolean }> {
  return apiRequest<{ id: string; deleted: boolean }>(`${BASE}/${id}`, {
    method: 'DELETE',
  });
}

// Set the destination bin on a still-open task (Wave 13 / R-W13-WMS-01). A
// complete now requires a destination, so this is the natural pairing: pick the
// bin, then complete. The server validates the bin lives in the task warehouse.
export async function setWmsPutawayDestination(
  id: string,
  actualLocationId: string,
): Promise<PutawayTask> {
  const data = await apiRequest<unknown>(`${BASE}/${id}/destination`, {
    method: 'POST',
    body: { actual_location_id: actualLocationId },
  });
  return PutawayTaskSchema.parse(data);
}

// FSM transitions. Each is a server RPC; the response is the updated task.
export async function startWmsPutaway(id: string): Promise<PutawayTask> {
  const data = await apiRequest<unknown>(`${BASE}/${id}/start`, { method: 'POST' });
  return PutawayTaskSchema.parse(data);
}

export async function completeWmsPutaway(id: string): Promise<PutawayTask> {
  const data = await apiRequest<unknown>(`${BASE}/${id}/complete`, { method: 'POST' });
  return PutawayTaskSchema.parse(data);
}

export async function cancelWmsPutaway(id: string): Promise<PutawayTask> {
  const data = await apiRequest<unknown>(`${BASE}/${id}/cancel`, { method: 'POST' });
  return PutawayTaskSchema.parse(data);
}
