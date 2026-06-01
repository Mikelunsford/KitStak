import { apiRequest } from '@/lib/apiClient';
import {
  PaymentMethodSchema,
  PaymentMethodCreateSchema,
  PaymentMethodPatchSchema,
  type PaymentMethod,
  type PaymentMethodCreate,
  type PaymentMethodPatch,
} from '@/lib/types/sales';
import { z } from 'zod';

const ListEnvelope = z.object({
  items: z.array(PaymentMethodSchema),
  next_cursor: z.string().nullable().optional(),
});

export async function listPaymentMethods(): Promise<PaymentMethod[]> {
  const raw = await apiRequest<unknown>('/sales-config-api/payment-methods', { method: 'GET' });
  return ListEnvelope.parse(raw).items;
}

export async function createPaymentMethod(payload: PaymentMethodCreate): Promise<PaymentMethod> {
  const body = PaymentMethodCreateSchema.parse(payload);
  const raw = await apiRequest<unknown>('/sales-config-api/payment-methods', {
    method: 'POST', body,
  });
  return PaymentMethodSchema.parse(raw);
}

export async function getPaymentMethod(id: string): Promise<PaymentMethod> {
  const raw = await apiRequest<unknown>(`/sales-config-api/payment-methods/${id}`, { method: 'GET' });
  return PaymentMethodSchema.parse(raw);
}

export async function updatePaymentMethod(id: string, payload: PaymentMethodPatch): Promise<PaymentMethod> {
  const body = PaymentMethodPatchSchema.parse(payload);
  const raw = await apiRequest<unknown>(`/sales-config-api/payment-methods/${id}`, {
    method: 'PATCH', body,
  });
  return PaymentMethodSchema.parse(raw);
}

export async function setDefaultPaymentMethod(id: string): Promise<{ id: string }> {
  return apiRequest(`/sales-config-api/payment-methods/${id}/set-default`, { method: 'POST' });
}
