// WMS Lots service (Wave 12 Body B Phase B4). Lives under the plugin-gated
// wms-api bundle (plugins.wms, defaults off). A lot is a batch of an item with
// optional expiration; its status (active / quarantined / expired / consumed)
// moves the quarantine hold via the server RPC, not a table write. The apiClient
// attaches the Idempotency-Key for non-GET requests, so handlers never hand-roll
// it.

import { apiRequest } from '@/lib/apiClient';
import {
  LotSchema,
  type Lot,
  type LotStatus,
  type LotCreate,
  type LotPatch,
} from '@/lib/types/wms';

export type {
  Lot,
  LotStatus,
  LotCreate,
  LotPatch,
};

const BASE = '/wms-api/lots';

export type ListWmsLotsFilters = {
  item_id?: string;
  status?: LotStatus;
};

function lotsQs(f: ListWmsLotsFilters): string {
  const p = new URLSearchParams();
  if (f.item_id) p.set('item_id', f.item_id);
  if (f.status) p.set('status', f.status);
  const s = p.toString();
  return s ? `?${s}` : '';
}

export async function listWmsLots(
  filters: ListWmsLotsFilters = {},
): Promise<Lot[]> {
  const data = await apiRequest<unknown>(`${BASE}${lotsQs(filters)}`, {
    method: 'GET',
  });
  return (data as Lot[]).map((r) => LotSchema.parse(r));
}

export async function getWmsLot(id: string): Promise<Lot> {
  const data = await apiRequest<unknown>(`${BASE}/${id}`, { method: 'GET' });
  return LotSchema.parse(data);
}

export async function createWmsLot(input: LotCreate): Promise<Lot> {
  const data = await apiRequest<unknown>(BASE, { method: 'POST', body: input });
  return LotSchema.parse(data);
}

export async function updateWmsLot(id: string, input: LotPatch): Promise<Lot> {
  const data = await apiRequest<unknown>(`${BASE}/${id}`, {
    method: 'PATCH',
    body: input,
  });
  return LotSchema.parse(data);
}

export async function softDeleteWmsLot(
  id: string,
): Promise<{ id: string; deleted: boolean }> {
  return apiRequest<{ id: string; deleted: boolean }>(`${BASE}/${id}`, {
    method: 'DELETE',
  });
}

// Quarantine is a server RPC (active -> quarantined); the response is the
// updated lot.
export async function quarantineWmsLot(id: string): Promise<Lot> {
  const data = await apiRequest<unknown>(`${BASE}/${id}/quarantine`, {
    method: 'POST',
  });
  return LotSchema.parse(data);
}
