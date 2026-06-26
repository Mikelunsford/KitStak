// Customer portal service. Calls customer-portal-api routes.

import { apiRequest } from '@/lib/apiClient';
import {
  PortalCustomerViewSchema,
  PortalInvoiceSummarySchema,
  type PortalCustomerView,
  type PortalInvoiceSummary,
} from '@/lib/types/cross_cutting';
import { z } from 'zod';

export async function getPortalMe(): Promise<PortalCustomerView> {
  const data = await apiRequest<unknown>('/customer-portal-api/portal/me', {
    method: 'GET',
  });
  return PortalCustomerViewSchema.parse(data);
}

const PortalInvoicesSchema = z.array(PortalInvoiceSummarySchema);

export async function listPortalInvoices(): Promise<PortalInvoiceSummary[]> {
  const data = await apiRequest<unknown>('/customer-portal-api/portal/invoices', {
    method: 'GET',
  });
  return PortalInvoicesSchema.parse(data);
}

const PortalQuoteSchema = z.object({
  id: z.string().uuid(),
  number: z.string(),
  status: z.string(),
  issued_at: z.string().nullable(),
  expires_at: z.string().nullable(),
  total_cents: z.union([z.number().int(), z.string().regex(/^-?\d+$/)]),
  currency_code: z.string(),
});
export type PortalQuote = z.infer<typeof PortalQuoteSchema>;
const PortalQuotesSchema = z.array(PortalQuoteSchema);

export async function listPortalQuotes(): Promise<PortalQuote[]> {
  const data = await apiRequest<unknown>('/customer-portal-api/portal/quotes', {
    method: 'GET',
  });
  return PortalQuotesSchema.parse(data);
}

const PortalProjectSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  status: z.string(),
  started_at: z.string().nullable(),
  expected_completion_at: z.string().nullable(),
});
export type PortalProject = z.infer<typeof PortalProjectSchema>;
const PortalProjectsSchema = z.array(PortalProjectSchema);

export async function listPortalProjects(): Promise<PortalProject[]> {
  const data = await apiRequest<unknown>('/customer-portal-api/portal/projects', {
    method: 'GET',
  });
  return PortalProjectsSchema.parse(data);
}

// ---------------------------------------------------------------------------
// F-Wave9-PORTAL-NO-ACTION-WIRING-01: detail fetch for the Download PDF
// action. The portal-api /portal/invoices/:id and /portal/quotes/:id
// endpoints are Pattern B scoped so the customer can ONLY pull their own
// invoice / quote — cross-customer hits return 404. The SPA then hands
// the result to pdf-worker's existing /pdf/render endpoint.
// ---------------------------------------------------------------------------

const PortalInvoiceLineItemSchema = z.object({
  id: z.string().uuid(),
  description: z.string().nullable().optional(),
  quantity: z.union([z.number(), z.string()]).nullable().optional(),
  unit_price_cents: z
    .union([z.number().int(), z.string()])
    .nullable()
    .optional(),
  line_total_cents: z
    .union([z.number().int(), z.string()])
    .nullable()
    .optional(),
});
export type PortalInvoiceLineItem = z.infer<typeof PortalInvoiceLineItemSchema>;

const PortalInvoiceDetailSchema = z.object({
  invoice: z.object({
    id: z.string().uuid(),
    invoice_number: z.string(),
    status: z.string(),
    issue_date: z.string().nullable(),
    due_date: z.string().nullable(),
    subtotal_cents: z.union([z.number().int(), z.string()]),
    tax_total_cents: z.union([z.number().int(), z.string()]),
    total_cents: z.union([z.number().int(), z.string()]),
    balance_cents: z.union([z.number().int(), z.string()]),
    currency_code: z.string(),
  }),
  line_items: z.array(PortalInvoiceLineItemSchema),
  customer_display_name: z.string(),
});
export type PortalInvoiceDetail = z.infer<typeof PortalInvoiceDetailSchema>;

export async function getPortalInvoice(id: string): Promise<PortalInvoiceDetail> {
  const data = await apiRequest<unknown>(
    `/customer-portal-api/portal/invoices/${encodeURIComponent(id)}`,
    { method: 'GET' },
  );
  return PortalInvoiceDetailSchema.parse(data);
}

const PortalQuoteLineItemSchema = z.object({
  id: z.string().uuid(),
  name: z.string().nullable().optional(),
  quantity_e3: z
    .union([z.number().int(), z.string()])
    .nullable()
    .optional(),
  unit_price_cents: z
    .union([z.number().int(), z.string()])
    .nullable()
    .optional(),
  line_total_cents: z
    .union([z.number().int(), z.string()])
    .nullable()
    .optional(),
});
export type PortalQuoteLineItem = z.infer<typeof PortalQuoteLineItemSchema>;

const PortalQuoteDetailSchema = z.object({
  quote: z.object({
    id: z.string().uuid(),
    number: z.string(),
    state: z.string(),
    sent_at: z.string().nullable(),
    submitted_at: z.string().nullable(),
    expiration_date: z.string().nullable(),
    subtotal_cents: z.union([z.number().int(), z.string()]),
    tax_cents: z.union([z.number().int(), z.string()]),
    total_cents: z.union([z.number().int(), z.string()]),
    currency_code: z.string(),
  }),
  line_items: z.array(PortalQuoteLineItemSchema),
  customer_display_name: z.string(),
});
export type PortalQuoteDetail = z.infer<typeof PortalQuoteDetailSchema>;

export async function getPortalQuote(id: string): Promise<PortalQuoteDetail> {
  const data = await apiRequest<unknown>(
    `/customer-portal-api/portal/quotes/${encodeURIComponent(id)}`,
    { method: 'GET' },
  );
  return PortalQuoteDetailSchema.parse(data);
}
