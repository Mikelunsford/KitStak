import { apiRequest } from '@/lib/apiClient';
import { TaxSchema, TaxCreateSchema, TaxPatchSchema, type Tax, type TaxCreate, type TaxPatch } from '@/lib/types/sales';
import { z } from 'zod';

const ListEnvelope = z.object({
  items: z.array(TaxSchema),
  next_cursor: z.string().nullable().optional(),
});

export async function listTaxes(): Promise<Tax[]> {
  const raw = await apiRequest<unknown>('/sales-config-api/taxes', { method: 'GET' });
  return ListEnvelope.parse(raw).items;
}

export async function getTax(id: string): Promise<Tax> {
  const raw = await apiRequest<unknown>(`/sales-config-api/taxes/${id}`, { method: 'GET' });
  return TaxSchema.parse(raw);
}

export async function createTax(payload: TaxCreate): Promise<Tax> {
  const body = TaxCreateSchema.parse(payload);
  const raw = await apiRequest<unknown>('/sales-config-api/taxes', {
    method: 'POST', body,
  });
  return TaxSchema.parse(raw);
}

export async function updateTax(id: string, payload: TaxPatch): Promise<Tax> {
  const body = TaxPatchSchema.parse(payload);
  const raw = await apiRequest<unknown>(`/sales-config-api/taxes/${id}`, {
    method: 'PATCH', body,
  });
  return TaxSchema.parse(raw);
}

export async function setDefaultTax(id: string): Promise<{ id: string }> {
  return apiRequest(`/sales-config-api/taxes/${id}/set-default`, { method: 'POST' });
}

export async function deleteTax(id: string): Promise<{ id: string; deleted: boolean }> {
  return apiRequest(`/sales-config-api/taxes/${id}`, { method: 'DELETE' });
}
