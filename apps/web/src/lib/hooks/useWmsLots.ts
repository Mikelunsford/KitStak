// TanStack Query hooks for WMS Lots (Wave 12 Body B Phase B4). Mirrors
// useWmsLocations: shared cache config, list/detail reads, and mutations that
// invalidate the entity key plus the lot's audit timeline so the detail HISTORY
// rail reflects the latest state. The quarantine transition goes through the
// server RPC.

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { auditLogKeys } from '@/lib/queryKeys/auditLog';
import { wmsLotsKeys } from '@/lib/queryKeys/wms';
import {
  listWmsLots,
  getWmsLot,
  createWmsLot,
  updateWmsLot,
  softDeleteWmsLot,
  quarantineWmsLot,
  type Lot,
  type LotCreate,
  type LotPatch,
  type ListWmsLotsFilters,
} from '@/lib/services/wmsLotsService';

const C = { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 as const };

// lot entity_type for the audit timeline (migration 0110 audit_append_state_change
// trigger writes rows under this type).
const LOT_ENTITY = 'lot';

export function useWmsLotsList(
  filters: ListWmsLotsFilters = {},
  // Optional gate so callers outside the WMS-gated routes (e.g. the receiving
  // line editor's lot picker) can skip the gated wms-api call entirely when
  // plugins.wms is off. Defaults to enabled for the WMS pages already behind
  // RequirePlugin.
  enabled = true,
) {
  return useQuery({
    queryKey: wmsLotsKeys.list(filters),
    queryFn: () => listWmsLots(filters),
    enabled,
    ...C,
  });
}

export function useWmsLot(id: string | undefined) {
  return useQuery({
    queryKey: id ? wmsLotsKeys.detail(id) : ['wms', 'lots', 'detail', 'noop'],
    queryFn: () => getWmsLot(id as string),
    enabled: !!id,
    ...C,
  });
}

export function useCreateWmsLot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: LotCreate) => createWmsLot(input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: wmsLotsKeys.all });
    },
  });
}

export function useUpdateWmsLot(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: LotPatch) => updateWmsLot(id, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: wmsLotsKeys.all });
      void qc.invalidateQueries({ queryKey: auditLogKeys.byEntity(LOT_ENTITY, id) });
    },
  });
}

export function useSoftDeleteWmsLot(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => softDeleteWmsLot(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: wmsLotsKeys.all });
      void qc.invalidateQueries({ queryKey: auditLogKeys.byEntity(LOT_ENTITY, id) });
    },
  });
}

export function useQuarantineWmsLot(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => quarantineWmsLot(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: wmsLotsKeys.all });
      void qc.invalidateQueries({ queryKey: auditLogKeys.byEntity(LOT_ENTITY, id) });
    },
  });
}

export type { Lot };
