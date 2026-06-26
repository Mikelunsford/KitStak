// TanStack Query hooks for WMS Locations (Wave 12 Body B Phase B1). Mirrors
// useAccounts: shared cache config, list/detail reads, and mutations that
// invalidate the entity key plus the location's audit timeline so the detail
// HISTORY rail reflects the latest state.

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { auditLogKeys } from '@/lib/queryKeys/auditLog';
import { wmsLocationsKeys } from '@/lib/queryKeys/wms';
import {
  listWmsLocations,
  getWmsLocation,
  createWmsLocation,
  deactivateWmsLocation,
  type WarehouseLocation,
  type WarehouseLocationCreate,
  type ListWmsLocationsFilters,
} from '@/lib/services/wmsLocationsService';

const C = { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 as const };

// warehouse_locations entity_type for the audit timeline (migration 0106
// audit_append_state_change trigger writes rows under this type).
const LOCATION_ENTITY = 'warehouse_location';

export function useWmsLocationsList(
  filters: ListWmsLocationsFilters = {},
  // Optional gate so callers outside the WMS-gated routes (e.g. the receiving
  // detail page's dock picker) can skip the gated wms-api call entirely when
  // plugins.wms is off. Defaults to enabled for the WMS pages already behind
  // RequirePlugin.
  enabled = true,
) {
  return useQuery({
    queryKey: wmsLocationsKeys.list(filters),
    queryFn: () => listWmsLocations(filters),
    enabled,
    ...C,
  });
}

export function useWmsLocation(id: string | undefined) {
  return useQuery({
    queryKey: id
      ? wmsLocationsKeys.detail(id)
      : ['wms', 'warehouse_locations', 'detail', 'noop'],
    queryFn: () => getWmsLocation(id as string),
    enabled: !!id,
    ...C,
  });
}

export function useCreateWmsLocation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: WarehouseLocationCreate) => createWmsLocation(input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: wmsLocationsKeys.all });
    },
  });
}

export function useDeactivateWmsLocation(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => deactivateWmsLocation(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: wmsLocationsKeys.all });
      void qc.invalidateQueries({ queryKey: auditLogKeys.byEntity(LOCATION_ENTITY, id) });
    },
  });
}

export type { WarehouseLocation };
