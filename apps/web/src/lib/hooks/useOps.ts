import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { auditLogKeys } from '@/lib/queryKeys/auditLog';
import {
  receivingOrdersKeys, productionRunsKeys, shipmentsKeys,
} from '@/lib/queryKeys/ops';
import {
  listReceivingOrders, getReceivingOrder, createReceivingOrder, updateReceivingOrder,
  transitionReceivingOrder, receiveReceivingOrder,
  type ReceivingOrder, type ReceivingOrderStatus,
} from '@/lib/services/receivingOrdersService';
import {
  listProductionRuns, getProductionRun, createProductionRun, updateProductionRun,
  startProductionRun, completeProductionRun,
  type ProductionRun, type CompleteRunInput,
} from '@/lib/services/productionRunsService';
import {
  listShipments, getShipment, createShipment, updateShipment, transitionShipment,
  shipShipment,
  type Shipment, type ShipmentStatus, type ShipShipmentInput,
} from '@/lib/services/shipmentsService';

const C = { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 as const };

// receiving
export function useReceivingOrdersList() {
  return useQuery({ queryKey: receivingOrdersKeys.list(), queryFn: listReceivingOrders, ...C });
}
export function useReceivingOrder(id: string | undefined) {
  return useQuery({
    queryKey: id ? receivingOrdersKeys.detail(id) : ['ops', 'receiving_orders', 'detail', 'noop'],
    queryFn: () => getReceivingOrder(id as string),
    enabled: !!id, ...C,
  });
}
export function useCreateReceivingOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<ReceivingOrder>) => createReceivingOrder(input),
    onSuccess: () => { qc.invalidateQueries({ queryKey: receivingOrdersKeys.all }); },
  });
}
export function useUpdateReceivingOrder(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<ReceivingOrder>) => updateReceivingOrder(id, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: receivingOrdersKeys.all });
      // F-Wave7-AUDIT-CACHE-SWEEP-01: receiving order updates write an
      // audit_log row; invalidate the timeline so the detail page reflects
      // the latest entries.
      void qc.invalidateQueries({ queryKey: auditLogKeys.byEntity('receiving_order', id) });
    },
  });
}
export function useTransitionReceivingOrder(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (to: ReceivingOrderStatus) => transitionReceivingOrder(id, to),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: receivingOrdersKeys.all });
      // F-Wave7-AUDIT-CACHE-SWEEP-01: receiving order transitions write an
      // audit_log row via trg_audit_receiving_orders_state; invalidate the
      // timeline so the operator sees the new entry.
      void qc.invalidateQueries({ queryKey: auditLogKeys.byEntity('receiving_order', id) });
    },
  });
}
export function useReceiveReceivingOrder(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { received_date?: string; lines: Array<{ item_id: string; quantity: number; unit_cost_cents?: number }> }) =>
      receiveReceivingOrder(id, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: receivingOrdersKeys.all });
      // F-Wave7-AUDIT-CACHE-SWEEP-01: receive RPC drives a draft -> received
      // transition that writes an audit row; invalidate the timeline so
      // the operator sees the entry.
      void qc.invalidateQueries({ queryKey: auditLogKeys.byEntity('receiving_order', id) });
    },
  });
}

// production
export function useProductionRunsList() {
  return useQuery({ queryKey: productionRunsKeys.list(), queryFn: listProductionRuns, ...C });
}
export function useProductionRun(id: string | undefined) {
  return useQuery({
    queryKey: id ? productionRunsKeys.detail(id) : ['ops', 'production_runs', 'detail', 'noop'],
    queryFn: () => getProductionRun(id as string),
    enabled: !!id, ...C,
  });
}
export function useCreateProductionRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<ProductionRun>) => createProductionRun(input),
    onSuccess: () => { qc.invalidateQueries({ queryKey: productionRunsKeys.all }); },
  });
}
export function useUpdateProductionRun(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<ProductionRun>) => updateProductionRun(id, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: productionRunsKeys.all });
      // F-Wave7-AUDIT-CACHE-SWEEP-01: production run updates write an
      // audit_log row; invalidate the timeline so the detail page
      // reflects the latest entries.
      void qc.invalidateQueries({ queryKey: auditLogKeys.byEntity('production_run', id) });
    },
  });
}
export function useStartProductionRun(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => startProductionRun(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: productionRunsKeys.all });
      // F-Wave7-AUDIT-CACHE-SWEEP-01: start drives a planned -> in_progress
      // transition that writes an audit row; invalidate the timeline so
      // the operator sees the entry.
      void qc.invalidateQueries({ queryKey: auditLogKeys.byEntity('production_run', id) });
    },
  });
}
export function useCompleteProductionRun(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CompleteRunInput) => completeProductionRun(id, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: productionRunsKeys.all });
      // F-Wave7-AUDIT-CACHE-SWEEP-01: complete drives an in_progress ->
      // completed transition that writes an audit row; invalidate the
      // timeline so the operator sees the entry.
      void qc.invalidateQueries({ queryKey: auditLogKeys.byEntity('production_run', id) });
    },
  });
}

// shipments
export function useShipmentsList() {
  return useQuery({ queryKey: shipmentsKeys.list(), queryFn: listShipments, ...C });
}
export function useShipment(id: string | undefined) {
  return useQuery({
    queryKey: id ? shipmentsKeys.detail(id) : ['ops', 'shipments', 'detail', 'noop'],
    queryFn: () => getShipment(id as string),
    enabled: !!id, ...C,
  });
}
export function useCreateShipment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<Shipment>) => createShipment(input),
    onSuccess: () => { qc.invalidateQueries({ queryKey: shipmentsKeys.all }); },
  });
}
export function useUpdateShipment(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<Shipment>) => updateShipment(id, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: shipmentsKeys.all });
      // F-Wave7-AUDIT-CACHE-SWEEP-01: shipment updates write an audit_log
      // row; invalidate the timeline so the detail page reflects the
      // latest entries.
      void qc.invalidateQueries({ queryKey: auditLogKeys.byEntity('shipment', id) });
    },
  });
}
export function useTransitionShipment(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (to: ShipmentStatus) => transitionShipment(id, to),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: shipmentsKeys.all });
      // F-Wave7-AUDIT-CACHE-SWEEP-01: shipment transitions write an
      // audit_log row via trg_audit_shipments_state; invalidate the
      // timeline so the operator sees the new entry.
      void qc.invalidateQueries({ queryKey: auditLogKeys.byEntity('shipment', id) });
    },
  });
}
export function useShipShipment(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ShipShipmentInput) => shipShipment(id, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: shipmentsKeys.all });
      // F-Wave7-AUDIT-CACHE-SWEEP-01: ship RPC drives a packed -> shipped
      // transition that writes an audit row; invalidate the timeline so
      // the operator sees the entry.
      void qc.invalidateQueries({ queryKey: auditLogKeys.byEntity('shipment', id) });
    },
  });
}
