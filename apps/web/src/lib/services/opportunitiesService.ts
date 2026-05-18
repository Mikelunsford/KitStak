/**
 * Opportunities service. Stage moves go through transitionStage, not the
 * generic patch.
 */

import { apiRequest } from '@/lib/apiClient';
import {
  OpportunitySchema,
  type Opportunity,
  type OpportunityCreate,
  type OpportunityPatch,
  type OpportunityStageTransition,
} from '@/lib/types/crm';
import { z } from 'zod';

const OpportunityListSchema = z.array(OpportunitySchema);

export type ListOpportunitiesFilters = {
  stage?: string;
  customer_id?: string;
  owner_user_id?: string;
  cursor?: string;
  limit?: number;
};

function qs(filters: ListOpportunitiesFilters): string {
  const p = new URLSearchParams();
  if (filters.stage) p.set('stage', filters.stage);
  if (filters.customer_id) p.set('customer_id', filters.customer_id);
  if (filters.owner_user_id) p.set('owner_user_id', filters.owner_user_id);
  if (filters.cursor) p.set('cursor', filters.cursor);
  if (filters.limit !== undefined) p.set('limit', String(filters.limit));
  const s = p.toString();
  return s ? `?${s}` : '';
}

export async function listOpportunities(
  filters: ListOpportunitiesFilters = {},
): Promise<Opportunity[]> {
  const data = await apiRequest<unknown>(`/crm-api/opportunities${qs(filters)}`, {
    method: 'GET',
  });
  return OpportunityListSchema.parse(data);
}

export async function getOpportunity(id: string): Promise<Opportunity> {
  const data = await apiRequest<unknown>(`/crm-api/opportunities/${id}`, {
    method: 'GET',
  });
  return OpportunitySchema.parse(data);
}

export async function createOpportunity(
  body: OpportunityCreate,
): Promise<Opportunity> {
  const data = await apiRequest<unknown>(`/crm-api/opportunities`, {
    method: 'POST',
    body,
  });
  return OpportunitySchema.parse(data);
}

export async function updateOpportunity(
  id: string,
  body: OpportunityPatch,
): Promise<Opportunity> {
  const data = await apiRequest<unknown>(`/crm-api/opportunities/${id}`, {
    method: 'PATCH',
    body,
  });
  return OpportunitySchema.parse(data);
}

export async function transitionOpportunityStage(
  id: string,
  body: OpportunityStageTransition,
): Promise<Opportunity> {
  const data = await apiRequest<unknown>(
    `/crm-api/opportunities/${id}/transition`,
    { method: 'POST', body },
  );
  return OpportunitySchema.parse(data);
}
