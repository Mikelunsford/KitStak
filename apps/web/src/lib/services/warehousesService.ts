// Warehouses service.

import { apiRequest } from '@/lib/apiClient';
import { WarehouseSchema, type Warehouse } from '@/lib/types/vendors_inventory_ops';

export type { Warehouse };

export async function listWarehouses(): Promise<Warehouse[]> {
  const data = await apiRequest<unknown>('/inventory-api/warehouses', { method: 'GET' });
  return (data as Warehouse[]).map((r) => WarehouseSchema.parse(r));
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
