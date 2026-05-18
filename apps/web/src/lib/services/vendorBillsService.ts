// Vendor bills service.

import { apiRequest } from '@/lib/apiClient';
import { VendorBillSchema, type VendorBill, type VendorBillStatus } from '@/lib/types/vendors_inventory_ops';

export type { VendorBill, VendorBillStatus };

export async function listVendorBills(): Promise<VendorBill[]> {
  const data = await apiRequest<unknown>('/vendors-api/vendor-bills', { method: 'GET' });
  return (data as VendorBill[]).map((r) => VendorBillSchema.parse(r));
}

export async function getVendorBill(id: string): Promise<VendorBill> {
  const data = await apiRequest<unknown>(`/vendors-api/vendor-bills/${id}`, { method: 'GET' });
  return VendorBillSchema.parse(data);
}

export async function createVendorBill(input: Partial<VendorBill>): Promise<VendorBill> {
  const data = await apiRequest<unknown>('/vendors-api/vendor-bills', { method: 'POST', body: input });
  return VendorBillSchema.parse(data);
}

export async function updateVendorBill(id: string, input: Partial<VendorBill>): Promise<VendorBill> {
  const data = await apiRequest<unknown>(`/vendors-api/vendor-bills/${id}`, { method: 'PATCH', body: input });
  return VendorBillSchema.parse(data);
}

export async function transitionVendorBill(id: string, to: VendorBillStatus): Promise<VendorBill> {
  const data = await apiRequest<unknown>(
    `/vendors-api/vendor-bills/${id}/transition`,
    { method: 'POST', body: { to } },
  );
  return VendorBillSchema.parse(data);
}
