// Vendor bills service.

import { apiRequest } from '@/lib/apiClient';
import { VendorBillSchema, type VendorBill, type VendorBillStatus } from '@/lib/types/vendors_inventory_ops';

export type { VendorBill, VendorBillStatus };

export type ListVendorBillsFilters = {
  vendor_id?: string;
};

function vendorBillsQs(f: ListVendorBillsFilters): string {
  const p = new URLSearchParams();
  if (f.vendor_id) p.set('vendor_id', f.vendor_id);
  const s = p.toString();
  return s ? `?${s}` : '';
}

export async function listVendorBills(
  filters: ListVendorBillsFilters = {},
): Promise<VendorBill[]> {
  const data = await apiRequest<unknown>(
    `/vendors-api/vendor-bills${vendorBillsQs(filters)}`,
    { method: 'GET' },
  );
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
