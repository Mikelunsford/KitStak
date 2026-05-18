import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { purchaseOrdersKeys } from '@/lib/queryKeys/purchaseOrders';
import {
  listPurchaseOrders, getPurchaseOrder, createPurchaseOrder,
  updatePurchaseOrder, transitionPurchaseOrder,
  type PurchaseOrder, type PurchaseOrderStatus,
} from '@/lib/services/purchaseOrdersService';
import {
  listPoLineItems, createPoLineItem, updatePoLineItem, deletePoLineItem,
  type PoLineItem,
} from '@/lib/services/poLineItemsService';

const COMMON = { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 as const };

export function usePurchaseOrdersList() {
  return useQuery({ queryKey: purchaseOrdersKeys.list(), queryFn: listPurchaseOrders, ...COMMON });
}

export function usePurchaseOrder(id: string | undefined) {
  return useQuery({
    queryKey: id ? purchaseOrdersKeys.detail(id) : ['vendors', 'purchase_orders', 'detail', 'noop'],
    queryFn: () => getPurchaseOrder(id as string),
    enabled: !!id,
    ...COMMON,
  });
}

export function usePurchaseOrderLines(id: string | undefined) {
  return useQuery({
    queryKey: id ? purchaseOrdersKeys.lines(id) : ['vendors', 'purchase_orders', 'lines', 'noop'],
    queryFn: () => listPoLineItems(id as string),
    enabled: !!id,
    ...COMMON,
  });
}

export function useCreatePurchaseOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<PurchaseOrder>) => createPurchaseOrder(input),
    onSuccess: () => { qc.invalidateQueries({ queryKey: purchaseOrdersKeys.all }); },
  });
}

export function useUpdatePurchaseOrder(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<PurchaseOrder>) => updatePurchaseOrder(id, input),
    onSuccess: () => { qc.invalidateQueries({ queryKey: purchaseOrdersKeys.all }); },
  });
}

export function useTransitionPurchaseOrder(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (to: PurchaseOrderStatus) => transitionPurchaseOrder(id, to),
    onSuccess: () => { qc.invalidateQueries({ queryKey: purchaseOrdersKeys.all }); },
  });
}

export function useCreatePoLineItem(poId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<PoLineItem>) => createPoLineItem(poId, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: purchaseOrdersKeys.lines(poId) });
      qc.invalidateQueries({ queryKey: purchaseOrdersKeys.detail(poId) });
    },
  });
}

export function useUpdatePoLineItem(poId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { lineId: string; input: Partial<PoLineItem> }) =>
      updatePoLineItem(poId, vars.lineId, vars.input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: purchaseOrdersKeys.lines(poId) });
      qc.invalidateQueries({ queryKey: purchaseOrdersKeys.detail(poId) });
    },
  });
}

export function useDeletePoLineItem(poId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (lineId: string) => deletePoLineItem(poId, lineId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: purchaseOrdersKeys.lines(poId) });
      qc.invalidateQueries({ queryKey: purchaseOrdersKeys.detail(poId) });
    },
  });
}
