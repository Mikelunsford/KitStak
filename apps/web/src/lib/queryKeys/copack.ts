// Co-Pack and Ecom query keys factory. Pillar 3.
// Three keyed roots: sales channels, sales orders, kitting jobs, fulfillments.
//
// auditLogKeys.byEntity('sales_order' | 'kitting_job' | 'fulfillment', id) is
// owned by the audit_log factory and is invalidated alongside these on
// mutation success.

import type {
  ListSalesOrdersFilters,
  ListKittingJobsFilters,
  ListFulfillmentsFilters,
} from '@/lib/services/copackService';

export const salesChannelsKeys = {
  all: ['copack', 'sales-channels'] as const,
  list: () => [...salesChannelsKeys.all, 'list'] as const,
};

// Co-Pack-scoped warehouse read (F-Wave10-CKSMOKE-04). Distinct from the
// inventory-api warehouse keys so the two caches never collide.
export const coPackWarehousesKeys = {
  all: ['copack', 'warehouses'] as const,
  list: () => [...coPackWarehousesKeys.all, 'list'] as const,
};

export const salesOrdersKeys = {
  all: ['copack', 'sales-orders'] as const,
  list: (filters: ListSalesOrdersFilters = {}) =>
    [...salesOrdersKeys.all, 'list', filters] as const,
  detail: (id: string) =>
    [...salesOrdersKeys.all, 'detail', id] as const,
  lines: (id: string) =>
    [...salesOrdersKeys.all, 'detail', id, 'lines'] as const,
};

export const kittingJobsKeys = {
  all: ['copack', 'kitting-jobs'] as const,
  list: (filters: ListKittingJobsFilters = {}) =>
    [...kittingJobsKeys.all, 'list', filters] as const,
  detail: (id: string) =>
    [...kittingJobsKeys.all, 'detail', id] as const,
  consumed: (id: string) =>
    [...kittingJobsKeys.all, 'detail', id, 'consumed'] as const,
  produced: (id: string) =>
    [...kittingJobsKeys.all, 'detail', id, 'produced'] as const,
};

export const fulfillmentsKeys = {
  all: ['copack', 'fulfillments'] as const,
  list: (filters: ListFulfillmentsFilters = {}) =>
    [...fulfillmentsKeys.all, 'list', filters] as const,
  detail: (id: string) =>
    [...fulfillmentsKeys.all, 'detail', id] as const,
};
