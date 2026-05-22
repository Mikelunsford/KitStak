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

import { applyPaymentInvalidationKeys } from './paymentInvalidation';

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
      // BNEW-10: invalidate both the payments tree AND the invoice tree
      // so the invoice detail page's PAYMENTS section refetches after
      // the operator receives a payment. Without this, the list query
      // keyed by `{ customer_id }` would serve stale cached data on the
      // next mount (staleTime is 30s on the SPA's default query options),
      // briefly rendering "No payments received from this customer yet."
      // even after partial_paid lights up on the invoice header.
      qc.invalidateQueries({ queryKey: paymentKeys.all });
      qc.invalidateQueries({ queryKey: invoiceKeys.all });
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
    onSuccess: (_data, { id, body }) => {
      // BNEW-10: invalidate the payment detail, the payment tree, the
      // invoice tree, AND per-invoice payment keys so the invoice
      // detail page's PAYMENTS section refetches immediately after the
      // operator receives + applies a payment. Without the per-invoice
      // entry, a navigate(`/invoicing/invoices/${invoiceId}`) right
      // after applyPayment resolves can briefly render the empty-state
      // copy while the customer-scoped list query is still serving
      // stale cache.
      for (const queryKey of applyPaymentInvalidationKeys(id, body)) {
        qc.invalidateQueries({ queryKey });
      }
    },
  });
}
