// Service layer for estimates-api (ADR 0006 P1c). Pure API calls, no React.

import { apiRequest } from '@/lib/apiClient';
import {
  EstimateSchema,
  EstimateResultSchema,
  CreateEstimateRequestSchema,
  UpdateEstimateRequestSchema,
  ConvertEstimateRequestSchema,
  type Estimate,
  type CreateEstimateRequest,
  type UpdateEstimateRequest,
  type ConvertEstimateRequest,
} from '@/lib/types/estimate';
import { z } from 'zod';

const BASE = '/estimates-api/estimates';

const ListEnvelope = z.object({
  items: z.array(EstimateSchema),
  next_cursor: z.string().nullable().optional(),
});

const EstimateWithResultSchema = z.object({
  estimate: EstimateSchema,
  result: EstimateResultSchema,
});
export type EstimateWithResult = z.infer<typeof EstimateWithResultSchema>;

const ConvertResponseSchema = z.object({
  quote_id: z.string().uuid(),
  estimate_id: z.string().uuid(),
});
export type ConvertResponse = z.infer<typeof ConvertResponseSchema>;

export async function listEstimates(): Promise<Estimate[]> {
  const raw = await apiRequest<unknown>(BASE, { method: 'GET' });
  return ListEnvelope.parse(raw).items;
}

export async function getEstimate(id: string): Promise<EstimateWithResult> {
  const raw = await apiRequest<unknown>(`${BASE}/${id}`, { method: 'GET' });
  return EstimateWithResultSchema.parse(raw);
}

export async function createEstimate(payload: CreateEstimateRequest): Promise<Estimate> {
  const body = CreateEstimateRequestSchema.parse(payload);
  const raw = await apiRequest<unknown>(BASE, { method: 'POST', body });
  return EstimateSchema.parse(raw);
}

export async function updateEstimate(id: string, payload: UpdateEstimateRequest): Promise<Estimate> {
  const body = UpdateEstimateRequestSchema.parse(payload);
  const raw = await apiRequest<unknown>(`${BASE}/${id}`, { method: 'PATCH', body });
  return EstimateSchema.parse(raw);
}

export async function convertEstimate(
  id: string,
  payload: ConvertEstimateRequest = {},
): Promise<ConvertResponse> {
  const body = ConvertEstimateRequestSchema.parse(payload);
  const raw = await apiRequest<unknown>(`${BASE}/${id}/convert`, { method: 'POST', body });
  return ConvertResponseSchema.parse(raw);
}

export async function cancelEstimate(id: string): Promise<Estimate> {
  const raw = await apiRequest<unknown>(`${BASE}/${id}/cancel`, { method: 'POST', body: {} });
  return EstimateSchema.parse(raw);
}

export async function deleteEstimate(id: string): Promise<void> {
  await apiRequest<unknown>(`${BASE}/${id}`, { method: 'DELETE' });
}
