export const purchaseOrdersKeys = {
  all: ['vendors', 'purchase_orders'] as const,
  list: () => [...purchaseOrdersKeys.all, 'list'] as const,
  detail: (id: string) => [...purchaseOrdersKeys.all, 'detail', id] as const,
  lines: (id: string) => [...purchaseOrdersKeys.all, 'lines', id] as const,
};
