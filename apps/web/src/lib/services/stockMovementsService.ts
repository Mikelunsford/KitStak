// Stock movements service. Read-only.

import { apiRequest } from '@/lib/apiClient';
import { StockMovementSchema, type StockMovement } from '@/lib/types/vendors_inventory_ops';

export type { StockMovement };

export async function listStockMovements(params: { warehouseId?: string; itemId?: string } = {}): Promise<StockMovement[]> {
  const sp = new URLSearchParams();
  if (params.warehouseId) sp.set('warehouse_id', params.warehouseId);
  if (params.itemId) sp.set('item_id', params.itemId);
  const qs = sp.toString();
  const data = await apiRequest<unknown>(
    `/inventory-api/stock-movements${qs ? `?${qs}` : ''}`, { method: 'GET' },
  );
  return (data as StockMovement[]).map((r) => StockMovementSchema.parse(r));
}
