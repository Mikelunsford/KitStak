// Receiving order line items service. Lives under bundle-gated ops-api.
// Backs F-Wave7-LINES-01 normalisation (migration 0050).

import { apiRequest } from '@/lib/apiClient';
import {
  ReceivingOrderLineItemSchema,
  type ReceivingOrderLineItem,
  type ReceivingOrderLineItemCreate,
} from '@/lib/types/vendors_inventory_ops';

export type {
  ReceivingOrderLineItem,
  ReceivingOrderLineItemCreate,
};

export async function listReceivingOrderLineItems(
  receivingOrderId: string,
): Promise<ReceivingOrderLineItem[]> {
  const data = await apiRequest<unknown>(
    `/ops-api/receiving-orders/${receivingOrderId}/line-items`,
    { method: 'GET' },
  );
  return (data as ReceivingOrderLineItem[]).map(
    (r) => ReceivingOrderLineItemSchema.parse(r),
  );
}

export async function createReceivingOrderLineItem(
  receivingOrderId: string,
  input: ReceivingOrderLineItemCreate,
): Promise<ReceivingOrderLineItem> {
  const data = await apiRequest<unknown>(
    `/ops-api/receiving-orders/${receivingOrderId}/line-items`,
    { method: 'POST', body: input },
  );
  return ReceivingOrderLineItemSchema.parse(data);
}

export async function deleteReceivingOrderLineItem(
  receivingOrderId: string,
  lineId: string,
): Promise<{ id: string; deleted: boolean }> {
  return apiRequest<{ id: string; deleted: boolean }>(
    `/ops-api/receiving-orders/${receivingOrderId}/line-items/${lineId}`,
    { method: 'DELETE' },
  );
}
