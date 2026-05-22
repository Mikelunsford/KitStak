/**
 * Payments service. Wraps invoicing-api/payments.
 */

import { z } from 'zod';

import { apiRequest } from '@/lib/apiClient';
import {
  PaymentAllocationSchema,
  PaymentSchema,
  type Payment,
  type PaymentAllocation,
} from '@/lib/types/finance';

const PaymentListSchema = z.array(PaymentSchema);
const AllocationListSchema = z.array(PaymentAllocationSchema);

// B8 completion (v2 smoke 2026-05-22): payment_number is optional. The
// handler allocates the next PMT-YYYY-NNNNN via the numbering chassis when
// the field is absent. Operator-supplied values still win. Mirrors the
// invoice / quote / receiving / shipment shape landed at PR-B (#117) and
// PR #105.
export type PaymentCreate = {
  payment_number?: string;
  customer_id?: string;
  amount_cents: number | string;
  currency_code?: string;
  payment_method?: string;
  reference_number?: string;
  received_at?: string;
  notes?: string;
};

export type PaymentPatch = Partial<PaymentCreate>;

export type PaymentApplyBody = {
  allocations: Array<{ invoice_id: string; amount_cents: number | string }>;
};

export type ListPaymentsFilters = {
  customer_id?: string;
  // BNEW-12: invoice_id filter scopes the list to payments that have at
  // least one allocation against this invoice. Backed by a server-side
  // join over payment_allocations (RLS Pattern B). Used by
  // InvoiceDetailPage's PAYMENTS section so a brand-new invoice with
  // zero allocations renders an empty section even when the customer
  // has payments against other invoices.
  invoice_id?: string;
  cursor?: string;
  limit?: number;
};

function qs(f: ListPaymentsFilters): string {
  const p = new URLSearchParams();
  if (f.customer_id) p.set('customer_id', f.customer_id);
  if (f.invoice_id) p.set('invoice_id', f.invoice_id);
  if (f.cursor) p.set('cursor', f.cursor);
  if (f.limit !== undefined) p.set('limit', String(f.limit));
  const s = p.toString();
  return s ? `?${s}` : '';
}

export async function listPayments(
  filters: ListPaymentsFilters = {},
): Promise<Payment[]> {
  const data = await apiRequest<unknown>(`/invoicing-api/payments${qs(filters)}`, {
    method: 'GET',
  });
  return PaymentListSchema.parse(data);
}

export async function getPayment(id: string): Promise<Payment> {
  const data = await apiRequest<unknown>(`/invoicing-api/payments/${id}`, {
    method: 'GET',
  });
  return PaymentSchema.parse(data);
}

export async function createPayment(body: PaymentCreate): Promise<Payment> {
  const data = await apiRequest<unknown>(`/invoicing-api/payments`, {
    method: 'POST',
    body,
  });
  return PaymentSchema.parse(data);
}

export async function updatePayment(
  id: string,
  body: PaymentPatch,
): Promise<Payment> {
  const data = await apiRequest<unknown>(`/invoicing-api/payments/${id}`, {
    method: 'PATCH',
    body,
  });
  return PaymentSchema.parse(data);
}

export async function deletePayment(id: string): Promise<void> {
  await apiRequest<unknown>(`/invoicing-api/payments/${id}`, { method: 'DELETE' });
}

export async function applyPayment(
  id: string,
  body: PaymentApplyBody,
): Promise<PaymentAllocation[]> {
  const data = await apiRequest<unknown>(`/invoicing-api/payments/${id}/apply`, {
    method: 'POST',
    body,
  });
  return AllocationListSchema.parse(data);
}
