export const warehousesKeys = {
  all: ['inventory', 'warehouses'] as const,
  list: () => [...warehousesKeys.all, 'list'] as const,
  detail: (id: string) => [...warehousesKeys.all, 'detail', id] as const,
};

export const stockLevelsKeys = {
  all: ['inventory', 'stock_levels'] as const,
  list: (warehouseId?: string, itemId?: string) =>
    [...stockLevelsKeys.all, 'list', warehouseId ?? null, itemId ?? null] as const,
};

export const stockMovementsKeys = {
  all: ['inventory', 'stock_movements'] as const,
  list: (warehouseId?: string, itemId?: string) =>
    [...stockMovementsKeys.all, 'list', warehouseId ?? null, itemId ?? null] as const,
};

export const bomItemsKeys = {
  all: ['inventory', 'bom_items'] as const,
  list: (parentItemId?: string) => [...bomItemsKeys.all, 'list', parentItemId ?? null] as const,
};
