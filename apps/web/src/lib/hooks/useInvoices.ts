import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { bucketCents, track } from '@/lib/analytics';
import { auditLogKeys } from '@/lib/queryKeys/auditLog';
import { invoiceKeys } from '@/lib/queryKeys/invoices';
import { buildTimeToSendInvoiceProps } from './timeToSendInvoice';
import {
  cancelInvoice,
  createInvoice,
  deleteInvoice,
  getInvoice,
  listInvoices,
  sendInvoice,
  transitionInvoice,
  updateInvoice,
  type InvoiceCreate,
  type InvoicePatch,
  type ListInvoicesFilters,
} from '@/lib/services/invoicesService';
import {
  createInvoiceLineItem,
  deleteInvoiceLineItem,
  listInvoiceLineItems,
  updateInvoiceLineItem,
  type InvoiceLineCreate,
  type InvoiceLinePatch,
} from '@/lib/services/invoiceLineItemsService';
import type { InvoiceStatusSchema } from '@/lib/types/finance';
import type { z } from 'zod';

export function useInvoices(filters: ListInvoicesFilters = {}) {
  return useQuery({
    queryKey: invoiceKeys.list(filters),
    queryFn: () => listInvoices(filters),
    staleTime: 30_000,
  });
}

export function useInvoice(id: string) {
  return useQuery({
    queryKey: invoiceKeys.detail(id),
    queryFn: () => getInvoice(id),
    enabled: Boolean(id),
    staleTime: 30_000,
  });
}

export function useInvoiceLineItems(invoiceId: string) {
  return useQuery({
    queryKey: invoiceKeys.lineItems(invoiceId),
    queryFn: () => listInvoiceLineItems(invoiceId),
    enabled: Boolean(invoiceId),
    staleTime: 30_000,
  });
}

export function useCreateInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: InvoiceCreate) => createInvoice(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: invoiceKeys.all }),
  });
}

export function useUpdateInvoice(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: InvoicePatch) => updateInvoice(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: invoiceKeys.detail(id) });
      qc.invalidateQueries({ queryKey: invoiceKeys.all });
      // F-Wave7-AUDIT-CACHE-SWEEP-01: invoice updates write an audit_log
      // row via the audit trigger; invalidate the timeline so the detail
      // page reflects the latest entries.
      void qc.invalidateQueries({ queryKey: auditLogKeys.byEntity('invoice', id) });
    },
  });
}

export function useDeleteInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteInvoice(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: invoiceKeys.all }),
  });
}

export function useSendInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => sendInvoice(id),
    onSuccess: (invoice, id) => {
      qc.invalidateQueries({ queryKey: invoiceKeys.detail(id) });
      qc.invalidateQueries({ queryKey: invoiceKeys.all });
      // F-Wave7-AUDIT-CACHE-SWEEP-01: invoice send writes an audit row;
      // invalidate the timeline so the operator sees the entry.
      void qc.invalidateQueries({ queryKey: auditLogKeys.byEntity('invoice', id) });
      // F-Wave5-CO-02: emit the invoice_sent funnel event. Total
      // amount is bucketed so absolute dollar values never leak.
      track('invoice_sent', {
        invoice_id: invoice.id,
        customer_id: invoice.customer_id ?? null,
        total_cents_bucket: bucketCents(invoice.total_cents),
      });
      // F-Wave9-AUDIT-V3-WAVE-F-01: emit the time_to_send_invoice
      // funnel event alongside invoice_sent. Properties: invoice_id,
      // created_at, sent_at, seconds_to_send. The payload builder
      // returns null seconds when either timestamp is missing or
      // unparseable so the funnel filter can drop pre-fix rows.
      track(
        'time_to_send_invoice',
        buildTimeToSendInvoiceProps(
          invoice.id,
          invoice.created_at ?? null,
          invoice.sent_at ?? null,
        ),
      );
    },
  });
}

export function useCancelInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => cancelInvoice(id),
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: invoiceKeys.detail(id) });
      qc.invalidateQueries({ queryKey: invoiceKeys.all });
      // F-Wave7-AUDIT-CACHE-SWEEP-01: invoice cancel writes an audit row;
      // invalidate the timeline so the operator sees the entry.
      void qc.invalidateQueries({ queryKey: auditLogKeys.byEntity('invoice', id) });
    },
  });
}

export function useTransitionInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, to }: { id: string; to: z.infer<typeof InvoiceStatusSchema> }) =>
      transitionInvoice(id, to),
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: invoiceKeys.detail(id) });
      qc.invalidateQueries({ queryKey: invoiceKeys.all });
      // F-Wave7-AUDIT-CACHE-SWEEP-01: invoice state transitions write an
      // audit row; invalidate the timeline so the operator sees the entry.
      void qc.invalidateQueries({ queryKey: auditLogKeys.byEntity('invoice', id) });
    },
  });
}

export function useCreateInvoiceLineItem(invoiceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: InvoiceLineCreate) => createInvoiceLineItem(invoiceId, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: invoiceKeys.lineItems(invoiceId) });
      qc.invalidateQueries({ queryKey: invoiceKeys.detail(invoiceId) });
    },
  });
}

export function useUpdateInvoiceLineItem(invoiceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ lineId, body }: { lineId: string; body: InvoiceLinePatch }) =>
      updateInvoiceLineItem(lineId, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: invoiceKeys.lineItems(invoiceId) });
      qc.invalidateQueries({ queryKey: invoiceKeys.detail(invoiceId) });
    },
  });
}

export function useDeleteInvoiceLineItem(invoiceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (lineId: string) => deleteInvoiceLineItem(lineId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: invoiceKeys.lineItems(invoiceId) });
      qc.invalidateQueries({ queryKey: invoiceKeys.detail(invoiceId) });
    },
  });
}
