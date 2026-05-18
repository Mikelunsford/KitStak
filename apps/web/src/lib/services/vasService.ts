import { apiRequest } from '@/lib/apiClient';
import { ValueAddedServiceSchema, type ValueAddedService } from '@/lib/types/sales';
import { z } from 'zod';

const ListEnvelope = z.object({
  items: z.array(ValueAddedServiceSchema),
  next_cursor: z.string().nullable().optional(),
});

export async function listValueAddedServices(): Promise<ValueAddedService[]> {
  const raw = await apiRequest<unknown>('/sales-config-api/value-added-services', { method: 'GET' });
  return ListEnvelope.parse(raw).items;
}

export async function createValueAddedService(payload: Partial<ValueAddedService>): Promise<ValueAddedService> {
  const raw = await apiRequest<unknown>('/sales-config-api/value-added-services', {
    method: 'POST', body: payload,
  });
  return ValueAddedServiceSchema.parse(raw);
}
