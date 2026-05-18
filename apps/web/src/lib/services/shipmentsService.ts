// Shipments service. Lives under bundle-gated ops-api.

import { apiRequest } from '@/lib/apiClient';
import {
  ShipmentSchema, type Shipment, type ShipmentStatus,
} from '@/lib/types/vendors_inventory_ops';

export type { Shipment, ShipmentStatus };

export async function listShipments(): Promise<Shipment[]> {
  const data = await apiRequest<unknown>('/ops-api/shipments', { method: 'GET' });
  return (data as Shipment[]).map((r) => ShipmentSchema.parse(r));
}

export async function getShipment(id: string): Promise<Shipment> {
  const data = await apiRequest<unknown>(`/ops-api/shipments/${id}`, { method: 'GET' });
  return ShipmentSchema.parse(data);
}

export async function createShipment(input: Partial<Shipment>): Promise<Shipment> {
  const data = await apiRequest<unknown>('/ops-api/shipments', { method: 'POST', body: input });
  return ShipmentSchema.parse(data);
}

export async function updateShipment(id: string, input: Partial<Shipment>): Promise<Shipment> {
  const data = await apiRequest<unknown>(`/ops-api/shipments/${id}`, { method: 'PATCH', body: input });
  return ShipmentSchema.parse(data);
}

export async function transitionShipment(id: string, to: ShipmentStatus): Promise<Shipment> {
  const data = await apiRequest<unknown>(
    `/ops-api/shipments/${id}/transition`,
    { method: 'POST', body: { to } },
  );
  return ShipmentSchema.parse(data);
}

export interface ShipShipmentInput {
  ship_date?: string;
  carrier?: string;
  tracking_number?: string;
  lines: Array<{ item_id: string; quantity: number | string; unit_cost_cents?: number }>;
}

export async function shipShipment(id: string, input: ShipShipmentInput): Promise<Shipment> {
  const data = await apiRequest<unknown>(
    `/ops-api/shipments/${id}/ship`, { method: 'POST', body: input },
  );
  return ShipmentSchema.parse(data);
}
