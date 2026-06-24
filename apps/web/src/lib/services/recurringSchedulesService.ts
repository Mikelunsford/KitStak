/**
 * Recurring schedules service. Wraps invoicing-api/recurring-schedules
 * (ADR 0005 Phase 2). Schemas come from @/lib/types/finance which is
 * byte-mirrored to supabase/functions/_shared/types/finance.ts.
 */

import { z } from 'zod';

import { apiRequest } from '@/lib/apiClient';
import {
  RecurringScheduleSchema,
  type RecurringSchedule,
  type CreateRecurringScheduleRequest,
} from '@/lib/types/finance';

const RecurringScheduleListSchema = z.array(RecurringScheduleSchema);

export type ListRecurringSchedulesFilters = {
  project_id?: string;
};

function qs(f: ListRecurringSchedulesFilters): string {
  const p = new URLSearchParams();
  if (f.project_id) p.set('project_id', f.project_id);
  const s = p.toString();
  return s ? `?${s}` : '';
}

export async function listRecurringSchedules(
  filters: ListRecurringSchedulesFilters = {},
): Promise<RecurringSchedule[]> {
  const data = await apiRequest<unknown>(
    `/invoicing-api/recurring-schedules${qs(filters)}`,
    { method: 'GET' },
  );
  return RecurringScheduleListSchema.parse(data);
}

export async function createRecurringSchedule(
  body: CreateRecurringScheduleRequest,
): Promise<RecurringSchedule> {
  const data = await apiRequest<unknown>(`/invoicing-api/recurring-schedules`, {
    method: 'POST',
    body,
  });
  return RecurringScheduleSchema.parse(data);
}

export async function pauseRecurringSchedule(id: string): Promise<RecurringSchedule> {
  const data = await apiRequest<unknown>(
    `/invoicing-api/recurring-schedules/${id}/pause`,
    { method: 'POST', body: {} },
  );
  return RecurringScheduleSchema.parse(data);
}

export async function resumeRecurringSchedule(id: string): Promise<RecurringSchedule> {
  const data = await apiRequest<unknown>(
    `/invoicing-api/recurring-schedules/${id}/resume`,
    { method: 'POST', body: {} },
  );
  return RecurringScheduleSchema.parse(data);
}

export async function endRecurringSchedule(id: string): Promise<RecurringSchedule> {
  const data = await apiRequest<unknown>(
    `/invoicing-api/recurring-schedules/${id}/end`,
    { method: 'POST', body: {} },
  );
  return RecurringScheduleSchema.parse(data);
}
