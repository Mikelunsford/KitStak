import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { invoiceKeys } from '@/lib/queryKeys/invoices';
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
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: invoiceKeys.detail(id) });
      qc.invalidateQueries({ queryKey: invoiceKeys.all });
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
