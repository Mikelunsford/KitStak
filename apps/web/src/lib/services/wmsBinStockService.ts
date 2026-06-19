// WMS bin stock service (Wave 12 Body B Phase B2). Lives under the plugin-gated
// wms-api bundle (plugins.wms, defaults off). bin_stock_levels is a read-only
// rollup derived from the append-only stock_movements ledger, grouped by
// (warehouse, location, item, lot). There is no write path: the rollup is
// maintained by the recompute_bin_stock_level trigger. The sum of on-hand over
// every location partition reconciles to the spine warehouse total.

import { apiRequest, apiRequestWithMeta } from '@/lib/apiClient';
import { serverListQs, metaCursor, type ServerListParams } from '@/lib/services/serverListQs';
import {
  BinStockLevelSchema,
  type BinStockLevel,
} from '@/lib/types/wms';

export type { BinStockLevel };

const BASE = '/wms-api/bin-stock';

export type ListWmsBinStockFilters = {
  warehouse_id?: string;
  item_id?: string;
  location_id?: string;
};

function binStockQs(f: ListWmsBinStockFilters): string {
  const p = new URLSearchParams();
  if (f.warehouse_id) p.set('warehouse_id', f.warehouse_id);
  if (f.item_id) p.set('item_id', f.item_id);
  if (f.location_id) p.set('location_id', f.location_id);
  const s = p.toString();
  return s ? `?${s}` : '';
}

export async function listWmsBinStock(
  filters: ListWmsBinStockFilters = {},
): Promise<BinStockLevel[]> {
  const data = await apiRequest<unknown>(`${BASE}${binStockQs(filters)}`, {
    method: 'GET',
  });
  return (data as BinStockLevel[]).map((r) => BinStockLevelSchema.parse(r));
}

// UI scan Workstream C: server-driven list toolbar page (sort, keyset; no text
// search column on the rollup). The bin-stock list returns its rows in `data`
// and next_cursor in `meta`, so this reads the full envelope via
// apiRequestWithMeta (META-cursor shape).
export async function listWmsBinStockPage(
  params: ServerListParams,
): Promise<{ items: BinStockLevel[]; next_cursor: string | null }> {
  const env = await apiRequestWithMeta<unknown>(`${BASE}${serverListQs(params)}`, {
    method: 'GET',
  });
  return {
    items: (env.data as BinStockLevel[]).map((r) => BinStockLevelSchema.parse(r)),
    next_cursor: metaCursor(env.meta),
  };
}

export async function getWmsBinStock(id: string): Promise<BinStockLevel> {
  const data = await apiRequest<unknown>(`${BASE}/${id}`, { method: 'GET' });
  return BinStockLevelSchema.parse(data);
}
