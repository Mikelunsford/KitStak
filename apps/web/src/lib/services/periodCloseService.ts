/**
 * Period close service. Wraps finance-api/period-close.
 * close_period and reopen_period are RPCs; the route layer enforces
 * org_admin / accounting capability checks.
 */

import { z } from 'zod';

import { apiRequest } from '@/lib/apiClient';
import { PeriodCloseSchema, type PeriodClose } from '@/lib/types/finance';

const PeriodCloseListSchema = z.array(PeriodCloseSchema);

export type PeriodInput = {
  period_year: number;
  period_month: number;
};

export async function listPeriodClose(opts: { year?: number } = {}): Promise<PeriodClose[]> {
  const p = new URLSearchParams();
  if (opts.year !== undefined) p.set('year', String(opts.year));
  const s = p.toString();
  const data = await apiRequest<unknown>(`/finance-api/period-close${s ? `?${s}` : ''}`, {
    method: 'GET',
  });
  return PeriodCloseListSchema.parse(data);
}

export async function closePeriod(body: PeriodInput): Promise<PeriodClose> {
  const data = await apiRequest<unknown>(`/finance-api/period-close/close`, {
    method: 'POST',
    body,
  });
  return PeriodCloseSchema.parse(data);
}

export async function reopenPeriod(body: PeriodInput): Promise<PeriodClose> {
  const data = await apiRequest<unknown>(`/finance-api/period-close/reopen`, {
    method: 'POST',
    body,
  });
  return PeriodCloseSchema.parse(data);
}
