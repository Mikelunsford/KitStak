// Query keys for the WMS add-on (add-on six, warehouse execution). Locations
// (Phase B1); bin stock (B2), putaway (B3), and lots (B4) add their keys here
// per phase. Mirrors the threepl.ts key shape (all / list(filters) / detail(id)).

import type { ListWmsLocationsFilters } from '@/lib/services/wmsLocationsService';

export const wmsLocationsKeys = {
  all: ['wms', 'warehouse_locations'] as const,
  list: (filters: ListWmsLocationsFilters = {}) =>
    [...wmsLocationsKeys.all, 'list', filters] as const,
  detail: (id: string) => [...wmsLocationsKeys.all, 'detail', id] as const,
};
