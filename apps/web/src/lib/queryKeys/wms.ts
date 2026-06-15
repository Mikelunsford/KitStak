// Query keys for the WMS add-on (add-on six, warehouse execution). Locations
// (Phase B1), bin stock (B2), and putaway (B3); lots (B4) add their keys here
// per phase. Mirrors the threepl.ts key shape (all / list(filters) / detail(id)).

import type { ListWmsLocationsFilters } from '@/lib/services/wmsLocationsService';
import type { ListWmsBinStockFilters } from '@/lib/services/wmsBinStockService';
import type { ListWmsPutawayFilters } from '@/lib/services/wmsPutawayService';

export const wmsLocationsKeys = {
  all: ['wms', 'warehouse_locations'] as const,
  list: (filters: ListWmsLocationsFilters = {}) =>
    [...wmsLocationsKeys.all, 'list', filters] as const,
  detail: (id: string) => [...wmsLocationsKeys.all, 'detail', id] as const,
};

export const wmsBinStockKeys = {
  all: ['wms', 'bin_stock_levels'] as const,
  list: (filters: ListWmsBinStockFilters = {}) =>
    [...wmsBinStockKeys.all, 'list', filters] as const,
  detail: (id: string) => [...wmsBinStockKeys.all, 'detail', id] as const,
};

export const wmsPutawayKeys = {
  all: ['wms', 'putaway_tasks'] as const,
  list: (filters: ListWmsPutawayFilters = {}) =>
    [...wmsPutawayKeys.all, 'list', filters] as const,
  detail: (id: string) => [...wmsPutawayKeys.all, 'detail', id] as const,
};
