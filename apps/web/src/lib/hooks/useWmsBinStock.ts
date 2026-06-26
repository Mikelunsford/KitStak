// TanStack Query hooks for WMS bin stock (Wave 12 Body B Phase B2). Read-only:
// bin_stock_levels is a trigger-maintained rollup with no client write path, so
// there are no mutations here. Shared cache config (C) matches the spine
// reference-data posture: staleTime 30s, no refetch on focus, retry once.

import { useQuery } from '@tanstack/react-query';

import { wmsBinStockKeys } from '@/lib/queryKeys/wms';
import {
  listWmsBinStock,
  type ListWmsBinStockFilters,
  type BinStockLevel,
} from '@/lib/services/wmsBinStockService';

const C = { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 as const };

export function useWmsBinStockList(filters: ListWmsBinStockFilters = {}) {
  return useQuery({
    queryKey: wmsBinStockKeys.list(filters),
    queryFn: () => listWmsBinStock(filters),
    ...C,
  });
}

export type { BinStockLevel };
