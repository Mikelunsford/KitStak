// Shipments service. Lives under bundle-gated ops-api.

import { apiRequest, apiRequestWithMeta } from '@/lib/apiClient';
import { serverListQs, metaCursor, type ServerListParams } from '@/lib/services/serverListQs';
import {
  ShipmentSchema, type Shipment, type ShipmentStatus,
} from '@/lib/types/vendors_inventory_ops';

export type { Shipment, ShipmentStatus };

const ShipmentListSchema = ShipmentSchema.array();

export type ListShipmentsFilters = {
  customer_id?: string;
  // F-Wave9-AUDIT-V3-WAVE-C4-01: project_id filter so ProjectDetailPage
  // can ask the server for only shipments bound to a given project
  // instead of fetching the whole list and filtering client-side. Mirrors
  // the receiving_orders project_id filter shape. Backed by
  // shipments_project_id_idx (migration 0063 re-declaration of 0046).
  project_id?: string;
};

function shipmentsQs(f: ListShipmentsFilters): string {
  const p = new URLSearchParams();
  if (f.customer_id) p.set('customer_id', f.customer_id);
  if (f.project_id) p.set('project_id', f.project_id);
  const s = p.toString();
  return s ? `?${s}` : '';
}

export async function listShipments(
  filters: ListShipmentsFilters = {},
): Promise<Shipment[]> {
  const data = await apiRequest<unknown>(
    `/ops-api/shipments${shipmentsQs(filters)}`,
    { method: 'GET' },
  );
  return (data as Shipment[]).map((r) => ShipmentSchema.parse(r));
}

// Workstream C: server-driven list toolbar page (search, sort, keyset). The
// shipment list returns its rows in `data` and next_cursor in `meta`, so this
// reads the full envelope via apiRequestWithMeta.
export async function listShipmentsPage(
  params: ServerListParams,
): Promise<{ items: Shipment[]; next_cursor: string | null }> {
  const env = await apiRequestWithMeta<unknown>(
    `/ops-api/shipments${serverListQs(params)}`,
    { method: 'GET' },
  );
  return { items: ShipmentListSchema.parse(env.data), next_cursor: metaCursor(env.meta) };
}

export async function getShipment(id: string): Promise<Shipment> {
  const data = await apiRequest<unknown>(`/ops-api/shipments/${id}`, { method: 'GET' });
  return ShipmentSchema.parse(data);
}

export async function createShipment(input: Partial<Shipment>): Promise<Shipment> {
  const data = await apiRequest<unknown>('/ops-api/shipments', { method: 'POST', body: input });
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
