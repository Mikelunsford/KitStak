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

export async function transitionReceivingOrder(id: string, to: ReceivingOrderStatus): Promise<ReceivingOrder> {
  const data = await apiRequest<unknown>(
    `/ops-api/receiving-orders/${id}/transition`,
    { method: 'POST', body: { to } },
  );
  return ReceivingOrderSchema.parse(data);
}

export async function receiveReceivingOrder(
  id: string,
  payload: { received_date?: string; lines: Array<{ item_id: string; quantity: number; unit_cost_cents?: number }> },
): Promise<ReceivingOrder> {
  const data = await apiRequest<unknown>(
    `/ops-api/receiving-orders/${id}/receive`,
    { method: 'POST', body: payload },
  );
  return ReceivingOrderSchema.parse(data);
}
