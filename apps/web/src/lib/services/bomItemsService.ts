// BOM items service.

import { apiRequest } from '@/lib/apiClient';
import { BomItemSchema, type BomItem } from '@/lib/types/vendors_inventory_ops';

export type { BomItem };

export async function listBomItems(parentItemId?: string): Promise<BomItem[]> {
  const sp = new URLSearchParams();
  if (parentItemId) sp.set('parent_item_id', parentItemId);
  const qs = sp.toString();
  const data = await apiRequest<unknown>(
    `/inventory-api/bom-items${qs ? `?${qs}` : ''}`, { method: 'GET' },
  );
  return (data as BomItem[]).map((r) => BomItemSchema.parse(r));
}

export async function createBomItem(input: Partial<BomItem>): Promise<BomItem> {
  const data = await apiRequest<unknown>('/inventory-api/bom-items', { method: 'POST', body: input });
  return BomItemSchema.parse(data);
}

export async function updateBomItem(id: string, input: Partial<BomItem>): Promise<BomItem> {
  const data = await apiRequest<unknown>(`/inventory-api/bom-items/${id}`, { method: 'PATCH', body: input });
  return BomItemSchema.parse(data);
}

export async function deleteBomItem(id: string): Promise<void> {
  await apiRequest<unknown>(`/inventory-api/bom-items/${id}`, { method: 'DELETE' });
}
