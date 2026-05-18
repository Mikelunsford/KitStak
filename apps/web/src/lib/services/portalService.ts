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

const PortalInvoicesSchema = z.object({ items: z.array(PortalInvoiceSummarySchema) });

export async function listPortalInvoices(): Promise<PortalInvoiceSummary[]> {
  const data = await apiRequest<unknown>('/customer-portal-api/portal/invoices', {
    method: 'GET',
  });
  return PortalInvoicesSchema.parse(data).items;
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
const PortalQuotesSchema = z.object({ items: z.array(PortalQuoteSchema) });

export async function listPortalQuotes(): Promise<PortalQuote[]> {
  const data = await apiRequest<unknown>('/customer-portal-api/portal/quotes', {
    method: 'GET',
  });
  return PortalQuotesSchema.parse(data).items;
}

const PortalProjectSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  status: z.string(),
  started_at: z.string().nullable(),
  expected_completion_at: z.string().nullable(),
});
export type PortalProject = z.infer<typeof PortalProjectSchema>;
const PortalProjectsSchema = z.object({ items: z.array(PortalProjectSchema) });

export async function listPortalProjects(): Promise<PortalProject[]> {
  const data = await apiRequest<unknown>('/customer-portal-api/portal/projects', {
    method: 'GET',
  });
  return PortalProjectsSchema.parse(data).items;
}

const PortalAttachmentSchema = z.object({
  id: z.string().uuid(),
  file_name: z.string(),
  content_type: z.string().nullable(),
  size_bytes: z.union([z.number().int(), z.string().regex(/^-?\d+$/)]),
  created_at: z.string(),
  storage_path: z.string(),
});
export type PortalAttachment = z.infer<typeof PortalAttachmentSchema>;
const PortalAttachmentsSchema = z.object({ items: z.array(PortalAttachmentSchema) });

export async function listPortalAttachments(
  entityType: string,
  entityId: string,
): Promise<PortalAttachment[]> {
  const data = await apiRequest<unknown>(
    `/customer-portal-api/portal/attachments?entity_type=${encodeURIComponent(entityType)}&entity_id=${encodeURIComponent(entityId)}`,
    { method: 'GET' },
  );
  return PortalAttachmentsSchema.parse(data).items;
}
