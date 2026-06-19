// Warehouses service.

import { apiRequest } from '@/lib/apiClient';
import { serverListQs, type ServerListParams } from '@/lib/services/serverListQs';
import { WarehouseSchema, type Warehouse } from '@/lib/types/vendors_inventory_ops';
import { z } from 'zod';

export type { Warehouse };

const WarehouseListEnvelope = z.object({
  items: z.array(WarehouseSchema),
  next_cursor: z.string().nullable().optional(),
});

export async function listWarehouses(): Promise<Warehouse[]> {
  const data = await apiRequest<unknown>('/inventory-api/warehouses', { method: 'GET' });
  return WarehouseListEnvelope.parse(data).items;
}

// Workstream C: server-driven list toolbar page (search, sort, keyset). The
// warehouse list returns its rows and next_cursor together in `data`, so this
// reads the data envelope directly via apiRequest.
export async function listWarehousesPage(
  params: ServerListParams,
): Promise<{ items: Warehouse[]; next_cursor: string | null }> {
  const raw = await apiRequest<unknown>(
    `/inventory-api/warehouses${serverListQs(params)}`,
    { method: 'GET' },
  );
  const parsed = WarehouseListEnvelope.parse(raw);
  return { items: parsed.items, next_cursor: parsed.next_cursor ?? null };
}

export async function getWarehouse(id: string): Promise<Warehouse> {
  const data = await apiRequest<unknown>(`/inventory-api/warehouses/${id}`, { method: 'GET' });
  return WarehouseSchema.parse(data);
}

export async function createWarehouse(input: Partial<Warehouse>): Promise<Warehouse> {
  const data = await apiRequest<unknown>('/inventory-api/warehouses', { method: 'POST', body: input });
  return WarehouseSchema.parse(data);
}

export async function updateWarehouse(id: string, input: Partial<Warehouse>): Promise<Warehouse> {
  const data = await apiRequest<unknown>(`/inventory-api/warehouses/${id}`, { method: 'PATCH', body: input });
  return WarehouseSchema.parse(data);
}

export async function deleteWarehouse(id: string): Promise<void> {
  await apiRequest<unknown>(`/inventory-api/warehouses/${id}`, { method: 'DELETE' });
}
