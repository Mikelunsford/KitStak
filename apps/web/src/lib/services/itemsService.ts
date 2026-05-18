import { apiRequest } from '@/lib/apiClient';
import { ItemSchema, type Item } from '@/lib/types/sales';
import { z } from 'zod';

const ListEnvelope = z.object({
  items: z.array(ItemSchema),
  next_cursor: z.string().nullable().optional(),
});

export async function listItems(): Promise<Item[]> {
  const raw = await apiRequest<unknown>('/sales-config-api/items', { method: 'GET' });
  return ListEnvelope.parse(raw).items;
}

export async function getItem(id: string): Promise<Item> {
  const raw = await apiRequest<unknown>(`/sales-config-api/items/${id}`, { method: 'GET' });
  return ItemSchema.parse(raw);
}

export async function createItem(payload: Partial<Item>): Promise<Item> {
  const raw = await apiRequest<unknown>('/sales-config-api/items', {
    method: 'POST', body: payload,
  });
  return ItemSchema.parse(raw);
}

export async function updateItem(id: string, payload: Partial<Item>): Promise<Item> {
  const raw = await apiRequest<unknown>(`/sales-config-api/items/${id}`, {
    method: 'PATCH', body: payload,
  });
  return ItemSchema.parse(raw);
}

export async function deleteItem(id: string): Promise<{ id: string; deleted: boolean }> {
  return apiRequest(`/sales-config-api/items/${id}`, { method: 'DELETE' });
}
