/**
 * Invoice line items service. Pattern B parent under /invoices.
 */

import { z } from 'zod';

import { apiRequest } from '@/lib/apiClient';
import {
  InvoiceLineItemSchema,
  type InvoiceLineItem,
} from '@/lib/types/finance';

const LineListSchema = z.array(InvoiceLineItemSchema);

export type InvoiceLineCreate = {
  description: string;
  quantity?: number | string;
  unit_price_cents: number | string;
  tax_rate_snapshot?: number | string;
  tax_amount_cents?: number | string;
  discount_cents?: number | string;
  line_total_cents: number | string;
  item_id?: string;
  sort_order?: number;
};

export type InvoiceLinePatch = Partial<InvoiceLineCreate>;

export async function listInvoiceLineItems(
  invoiceId: string,
): Promise<InvoiceLineItem[]> {
  const data = await apiRequest<unknown>(
    `/invoicing-api/invoices/${invoiceId}/line-items`,
    { method: 'GET' },
  );
  return LineListSchema.parse(data);
}

export async function createInvoiceLineItem(
  invoiceId: string,
  body: InvoiceLineCreate,
): Promise<InvoiceLineItem> {
  const data = await apiRequest<unknown>(
    `/invoicing-api/invoices/${invoiceId}/line-items`,
    { method: 'POST', body },
  );
  return InvoiceLineItemSchema.parse(data);
}

export async function updateInvoiceLineItem(
  lineId: string,
  body: InvoiceLinePatch,
): Promise<InvoiceLineItem> {
  const data = await apiRequest<unknown>(
    `/invoicing-api/invoice-line-items/${lineId}`,
    { method: 'PATCH', body },
  );
  return InvoiceLineItemSchema.parse(data);
}

export async function deleteInvoiceLineItem(lineId: string): Promise<void> {
  await apiRequest<unknown>(`/invoicing-api/invoice-line-items/${lineId}`, {
    method: 'DELETE',
  });
}
