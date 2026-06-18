import { apiRequest } from '@/lib/apiClient';
import { serverListQs, type ServerListParams } from '@/lib/services/serverListQs';
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

// Workstream C: server-driven list toolbar page (search, sort, keyset).
// next_cursor rides in the data envelope for items, so apiRequest suffices.
export async function listItemsPage(
  params: ServerListParams,
): Promise<{ items: Item[]; next_cursor: string | null }> {
  const raw = await apiRequest<unknown>(`/sales-config-api/items${serverListQs(params)}`, { method: 'GET' });
  const parsed = ListEnvelope.parse(raw);
  return { items: parsed.items, next_cursor: parsed.next_cursor ?? null };
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
