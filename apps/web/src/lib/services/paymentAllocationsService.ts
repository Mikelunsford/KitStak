/**
 * Payment allocations service. Wraps the apply endpoint helpers.
 * The allocation is created server-side by applyPayment; this thin module
 * lives for hook consistency.
 */

import { PaymentAllocationSchema, type PaymentAllocation } from '@/lib/types/finance';
import { applyPayment, type PaymentApplyBody } from '@/lib/services/paymentsService';

export type { PaymentApplyBody } from '@/lib/services/paymentsService';

export async function applyPaymentAllocations(
  paymentId: string,
  body: PaymentApplyBody,
): Promise<PaymentAllocation[]> {
  return applyPayment(paymentId, body);
}

export { PaymentAllocationSchema };
