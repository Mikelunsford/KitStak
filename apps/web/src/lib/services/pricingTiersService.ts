import { apiRequest } from '@/lib/apiClient';
import {
  PricingTierSchema,
  PricingTierCreateSchema,
  PricingTierPatchSchema,
  type PricingTier,
  type PricingTierCreate,
  type PricingTierPatch,
} from '@/lib/types/sales';
import { z } from 'zod';

const ListEnvelope = z.object({
  items: z.array(PricingTierSchema),
  next_cursor: z.string().nullable().optional(),
});

export async function listPricingTiers(): Promise<PricingTier[]> {
  const raw = await apiRequest<unknown>('/sales-config-api/pricing-tiers', { method: 'GET' });
  return ListEnvelope.parse(raw).items;
}

export async function createPricingTier(payload: PricingTierCreate): Promise<PricingTier> {
  const body = PricingTierCreateSchema.parse(payload);
  const raw = await apiRequest<unknown>('/sales-config-api/pricing-tiers', {
    method: 'POST', body,
  });
  return PricingTierSchema.parse(raw);
}

export async function getPricingTier(id: string): Promise<PricingTier> {
  const raw = await apiRequest<unknown>(`/sales-config-api/pricing-tiers/${id}`, { method: 'GET' });
  return PricingTierSchema.parse(raw);
}

export async function updatePricingTier(id: string, payload: PricingTierPatch): Promise<PricingTier> {
  const body = PricingTierPatchSchema.parse(payload);
  const raw = await apiRequest<unknown>(`/sales-config-api/pricing-tiers/${id}`, {
    method: 'PATCH', body,
  });
  return PricingTierSchema.parse(raw);
}
