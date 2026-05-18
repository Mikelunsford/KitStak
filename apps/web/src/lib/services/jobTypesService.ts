import { apiRequest } from '@/lib/apiClient';
import { JobTypeSchema, type JobType } from '@/lib/types/sales';
import { z } from 'zod';

const ListEnvelope = z.object({
  items: z.array(JobTypeSchema),
  next_cursor: z.string().nullable().optional(),
});

export async function listJobTypes(): Promise<JobType[]> {
  const raw = await apiRequest<unknown>('/sales-config-api/job-types', { method: 'GET' });
  return ListEnvelope.parse(raw).items;
}
