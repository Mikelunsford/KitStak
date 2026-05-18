import { apiRequest } from '@/lib/apiClient';
import { ExchangeRateSchema, type ExchangeRate } from '@/lib/types/sales';
import { z } from 'zod';

const ListEnvelope = z.object({
  items: z.array(ExchangeRateSchema),
  next_cursor: z.string().nullable().optional(),
});

export async function listExchangeRates(): Promise<ExchangeRate[]> {
  const raw = await apiRequest<unknown>('/sales-config-api/exchange-rates', { method: 'GET' });
  return ListEnvelope.parse(raw).items;
}

export async function createExchangeRate(payload: Partial<ExchangeRate>): Promise<ExchangeRate> {
  const raw = await apiRequest<unknown>('/sales-config-api/exchange-rates', {
    method: 'POST', body: payload,
  });
  return ExchangeRateSchema.parse(raw);
}
