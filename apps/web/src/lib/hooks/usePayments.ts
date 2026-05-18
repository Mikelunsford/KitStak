import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

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
    onSuccess: () => qc.invalidateQueries({ queryKey: paymentKeys.all }),
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
