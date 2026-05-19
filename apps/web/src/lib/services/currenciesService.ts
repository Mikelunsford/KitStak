import { apiRequest } from '@/lib/apiClient';
import { CurrencySchema, type Currency } from '@/lib/types/sales';
import { z } from 'zod';

const ListSchema = z.array(CurrencySchema);

export async function listCurrencies(): Promise<Currency[]> {
  const raw = await apiRequest<unknown>('/sales-config-api/currencies', { method: 'GET' });
  return ListSchema.parse(raw);
}
