import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { bucketCents, track } from '@/lib/analytics';
import { paymentKeys } from '@/lib/queryKeys/payments';
import { invoiceKeys } from '@/lib/queryKeys/invoices';
import {
  applyPayment,
  createPayment,
  deletePayment,
  getPayment,
  listPayments,
  updatePayment,
  type ListPaymentsFilters,
  type PaymentApplyBody,
  type PaymentCreate,
  type PaymentPatch,
} from '@/lib/services/paymentsService';

export function usePayments(filters: ListPaymentsFilters = {}) {
  return useQuery({
    queryKey: paymentKeys.list(filters),
    queryFn: () => listPayments(filters),
    staleTime: 30_000,
  });
}

export function usePayment(id: string) {
  return useQuery({
    queryKey: paymentKeys.detail(id),
    queryFn: () => getPayment(id),
    enabled: Boolean(id),
    staleTime: 30_000,
  });
}

export function useCreatePayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: PaymentCreate) => createPayment(body),
    onSuccess: (payment) => {
      qc.invalidateQueries({ queryKey: paymentKeys.all });
      // F-Wave5-CO-02: emit the payment_received funnel event on
      // payment creation (the "Receive payment" UX action). The
      // invoice_id is nullable because a payment can be received as
      // unapplied cash and allocated to invoices later; amount is
      // bucketed so absolute dollar values never leak.
      track('payment_received', {
        payment_id: payment.id,
        // invoice_id is null at create-time: a payment may be received
        // as unapplied cash and allocated to invoices via useApplyPayment
        // later. The natural identifier here is payment_id.
        invoice_id: null,
        customer_id: payment.customer_id ?? null,
        amount_cents_bucket: bucketCents(payment.amount_cents),
      });
    },
  });
}

export function useUpdatePayment(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: PaymentPatch) => updatePayment(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: paymentKeys.detail(id) });
      qc.invalidateQueries({ queryKey: paymentKeys.all });
    },
  });
}

export function useDeletePayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deletePayment(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: paymentKeys.all }),
  });
}

export function useApplyPayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: PaymentApplyBody }) =>
      applyPayment(id, body),
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: paymentKeys.detail(id) });
      qc.invalidateQueries({ queryKey: paymentKeys.all });
      qc.invalidateQueries({ queryKey: invoiceKeys.all });
    },
  });
}
