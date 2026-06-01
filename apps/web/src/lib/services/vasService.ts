import { apiRequest } from '@/lib/apiClient';
import {
  ValueAddedServiceSchema,
  ValueAddedServiceCreateSchema,
  ValueAddedServicePatchSchema,
  type ValueAddedService,
  type ValueAddedServiceCreate,
  type ValueAddedServicePatch,
} from '@/lib/types/sales';
import { z } from 'zod';

const ListEnvelope = z.object({
  items: z.array(ValueAddedServiceSchema),
  next_cursor: z.string().nullable().optional(),
});

export async function listValueAddedServices(): Promise<ValueAddedService[]> {
  const raw = await apiRequest<unknown>('/sales-config-api/value-added-services', { method: 'GET' });
  return ListEnvelope.parse(raw).items;
}

export async function createValueAddedService(payload: ValueAddedServiceCreate): Promise<ValueAddedService> {
  const body = ValueAddedServiceCreateSchema.parse(payload);
  const raw = await apiRequest<unknown>('/sales-config-api/value-added-services', {
    method: 'POST', body,
  });
  return ValueAddedServiceSchema.parse(raw);
}

export async function getValueAddedService(id: string): Promise<ValueAddedService> {
  const raw = await apiRequest<unknown>(`/sales-config-api/value-added-services/${id}`, { method: 'GET' });
  return ValueAddedServiceSchema.parse(raw);
}

export async function updateValueAddedService(id: string, payload: ValueAddedServicePatch): Promise<ValueAddedService> {
  const body = ValueAddedServicePatchSchema.parse(payload);
  const raw = await apiRequest<unknown>(`/sales-config-api/value-added-services/${id}`, {
    method: 'PATCH', body,
  });
  return ValueAddedServiceSchema.parse(raw);
}
