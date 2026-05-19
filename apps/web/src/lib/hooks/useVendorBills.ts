import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { auditLogKeys } from '@/lib/queryKeys/auditLog';
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: vendorBillsKeys.all });
      // F-Wave7-AUDIT-CACHE-SWEEP-01: vendor bill updates write an audit
      // row; invalidate the timeline so the detail page reflects the
      // latest entries.
      void qc.invalidateQueries({ queryKey: auditLogKeys.byEntity('vendor_bill', id) });
    },
  });
}

export function useTransitionVendorBill(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (to: VendorBillStatus) => transitionVendorBill(id, to),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: vendorBillsKeys.all });
      // F-Wave7-AUDIT-CACHE-SWEEP-01: vendor bill transitions write an
      // audit_log row via trg_audit_vendor_bills_state; invalidate the
      // timeline so the operator sees the new entry.
      void qc.invalidateQueries({ queryKey: auditLogKeys.byEntity('vendor_bill', id) });
    },
  });
}

export function useCreateVendorBillPayment(billId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<VendorBillPayment>) => createVendorBillPayment(billId, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: vendorBillsKeys.payments(billId) });
      qc.invalidateQueries({ queryKey: vendorBillsKeys.detail(billId) });
      // F-Wave7-AUDIT-CACHE-SWEEP-01: recording a bill payment can drive a
      // partial -> paid transition that writes an audit row on the bill;
      // invalidate the bill timeline so the operator sees the entry.
      void qc.invalidateQueries({ queryKey: auditLogKeys.byEntity('vendor_bill', billId) });
    },
  });
}
