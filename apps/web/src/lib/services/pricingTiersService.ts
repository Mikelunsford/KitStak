import { apiRequest } from '@/lib/apiClient';
import { PricingTierSchema, type PricingTier } from '@/lib/types/sales';
import { z } from 'zod';

const ListEnvelope = z.object({
  items: z.array(PricingTierSchema),
  next_cursor: z.string().nullable().optional(),
});

export async function listPricingTiers(): Promise<PricingTier[]> {
  const raw = await apiRequest<unknown>('/sales-config-api/pricing-tiers', { method: 'GET' });
  return ListEnvelope.parse(raw).items;
}

export async function createPricingTier(payload: Partial<PricingTier>): Promise<PricingTier> {
  const raw = await apiRequest<unknown>('/sales-config-api/pricing-tiers', {
    method: 'POST', body: payload,
  });
  return PricingTierSchema.parse(raw);
}
