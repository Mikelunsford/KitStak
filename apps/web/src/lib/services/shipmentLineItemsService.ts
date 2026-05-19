// Shipment line items service. Lives under bundle-gated ops-api.
// Backs F-Wave7-LINES-01 normalisation (migration 0049).

import { apiRequest } from '@/lib/apiClient';
import {
  ShipmentLineItemSchema,
  type ShipmentLineItem,
  type ShipmentLineItemCreate,
  type ShipmentLineItemUpdate,
} from '@/lib/types/vendors_inventory_ops';

export type {
  ShipmentLineItem,
  ShipmentLineItemCreate,
  ShipmentLineItemUpdate,
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

export async function updateShipmentLineItem(
  shipmentId: string,
  lineId: string,
  input: ShipmentLineItemUpdate,
): Promise<ShipmentLineItem> {
  const data = await apiRequest<unknown>(
    `/ops-api/shipments/${shipmentId}/line-items/${lineId}`,
    { method: 'PATCH', body: input },
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
