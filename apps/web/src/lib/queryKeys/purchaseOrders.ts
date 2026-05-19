import type { ListPurchaseOrdersFilters } from '@/lib/services/purchaseOrdersService';

export const purchaseOrdersKeys = {
  all: ['vendors', 'purchase_orders'] as const,
  list: (filters: ListPurchaseOrdersFilters = {}) =>
    [...purchaseOrdersKeys.all, 'list', filters] as const,
  detail: (id: string) => [...purchaseOrdersKeys.all, 'detail', id] as const,
  lines: (id: string) => [...purchaseOrdersKeys.all, 'lines', id] as const,
};
