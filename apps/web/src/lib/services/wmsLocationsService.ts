// WMS Locations service (Wave 12 Body B Phase B1). Lives under the plugin-gated
// wms-api bundle (plugins.wms, defaults off). warehouse_locations are the bins,
// shelves, racks, docks, and staging areas inside a warehouse. The apiClient
// attaches the Idempotency-Key for non-GET requests, so handlers never hand-roll
// it.

import { apiRequest, apiRequestWithMeta } from '@/lib/apiClient';
import { serverListQs, metaCursor, type ServerListParams } from '@/lib/services/serverListQs';
import {
  WarehouseLocationSchema,
  type WarehouseLocation,
  type WarehouseLocationType,
  type WarehouseLocationCreate,
  type WarehouseLocationPatch,
} from '@/lib/types/wms';

export type {
  WarehouseLocation,
  WarehouseLocationType,
  WarehouseLocationCreate,
  WarehouseLocationPatch,
};

const BASE = '/wms-api/locations';

export type ListWmsLocationsFilters = {
  warehouse_id?: string;
  location_type?: WarehouseLocationType;
  parent_location_id?: string;
  active?: boolean;
};

function locationsQs(f: ListWmsLocationsFilters): string {
  const p = new URLSearchParams();
  if (f.warehouse_id) p.set('warehouse_id', f.warehouse_id);
  if (f.location_type) p.set('location_type', f.location_type);
  if (f.parent_location_id) p.set('parent_location_id', f.parent_location_id);
  if (f.active !== undefined) p.set('active', f.active ? 'true' : 'false');
  const s = p.toString();
  return s ? `?${s}` : '';
}

export async function listWmsLocations(
  filters: ListWmsLocationsFilters = {},
): Promise<WarehouseLocation[]> {
  const data = await apiRequest<unknown>(`${BASE}${locationsQs(filters)}`, {
    method: 'GET',
  });
  return (data as WarehouseLocation[]).map((r) => WarehouseLocationSchema.parse(r));
}

// UI scan Workstream C: server-driven list toolbar page (search, sort, keyset).
// The locations list returns its rows in `data` and next_cursor in `meta`, so
// this reads the full envelope via apiRequestWithMeta (META-cursor shape).
export async function listWmsLocationsPage(
  params: ServerListParams,
): Promise<{ items: WarehouseLocation[]; next_cursor: string | null }> {
  const env = await apiRequestWithMeta<unknown>(`${BASE}${serverListQs(params)}`, {
    method: 'GET',
  });
  return {
    items: (env.data as WarehouseLocation[]).map((r) => WarehouseLocationSchema.parse(r)),
    next_cursor: metaCursor(env.meta),
  };
}

export async function getWmsLocation(id: string): Promise<WarehouseLocation> {
  const data = await apiRequest<unknown>(`${BASE}/${id}`, { method: 'GET' });
  return WarehouseLocationSchema.parse(data);
}

export async function createWmsLocation(
  input: WarehouseLocationCreate,
): Promise<WarehouseLocation> {
  const data = await apiRequest<unknown>(BASE, { method: 'POST', body: input });
  return WarehouseLocationSchema.parse(data);
}

export async function updateWmsLocation(
  id: string,
  input: WarehouseLocationPatch,
): Promise<WarehouseLocation> {
  const data = await apiRequest<unknown>(`${BASE}/${id}`, {
    method: 'PATCH',
    body: input,
  });
  return WarehouseLocationSchema.parse(data);
}

export async function deactivateWmsLocation(
  id: string,
): Promise<WarehouseLocation> {
  const data = await apiRequest<unknown>(`${BASE}/${id}/deactivate`, {
    method: 'POST',
  });
  return WarehouseLocationSchema.parse(data);
}

export async function softDeleteWmsLocation(
  id: string,
): Promise<{ id: string; deleted: boolean }> {
  return apiRequest<{ id: string; deleted: boolean }>(`${BASE}/${id}`, {
    method: 'DELETE',
  });
}
