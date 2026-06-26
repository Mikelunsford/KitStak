// Shipment line items service. Lives under bundle-gated ops-api.
// Backs F-Wave7-LINES-01 normalisation (migration 0050).

import { apiRequest } from '@/lib/apiClient';
import {
  ShipmentLineItemSchema,
  type ShipmentLineItem,
  type ShipmentLineItemCreate,
} from '@/lib/types/vendors_inventory_ops';

export type {
  ShipmentLineItem,
  ShipmentLineItemCreate,
};

export async function listShipmentLineItems(
  shipmentId: string,
): Promise<ShipmentLineItem[]> {
  const data = await apiRequest<unknown>(
    `/ops-api/shipments/${shipmentId}/line-items`,
    { method: 'GET' },
  );
  return (data as ShipmentLineItem[]).map(
    (r) => ShipmentLineItemSchema.parse(r),
  );
}

export async function createShipmentLineItem(
  shipmentId: string,
  input: ShipmentLineItemCreate,
): Promise<ShipmentLineItem> {
  const data = await apiRequest<unknown>(
    `/ops-api/shipments/${shipmentId}/line-items`,
    { method: 'POST', body: input },
  );
  return ShipmentLineItemSchema.parse(data);
}

export async function deleteShipmentLineItem(
  shipmentId: string,
  lineId: string,
): Promise<{ id: string; deleted: boolean }> {
  return apiRequest<{ id: string; deleted: boolean }>(
    `/ops-api/shipments/${shipmentId}/line-items/${lineId}`,
    { method: 'DELETE' },
  );
}
