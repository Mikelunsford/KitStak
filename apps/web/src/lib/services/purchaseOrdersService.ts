// Purchase orders service.

import { apiRequest } from '@/lib/apiClient';
import {
  PurchaseOrderSchema, type PurchaseOrder, type PurchaseOrderStatus,
} from '@/lib/types/vendors_inventory_ops';

export type { PurchaseOrder, PurchaseOrderStatus };

export type ListPurchaseOrdersFilters = {
  vendor_id?: string;
};

function purchaseOrdersQs(f: ListPurchaseOrdersFilters): string {
  const p = new URLSearchParams();
  if (f.vendor_id) p.set('vendor_id', f.vendor_id);
  const s = p.toString();
  return s ? `?${s}` : '';
}

export async function listPurchaseOrders(
  filters: ListPurchaseOrdersFilters = {},
): Promise<PurchaseOrder[]> {
  const data = await apiRequest<unknown>(
    `/vendors-api/purchase-orders${purchaseOrdersQs(filters)}`,
    { method: 'GET' },
  );
  return (data as PurchaseOrder[]).map((r) => PurchaseOrderSchema.parse(r));
}

export async function getPurchaseOrder(id: string): Promise<PurchaseOrder> {
  const data = await apiRequest<unknown>(`/vendors-api/purchase-orders/${id}`, { method: 'GET' });
  return PurchaseOrderSchema.parse(data);
}

export async function createPurchaseOrder(input: Partial<PurchaseOrder>): Promise<PurchaseOrder> {
  const data = await apiRequest<unknown>('/vendors-api/purchase-orders', { method: 'POST', body: input });
  return PurchaseOrderSchema.parse(data);
}

export async function updatePurchaseOrder(id: string, input: Partial<PurchaseOrder>): Promise<PurchaseOrder> {
  const data = await apiRequest<unknown>(`/vendors-api/purchase-orders/${id}`, { method: 'PATCH', body: input });
  return PurchaseOrderSchema.parse(data);
}

export async function transitionPurchaseOrder(id: string, to: PurchaseOrderStatus): Promise<PurchaseOrder> {
  const data = await apiRequest<unknown>(
    `/vendors-api/purchase-orders/${id}/transition`,
    { method: 'POST', body: { to } },
  );
  return PurchaseOrderSchema.parse(data);
}
