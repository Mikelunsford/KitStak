// Vendor bill payments service.

import { apiRequest } from '@/lib/apiClient';
import { VendorBillPaymentSchema, type VendorBillPayment } from '@/lib/types/vendors_inventory_ops';

export type { VendorBillPayment };

export async function listVendorBillPayments(billId: string): Promise<VendorBillPayment[]> {
  const data = await apiRequest<unknown>(
    `/vendors-api/vendor-bills/${billId}/payments`, { method: 'GET' },
  );
  return (data as VendorBillPayment[]).map((r) => VendorBillPaymentSchema.parse(r));
}

export async function createVendorBillPayment(
  billId: string,
  input: Partial<VendorBillPayment>,
): Promise<VendorBillPayment> {
  const data = await apiRequest<unknown>(
    `/vendors-api/vendor-bills/${billId}/payments`,
    { method: 'POST', body: input },
  );
  return VendorBillPaymentSchema.parse(data);
}
