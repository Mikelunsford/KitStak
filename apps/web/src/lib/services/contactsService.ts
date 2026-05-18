/**
 * Contacts service. Thin wrappers over the crm-api /contacts routes.
 */

import { apiRequest } from '@/lib/apiClient';
import {
  ContactSchema,
  type Contact,
  type ContactCreate,
  type ContactPatch,
} from '@/lib/types/crm';
import { z } from 'zod';

const ContactListSchema = z.array(ContactSchema);

export type ListContactsFilters = {
  customer_id?: string;
  q?: string;
  cursor?: string;
  limit?: number;
};

function qs(filters: ListContactsFilters): string {
  const p = new URLSearchParams();
  if (filters.customer_id) p.set('customer_id', filters.customer_id);
  if (filters.q) p.set('q', filters.q);
  if (filters.cursor) p.set('cursor', filters.cursor);
  if (filters.limit !== undefined) p.set('limit', String(filters.limit));
  const s = p.toString();
  return s ? `?${s}` : '';
}

export async function listContacts(
  filters: ListContactsFilters = {},
): Promise<Contact[]> {
  const data = await apiRequest<unknown>(`/crm-api/contacts${qs(filters)}`, {
    method: 'GET',
  });
  return ContactListSchema.parse(data);
}

export async function getContact(id: string): Promise<Contact> {
  const data = await apiRequest<unknown>(`/crm-api/contacts/${id}`, {
    method: 'GET',
  });
  return ContactSchema.parse(data);
}

export async function createContact(body: ContactCreate): Promise<Contact> {
  const data = await apiRequest<unknown>(`/crm-api/contacts`, {
    method: 'POST',
    body,
  });
  return ContactSchema.parse(data);
}

export async function updateContact(
  id: string,
  body: ContactPatch,
): Promise<Contact> {
  const data = await apiRequest<unknown>(`/crm-api/contacts/${id}`, {
    method: 'PATCH',
    body,
  });
  return ContactSchema.parse(data);
}

export async function deleteContact(id: string): Promise<void> {
  await apiRequest<unknown>(`/crm-api/contacts/${id}`, { method: 'DELETE' });
}
