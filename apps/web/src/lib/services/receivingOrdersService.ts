// Receiving orders service. Lives under bundle-gated ops-api.

import { apiRequest } from '@/lib/apiClient';
import {
  ReceivingOrderSchema, type ReceivingOrder, type ReceivingOrderStatus,
} from '@/lib/types/vendors_inventory_ops';

export type { ReceivingOrder, ReceivingOrderStatus };

export type ListReceivingOrdersFilters = {
  vendor_id?: string;
  // UX-Q6: server-side filter so ProjectDetailPage can ask for receiving
  // orders bound to a given project without round-tripping the entire
  // list. Backed by receiving_orders_project_id_idx (migration 0061).
  project_id?: string;
};

function receivingOrdersQs(f: ListReceivingOrdersFilters): string {
  const p = new URLSearchParams();
  if (f.vendor_id) p.set('vendor_id', f.vendor_id);
  if (f.project_id) p.set('project_id', f.project_id);
  const s = p.toString();
  return s ? `?${s}` : '';
}

export async function listReceivingOrders(
  filters: ListReceivingOrdersFilters = {},
): Promise<ReceivingOrder[]> {
  const data = await apiRequest<unknown>(
    `/ops-api/receiving-orders${receivingOrdersQs(filters)}`,
    { method: 'GET' },
  );
  return (data as ReceivingOrder[]).map((r) => ReceivingOrderSchema.parse(r));
}

export async function getReceivingOrder(id: string): Promise<ReceivingOrder> {
  const data = await apiRequest<unknown>(`/ops-api/receiving-orders/${id}`, { method: 'GET' });
  return ReceivingOrderSchema.parse(data);
}

export async function createReceivingOrder(input: Partial<ReceivingOrder>): Promise<ReceivingOrder> {
  const data = await apiRequest<unknown>('/ops-api/receiving-orders', { method: 'POST', body: input });
  return ReceivingOrderSchema.parse(data);
}

export async function updateReceivingOrder(id: string, input: Partial<ReceivingOrder>): Promise<ReceivingOrder> {
  const data = await apiRequest<unknown>(`/ops-api/receiving-orders/${id}`, { method: 'PATCH', body: input });
  return ReceivingOrderSchema.parse(data);
}

// WMS Body B receiving-to-dock (F-Wave12-WMS-RECEIVE-DOCK-01): the dock is
// accepted ONLY on the transition to 'received'. The optional dock_location_id
// rides the SAME /transition POST that flips status -> received so the
// receipt-emitting trigger (0108) stamps it onto every movement. The server
// honours it only when plugins.wms is ON and to === 'received'; otherwise it
// forces NULL (server-authority no-op). Omitted on every non-received
// transition.
export type TransitionReceivingOrderBody = {
  to: ReceivingOrderStatus;
  dock_location_id?: string | null;
};

export async function transitionReceivingOrder(
  id: string,
  input: TransitionReceivingOrderBody,
): Promise<ReceivingOrder> {
  const body: TransitionReceivingOrderBody = { to: input.to };
  if (input.dock_location_id !== undefined) {
    body.dock_location_id = input.dock_location_id;
  }
  const data = await apiRequest<unknown>(
    `/ops-api/receiving-orders/${id}/transition`,
    { method: 'POST', body },
  );
  return ReceivingOrderSchema.parse(data);
}

export async function receiveReceivingOrder(
  id: string,
  payload: {
    received_date?: string;
    lines: Array<{ item_id: string; quantity: number; unit_cost_cents?: number }>;
  },
): Promise<ReceivingOrder> {
  const data = await apiRequest<unknown>(
    `/ops-api/receiving-orders/${id}/receive`,
    { method: 'POST', body: payload },
  );
  return ReceivingOrderSchema.parse(data);
}
