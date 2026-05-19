import type { ListReceivingOrdersFilters } from '@/lib/services/receivingOrdersService';

export const receivingOrdersKeys = {
  all: ['ops', 'receiving_orders'] as const,
  list: (filters: ListReceivingOrdersFilters = {}) =>
    [...receivingOrdersKeys.all, 'list', filters] as const,
  detail: (id: string) => [...receivingOrdersKeys.all, 'detail', id] as const,
};

export const productionRunsKeys = {
  all: ['ops', 'production_runs'] as const,
  list: () => [...productionRunsKeys.all, 'list'] as const,
  detail: (id: string) => [...productionRunsKeys.all, 'detail', id] as const,
};

import type { ListShipmentsFilters } from '@/lib/services/shipmentsService';

export const shipmentsKeys = {
  all: ['ops', 'shipments'] as const,
  list: (filters: ListShipmentsFilters = {}) =>
    [...shipmentsKeys.all, 'list', filters] as const,
  detail: (id: string) => [...shipmentsKeys.all, 'detail', id] as const,
};
