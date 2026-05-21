/**
 * Customers service. Thin wrappers over the crm-api /customers routes.
 * Schemas come from @/lib/types/crm which is the SPA-side byte-mirror of
 * supabase/functions/_shared/types/crm.ts.
 */

import { apiRequest } from '@/lib/apiClient';
import {
  CustomerSchema,
  type Customer,
  type CustomerCreate,
  type CustomerPatch,
} from '@/lib/types/crm';
import { z } from 'zod';

const CustomerListSchema = z.array(CustomerSchema);

export type ListCustomersFilters = {
  q?: string;
  status?: string;
  kind?: string;
  cursor?: string;
  limit?: number;
};

function qs(filters: ListCustomersFilters): string {
  const p = new URLSearchParams();
  if (filters.q) p.set('q', filters.q);
  if (filters.status) p.set('status', filters.status);
  if (filters.kind) p.set('kind', filters.kind);
  if (filters.cursor) p.set('cursor', filters.cursor);
  if (filters.limit !== undefined) p.set('limit', String(filters.limit));
  const s = p.toString();
  return s ? `?${s}` : '';
}

export async function listCustomers(
  filters: ListCustomersFilters = {},
): Promise<Customer[]> {
  const data = await apiRequest<unknown>(`/crm-api/customers${qs(filters)}`, {
    method: 'GET',
  });
  return CustomerListSchema.parse(data);
}

export async function getCustomer(id: string): Promise<Customer> {
  const data = await apiRequest<unknown>(`/crm-api/customers/${id}`, {
    method: 'GET',
  });
  return CustomerSchema.parse(data);
}

export async function createCustomer(body: CustomerCreate): Promise<Customer> {
  const data = await apiRequest<unknown>(`/crm-api/customers`, {
    method: 'POST',
    body,
  });
  return CustomerSchema.parse(data);
}

export async function updateCustomer(
  id: string,
  body: CustomerPatch,
): Promise<Customer> {
  const data = await apiRequest<unknown>(`/crm-api/customers/${id}`, {
    method: 'PATCH',
    body,
  });
  return CustomerSchema.parse(data);
}

export async function deleteCustomer(id: string): Promise<void> {
  await apiRequest<unknown>(`/crm-api/customers/${id}`, { method: 'DELETE' });
}

export interface InviteToPortalResult {
  membership_id: string;
  user_id: string;
  email: string;
  customer_id: string;
}

export async function inviteCustomerToPortal(
  id: string,
  body: { email_override?: string } = {},
): Promise<InviteToPortalResult> {
  const data = await apiRequest<unknown>(
    `/crm-api/customers/${id}/invite-to-portal`,
    { method: 'POST', body },
  );
  return data as InviteToPortalResult;
}
