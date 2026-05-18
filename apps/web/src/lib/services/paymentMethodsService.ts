import { apiRequest } from '@/lib/apiClient';
import { PaymentMethodSchema, type PaymentMethod } from '@/lib/types/sales';
import { z } from 'zod';

const ListEnvelope = z.object({
  items: z.array(PaymentMethodSchema),
  next_cursor: z.string().nullable().optional(),
});

export async function listPaymentMethods(): Promise<PaymentMethod[]> {
  const raw = await apiRequest<unknown>('/sales-config-api/payment-methods', { method: 'GET' });
  return ListEnvelope.parse(raw).items;
}

export async function createPaymentMethod(payload: Partial<PaymentMethod>): Promise<PaymentMethod> {
  const raw = await apiRequest<unknown>('/sales-config-api/payment-methods', {
    method: 'POST', body: payload,
  });
  return PaymentMethodSchema.parse(raw);
}

export async function setDefaultPaymentMethod(id: string): Promise<{ id: string }> {
  return apiRequest(`/sales-config-api/payment-methods/${id}/set-default`, { method: 'POST' });
}
