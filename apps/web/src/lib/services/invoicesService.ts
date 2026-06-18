/**
 * Invoices service. Wraps invoicing-api/invoices.
 * Schemas come from @/lib/types/finance which is byte-mirrored to
 * supabase/functions/_shared/types/finance.ts.
 */

import { z } from 'zod';

import { apiRequest, apiRequestWithMeta } from '@/lib/apiClient';
import { serverListQs, metaCursor, type ServerListParams } from '@/lib/services/serverListQs';
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

// BNEW-4 (v2 smoke 2026-05-22): invoice_number is optional. The handler
// allocates the next INV-YYYY-NNNNN via the numbering chassis when the field
// is absent. Operator-supplied values still win. Mirrors the quote / receiving
// / shipment shape landed at PR #105.
export type InvoiceCreate = {
  invoice_number?: string;
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

// Workstream C: server-driven list toolbar page (search, sort, keyset).
// The invoice list returns its rows in `data` and next_cursor in `meta`, so
// this reads the full envelope via apiRequestWithMeta.
export async function listInvoicesPage(
  params: ServerListParams,
): Promise<{ items: Invoice[]; next_cursor: string | null }> {
  const env = await apiRequestWithMeta<unknown>(
    `/invoicing-api/invoices${serverListQs(params)}`,
    { method: 'GET' },
  );
  return { items: InvoiceListSchema.parse(env.data), next_cursor: metaCursor(env.meta) };
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
