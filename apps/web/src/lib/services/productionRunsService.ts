// Production runs service. Lives under bundle-gated ops-api.

import { apiRequest } from '@/lib/apiClient';
import {
  ProductionRunSchema, type ProductionRun, type ProductionRunStatus,
} from '@/lib/types/vendors_inventory_ops';

export type { ProductionRun, ProductionRunStatus };

export async function listProductionRuns(): Promise<ProductionRun[]> {
  const data = await apiRequest<unknown>('/ops-api/production-runs', { method: 'GET' });
  return (data as ProductionRun[]).map((r) => ProductionRunSchema.parse(r));
}

export async function getProductionRun(id: string): Promise<ProductionRun> {
  const data = await apiRequest<unknown>(`/ops-api/production-runs/${id}`, { method: 'GET' });
  return ProductionRunSchema.parse(data);
}

export async function createProductionRun(input: Partial<ProductionRun>): Promise<ProductionRun> {
  const data = await apiRequest<unknown>('/ops-api/production-runs', { method: 'POST', body: input });
  return ProductionRunSchema.parse(data);
}

export async function updateProductionRun(id: string, input: Partial<ProductionRun>): Promise<ProductionRun> {
  const data = await apiRequest<unknown>(`/ops-api/production-runs/${id}`, { method: 'PATCH', body: input });
  return ProductionRunSchema.parse(data);
}

export async function startProductionRun(id: string): Promise<ProductionRun> {
  const data = await apiRequest<unknown>(`/ops-api/production-runs/${id}/start`, { method: 'POST', body: {} });
  return ProductionRunSchema.parse(data);
}

export interface CompleteRunInput {
  quantity_produced: number | string;
  consumed: Array<{ item_id: string; quantity: number | string; unit_cost_cents?: number }>;
  produced?: { item_id?: string; quantity?: number | string; unit_cost_cents?: number };
}

export async function completeProductionRun(id: string, input: CompleteRunInput): Promise<ProductionRun> {
  const data = await apiRequest<unknown>(
    `/ops-api/production-runs/${id}/complete`, { method: 'POST', body: input },
  );
  return ProductionRunSchema.parse(data);
}
