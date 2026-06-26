// PO line items service.

import { apiRequest } from '@/lib/apiClient';
import { PoLineItemSchema, type PoLineItem } from '@/lib/types/vendors_inventory_ops';

export type { PoLineItem };

export async function listPoLineItems(poId: string): Promise<PoLineItem[]> {
  const data = await apiRequest<unknown>(
    `/vendors-api/purchase-orders/${poId}/line-items`, { method: 'GET' },
  );
  return (data as PoLineItem[]).map((r) => PoLineItemSchema.parse(r));
}

export async function createPoLineItem(poId: string, input: Partial<PoLineItem>): Promise<PoLineItem> {
  const data = await apiRequest<unknown>(
    `/vendors-api/purchase-orders/${poId}/line-items`,
    { method: 'POST', body: input },
  );
  return PoLineItemSchema.parse(data);
}
