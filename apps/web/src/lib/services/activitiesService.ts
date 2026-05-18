/**
 * Activities service. Polymorphic against customer / contact / lead /
 * opportunity; list takes entity_type + entity_id when scoped to a record.
 */

import { apiRequest } from '@/lib/apiClient';
import {
  ActivitySchema,
  type Activity,
  type ActivityCreate,
  type ActivityPatch,
} from '@/lib/types/crm';
import { z } from 'zod';

const ActivityListSchema = z.array(ActivitySchema);

export type ListActivitiesFilters = {
  entity_type?: string;
  entity_id?: string;
  status?: string;
  cursor?: string;
  limit?: number;
};

function qs(filters: ListActivitiesFilters): string {
  const p = new URLSearchParams();
  if (filters.entity_type) p.set('entity_type', filters.entity_type);
  if (filters.entity_id) p.set('entity_id', filters.entity_id);
  if (filters.status) p.set('status', filters.status);
  if (filters.cursor) p.set('cursor', filters.cursor);
  if (filters.limit !== undefined) p.set('limit', String(filters.limit));
  const s = p.toString();
  return s ? `?${s}` : '';
}

export async function listActivities(
  filters: ListActivitiesFilters = {},
): Promise<Activity[]> {
  const data = await apiRequest<unknown>(`/crm-api/activities${qs(filters)}`, {
    method: 'GET',
  });
  return ActivityListSchema.parse(data);
}

export async function getActivity(id: string): Promise<Activity> {
  const data = await apiRequest<unknown>(`/crm-api/activities/${id}`, {
    method: 'GET',
  });
  return ActivitySchema.parse(data);
}

export async function createActivity(body: ActivityCreate): Promise<Activity> {
  const data = await apiRequest<unknown>(`/crm-api/activities`, {
    method: 'POST',
    body,
  });
  return ActivitySchema.parse(data);
}

export async function updateActivity(
  id: string,
  body: ActivityPatch,
): Promise<Activity> {
  const data = await apiRequest<unknown>(`/crm-api/activities/${id}`, {
    method: 'PATCH',
    body,
  });
  return ActivitySchema.parse(data);
}
