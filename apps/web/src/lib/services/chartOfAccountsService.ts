/**
 * Chart of accounts service. Wraps finance-api/coa.
 */

import { z } from 'zod';

import { apiRequest } from '@/lib/apiClient';
import {
  AccountTypeSchema,
  ChartOfAccountSchema,
  type ChartOfAccount,
} from '@/lib/types/finance';

const CoaListSchema = z.array(ChartOfAccountSchema);

export type CoaCreate = {
  code: string;
  name: string;
  account_type: z.infer<typeof AccountTypeSchema>;
  parent_account_id?: string;
  is_active?: boolean;
  description?: string;
};

export type CoaPatch = Partial<CoaCreate>;

export async function listChartOfAccounts(): Promise<ChartOfAccount[]> {
  const data = await apiRequest<unknown>(`/finance-api/coa`, { method: 'GET' });
  return CoaListSchema.parse(data);
}

export async function getChartOfAccount(id: string): Promise<ChartOfAccount> {
  const data = await apiRequest<unknown>(`/finance-api/coa/${id}`, { method: 'GET' });
  return ChartOfAccountSchema.parse(data);
}

export async function createChartOfAccount(body: CoaCreate): Promise<ChartOfAccount> {
  const data = await apiRequest<unknown>(`/finance-api/coa`, {
    method: 'POST',
    body,
  });
  return ChartOfAccountSchema.parse(data);
}

export async function updateChartOfAccount(
  id: string,
  body: CoaPatch,
): Promise<ChartOfAccount> {
  const data = await apiRequest<unknown>(`/finance-api/coa/${id}`, {
    method: 'PATCH',
    body,
  });
  return ChartOfAccountSchema.parse(data);
}

export async function deleteChartOfAccount(id: string): Promise<void> {
  await apiRequest<unknown>(`/finance-api/coa/${id}`, { method: 'DELETE' });
}
