// Stock levels service.

import { apiRequest } from '@/lib/apiClient';
import { StockLevelSchema, type StockLevel } from '@/lib/types/vendors_inventory_ops';

export type { StockLevel };

export async function listStockLevels(params: { warehouseId?: string; itemId?: string } = {}): Promise<StockLevel[]> {
  const sp = new URLSearchParams();
  if (params.warehouseId) sp.set('warehouse_id', params.warehouseId);
  if (params.itemId) sp.set('item_id', params.itemId);
  const qs = sp.toString();
  const data = await apiRequest<unknown>(
    `/inventory-api/stock-levels${qs ? `?${qs}` : ''}`, { method: 'GET' },
  );
  return (data as StockLevel[]).map((r) => StockLevelSchema.parse(r));
}
