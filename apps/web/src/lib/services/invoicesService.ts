/**
 * Invoices service. Wraps invoicing-api/invoices.
 * Schemas come from @/lib/types/finance which is byte-mirrored to
 * supabase/functions/_shared/types/finance.ts.
 */

import { z } from 'zod';

import { apiRequest } from '@/lib/apiClient';
import {
  InvoiceSchema,
  InvoiceStatusSchema,
  type Invoice,
} from '@/lib/types/finance';

const InvoiceListSchema = z.array(InvoiceSchema);

export type ListInvoicesFilters = {
  status?: string;
  customer_id?: string;
  project_id?: string;
  cursor?: string;
  limit?: number;
};

export type InvoiceCreate = {
  invoice_number: string;
  customer_id?: string;
  project_id?: string;
  quote_id?: string;
  currency_code?: string;
  issue_date?: string;
  due_date?: string;
  notes?: string;
};

export type InvoicePatch = Partial<InvoiceCreate>;

function qs(f: ListInvoicesFilters): string {
  const p = new URLSearchParams();
  if (f.status) p.set('status', f.status);
  if (f.customer_id) p.set('customer_id', f.customer_id);
  if (f.project_id) p.set('project_id', f.project_id);
  if (f.cursor) p.set('cursor', f.cursor);
  if (f.limit !== undefined) p.set('limit', String(f.limit));
  const s = p.toString();
  return s ? `?${s}` : '';
}

export async function listInvoices(
  filters: ListInvoicesFilters = {},
): Promise<Invoice[]> {
  const data = await apiRequest<unknown>(`/invoicing-api/invoices${qs(filters)}`, {
    method: 'GET',
  });
  return InvoiceListSchema.parse(data);
}

export async function getInvoice(id: string): Promise<Invoice> {
  const data = await apiRequest<unknown>(`/invoicing-api/invoices/${id}`, {
    method: 'GET',
  });
  return InvoiceSchema.parse(data);
}

export async function createInvoice(body: InvoiceCreate): Promise<Invoice> {
  const data = await apiRequest<unknown>(`/invoicing-api/invoices`, {
    method: 'POST',
    body,
  });
  return InvoiceSchema.parse(data);
}

export async function updateInvoice(
  id: string,
  body: InvoicePatch,
): Promise<Invoice> {
  const data = await apiRequest<unknown>(`/invoicing-api/invoices/${id}`, {
    method: 'PATCH',
    body,
  });
  return InvoiceSchema.parse(data);
}

export async function deleteInvoice(id: string): Promise<void> {
  await apiRequest<unknown>(`/invoicing-api/invoices/${id}`, { method: 'DELETE' });
}

export async function sendInvoice(id: string): Promise<Invoice> {
  const data = await apiRequest<unknown>(`/invoicing-api/invoices/${id}/send`, {
    method: 'POST',
    body: {},
  });
  return InvoiceSchema.parse(data);
}

export async function cancelInvoice(id: string): Promise<Invoice> {
  const data = await apiRequest<unknown>(`/invoicing-api/invoices/${id}/cancel`, {
    method: 'POST',
    body: {},
  });
  return InvoiceSchema.parse(data);
}

export async function transitionInvoice(
  id: string,
  to: z.infer<typeof InvoiceStatusSchema>,
): Promise<Invoice> {
  const data = await apiRequest<unknown>(
    `/invoicing-api/invoices/${id}/transition`,
    { method: 'POST', body: { to } },
  );
  return InvoiceSchema.parse(data);
}
