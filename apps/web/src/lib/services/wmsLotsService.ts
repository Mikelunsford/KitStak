// WMS Lots service (Wave 12 Body B Phase B4). Lives under the plugin-gated
// wms-api bundle (plugins.wms, defaults off). A lot is a batch of an item with
// optional expiration; its status (active / quarantined / expired / consumed)
// moves the quarantine hold via the server RPC, not a table write. The apiClient
// attaches the Idempotency-Key for non-GET requests, so handlers never hand-roll
// it.

import { apiRequest, apiRequestWithMeta } from '@/lib/apiClient';
import { serverListQs, metaCursor, type ServerListParams } from '@/lib/services/serverListQs';
import {
  LotSchema,
  type Lot,
  type LotStatus,
  type LotCreate,
} from '@/lib/types/wms';

export type {
  Lot,
  LotStatus,
  LotCreate,
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

// UI scan Workstream C: server-driven list toolbar page (search, sort, keyset).
// The lots list returns its rows in `data` and next_cursor in `meta`, so this
// reads the full envelope via apiRequestWithMeta (META-cursor shape).
export async function listWmsLotsPage(
  params: ServerListParams,
): Promise<{ items: Lot[]; next_cursor: string | null }> {
  const env = await apiRequestWithMeta<unknown>(`${BASE}${serverListQs(params)}`, {
    method: 'GET',
  });
  return {
    items: (env.data as Lot[]).map((r) => LotSchema.parse(r)),
    next_cursor: metaCursor(env.meta),
  };
}

export async function getWmsLot(id: string): Promise<Lot> {
  const data = await apiRequest<unknown>(`${BASE}/${id}`, { method: 'GET' });
  return LotSchema.parse(data);
}

export async function createWmsLot(input: LotCreate): Promise<Lot> {
  const data = await apiRequest<unknown>(BASE, { method: 'POST', body: input });
  return LotSchema.parse(data);
}

// Quarantine is a server RPC (active -> quarantined); the response is the
// updated lot.
export async function quarantineWmsLot(id: string): Promise<Lot> {
  const data = await apiRequest<unknown>(`${BASE}/${id}/quarantine`, {
    method: 'POST',
  });
  return LotSchema.parse(data);
}
