import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { vendorBillsKeys } from '@/lib/queryKeys/vendorBills';
import {
  listVendorBills, getVendorBill, createVendorBill, updateVendorBill,
  transitionVendorBill,
  type VendorBill, type VendorBillStatus,
} from '@/lib/services/vendorBillsService';
import {
  listVendorBillPayments, createVendorBillPayment,
  type VendorBillPayment,
} from '@/lib/services/vendorBillPaymentsService';

const C = { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 as const };

export function useVendorBillsList() {
  return useQuery({ queryKey: vendorBillsKeys.list(), queryFn: listVendorBills, ...C });
}

export function useVendorBill(id: string | undefined) {
  return useQuery({
    queryKey: id ? vendorBillsKeys.detail(id) : ['vendors', 'vendor_bills', 'detail', 'noop'],
    queryFn: () => getVendorBill(id as string),
    enabled: !!id,
    ...C,
  });
}

export function useVendorBillPayments(id: string | undefined) {
  return useQuery({
    queryKey: id ? vendorBillsKeys.payments(id) : ['vendors', 'vendor_bills', 'payments', 'noop'],
    queryFn: () => listVendorBillPayments(id as string),
    enabled: !!id,
    ...C,
  });
}

export function useCreateVendorBill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<VendorBill>) => createVendorBill(input),
    onSuccess: () => { qc.invalidateQueries({ queryKey: vendorBillsKeys.all }); },
  });
}

export function useUpdateVendorBill(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<VendorBill>) => updateVendorBill(id, input),
    onSuccess: () => { qc.invalidateQueries({ queryKey: vendorBillsKeys.all }); },
  });
}

export function useTransitionVendorBill(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (to: VendorBillStatus) => transitionVendorBill(id, to),
    onSuccess: () => { qc.invalidateQueries({ queryKey: vendorBillsKeys.all }); },
  });
}

export function useCreateVendorBillPayment(billId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<VendorBillPayment>) => createVendorBillPayment(billId, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: vendorBillsKeys.payments(billId) });
      qc.invalidateQueries({ queryKey: vendorBillsKeys.detail(billId) });
    },
  });
}
