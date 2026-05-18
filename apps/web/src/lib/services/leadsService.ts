/**
 * Leads service. State machine align with workflow/crm.ts. Convert flow
 * calls the POST /:id/convert endpoint that wraps the convert_lead RPC.
 */

import { apiRequest } from '@/lib/apiClient';
import {
  LeadConvertResultSchema,
  LeadSchema,
  type Lead,
  type LeadConvert,
  type LeadConvertResult,
  type LeadCreate,
  type LeadPatch,
} from '@/lib/types/crm';
import { z } from 'zod';

const LeadListSchema = z.array(LeadSchema);

export type ListLeadsFilters = {
  status?: string;
  owner_user_id?: string;
  q?: string;
  cursor?: string;
  limit?: number;
};

function qs(filters: ListLeadsFilters): string {
  const p = new URLSearchParams();
  if (filters.status) p.set('status', filters.status);
  if (filters.owner_user_id) p.set('owner_user_id', filters.owner_user_id);
  if (filters.q) p.set('q', filters.q);
  if (filters.cursor) p.set('cursor', filters.cursor);
  if (filters.limit !== undefined) p.set('limit', String(filters.limit));
  const s = p.toString();
  return s ? `?${s}` : '';
}

export async function listLeads(
  filters: ListLeadsFilters = {},
): Promise<Lead[]> {
  const data = await apiRequest<unknown>(`/crm-api/leads${qs(filters)}`, {
    method: 'GET',
  });
  return LeadListSchema.parse(data);
}

export async function getLead(id: string): Promise<Lead> {
  const data = await apiRequest<unknown>(`/crm-api/leads/${id}`, {
    method: 'GET',
  });
  return LeadSchema.parse(data);
}

export async function createLead(body: LeadCreate): Promise<Lead> {
  const data = await apiRequest<unknown>(`/crm-api/leads`, {
    method: 'POST',
    body,
  });
  return LeadSchema.parse(data);
}

export async function updateLead(id: string, body: LeadPatch): Promise<Lead> {
  const data = await apiRequest<unknown>(`/crm-api/leads/${id}`, {
    method: 'PATCH',
    body,
  });
  return LeadSchema.parse(data);
}

export async function convertLead(
  id: string,
  body: LeadConvert,
): Promise<LeadConvertResult> {
  const data = await apiRequest<unknown>(`/crm-api/leads/${id}/convert`, {
    method: 'POST',
    body,
  });
  return LeadConvertResultSchema.parse(data);
}
