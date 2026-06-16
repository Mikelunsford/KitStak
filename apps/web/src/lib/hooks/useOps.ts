import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { track } from '@/lib/analytics';
import { buildReceivingReceivedProps } from '@/lib/hooks/pillarAnalytics';
import { auditLogKeys } from '@/lib/queryKeys/auditLog';
import { transitionInvalidationKeys } from './transitionInvalidation';
import {
  receivingOrdersKeys, productionRunsKeys, shipmentsKeys,
} from '@/lib/queryKeys/ops';
import {
  listReceivingOrders, getReceivingOrder, createReceivingOrder, updateReceivingOrder,
  transitionReceivingOrder, receiveReceivingOrder,
  type ReceivingOrder,
  type ListReceivingOrdersFilters,
  type TransitionReceivingOrderBody,
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
  type ListShipmentsFilters,
} from '@/lib/services/shipmentsService';
import {
  listReceivingOrderLineItems, createReceivingOrderLineItem,
  updateReceivingOrderLineItem, deleteReceivingOrderLineItem,
  type ReceivingOrderLineItem,
  type ReceivingOrderLineItemCreate, type ReceivingOrderLineItemUpdate,
} from '@/lib/services/receivingOrderLineItemsService';
import {
  listShipmentLineItems, createShipmentLineItem,
  updateShipmentLineItem, deleteShipmentLineItem,
  type ShipmentLineItem,
  type ShipmentLineItemCreate, type ShipmentLineItemUpdate,
} from '@/lib/services/shipmentLineItemsService';

const C = { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 as const };

// receiving
export function useReceivingOrdersList(filters: ListReceivingOrdersFilters = {}) {
  return useQuery({
    queryKey: receivingOrdersKeys.list(filters),
    queryFn: () => listReceivingOrders(filters),
    ...C,
  });
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
    // WMS receiving-to-dock (F-Wave12-WMS-RECEIVE-DOCK-01): the transition input
    // is an object so the 'received' transition can carry the optional dock on
    // the same /transition POST. Non-received transitions pass { to } only.
    mutationFn: (input: TransitionReceivingOrderBody) => transitionReceivingOrder(id, input),
    onSuccess: (order, input) => {
      // R-W13-UX-01: invalidate the detail key explicitly (not only via the
      // `all` prefix) so the StateStepper, action buttons, and totals on the
      // detail page refresh the instant the transition succeeds. The shared
      // transitionInvalidationKeys contract sweeps the detail key, the entity
      // tree, and the audit timeline (trg_audit_receiving_orders_state).
      for (const queryKey of transitionInvalidationKeys(receivingOrdersKeys, 'receiving_order', id)) {
        void qc.invalidateQueries({ queryKey });
      }
      // R-W13-OBS-01: emit the WMS receiving funnel event on the
      // receive-to-dock transition only. has_dock reports whether a dock
      // location rode the same transition (boolean, never the bin id);
      // line_count is omitted here (the transition body carries no lines).
      if (input.to === 'received') {
        track(
          'receiving_received',
          buildReceivingReceivedProps(
            order.id,
            order.status,
            Boolean(input.dock_location_id),
            0,
          ),
        );
      }
    },
  });
}
export function useReceiveReceivingOrder(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { received_date?: string; lines: Array<{ item_id: string; quantity: number; unit_cost_cents?: number }> }) =>
      receiveReceivingOrder(id, input),
    onSuccess: (order, input) => {
      // R-W13-UX-01: the receive RPC flips status -> received; invalidate the
      // detail key explicitly so the stepper and totals update without reload.
      // The shared transitionInvalidationKeys contract sweeps the detail key,
      // the entity tree, and the audit timeline (draft -> received writes a row).
      for (const queryKey of transitionInvalidationKeys(receivingOrdersKeys, 'receiving_order', id)) {
        void qc.invalidateQueries({ queryKey });
      }
      // R-W13-OBS-01: emit the WMS receiving funnel event on the receive RPC.
      // line_count is the count of received lines (not their item names or
      // amounts); the receive RPC carries no dock so has_dock is false here.
      track(
        'receiving_received',
        buildReceivingReceivedProps(order.id, order.status, false, input.lines.length),
      );
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
export function useShipmentsList(filters: ListShipmentsFilters = {}) {
  return useQuery({
    queryKey: shipmentsKeys.list(filters),
    queryFn: () => listShipments(filters),
    ...C,
  });
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

// receiving order line items (F-Wave7-LINES-01)
const receivingLineItemsKey = (receivingOrderId: string) =>
  [...receivingOrdersKeys.detail(receivingOrderId), 'line-items'] as const;

export function useReceivingOrderLineItems(receivingOrderId: string | undefined) {
  return useQuery({
    queryKey: receivingOrderId
      ? receivingLineItemsKey(receivingOrderId)
      : ['ops', 'receiving_orders', 'detail', '__none__', 'line-items'],
    queryFn: () => listReceivingOrderLineItems(receivingOrderId as string),
    enabled: !!receivingOrderId,
    ...C,
  });
}

export function useCreateReceivingOrderLineItem(receivingOrderId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ReceivingOrderLineItemCreate) =>
      createReceivingOrderLineItem(receivingOrderId, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: receivingLineItemsKey(receivingOrderId) });
      void qc.invalidateQueries({ queryKey: receivingOrdersKeys.detail(receivingOrderId) });
      // F-Wave7-AUDIT-CACHE-SWEEP-01 + F-Wave7-LINES-DUAL-WRITE-DROP-01:
      // the parent's payload.lines dual-write was retired with the step 2
      // trigger redirect, so line-item create no longer produces a parent
      // UPDATE row in audit_log. The invalidation is kept as a defensive
      // sweep for future audit hooks on the line-item tables themselves.
      void qc.invalidateQueries({ queryKey: auditLogKeys.byEntity('receiving_order', receivingOrderId) });
    },
  });
}

export function useUpdateReceivingOrderLineItem(receivingOrderId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { lineId: string; body: ReceivingOrderLineItemUpdate }) =>
      updateReceivingOrderLineItem(receivingOrderId, args.lineId, args.body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: receivingLineItemsKey(receivingOrderId) });
      void qc.invalidateQueries({ queryKey: receivingOrdersKeys.detail(receivingOrderId) });
      void qc.invalidateQueries({ queryKey: auditLogKeys.byEntity('receiving_order', receivingOrderId) });
    },
  });
}

export function useDeleteReceivingOrderLineItem(receivingOrderId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (lineId: string) =>
      deleteReceivingOrderLineItem(receivingOrderId, lineId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: receivingLineItemsKey(receivingOrderId) });
      void qc.invalidateQueries({ queryKey: receivingOrdersKeys.detail(receivingOrderId) });
      void qc.invalidateQueries({ queryKey: auditLogKeys.byEntity('receiving_order', receivingOrderId) });
    },
  });
}

// shipment line items (F-Wave7-LINES-01)
const shipmentLineItemsKey = (shipmentId: string) =>
  [...shipmentsKeys.detail(shipmentId), 'line-items'] as const;

export function useShipmentLineItems(shipmentId: string | undefined) {
  return useQuery({
    queryKey: shipmentId
      ? shipmentLineItemsKey(shipmentId)
      : ['ops', 'shipments', 'detail', '__none__', 'line-items'],
    queryFn: () => listShipmentLineItems(shipmentId as string),
    enabled: !!shipmentId,
    ...C,
  });
}

export function useCreateShipmentLineItem(shipmentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ShipmentLineItemCreate) =>
      createShipmentLineItem(shipmentId, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: shipmentLineItemsKey(shipmentId) });
      void qc.invalidateQueries({ queryKey: shipmentsKeys.detail(shipmentId) });
      void qc.invalidateQueries({ queryKey: auditLogKeys.byEntity('shipment', shipmentId) });
    },
  });
}

export function useUpdateShipmentLineItem(shipmentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { lineId: string; body: ShipmentLineItemUpdate }) =>
      updateShipmentLineItem(shipmentId, args.lineId, args.body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: shipmentLineItemsKey(shipmentId) });
      void qc.invalidateQueries({ queryKey: shipmentsKeys.detail(shipmentId) });
      void qc.invalidateQueries({ queryKey: auditLogKeys.byEntity('shipment', shipmentId) });
    },
  });
}

export function useDeleteShipmentLineItem(shipmentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (lineId: string) =>
      deleteShipmentLineItem(shipmentId, lineId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: shipmentLineItemsKey(shipmentId) });
      void qc.invalidateQueries({ queryKey: shipmentsKeys.detail(shipmentId) });
      void qc.invalidateQueries({ queryKey: auditLogKeys.byEntity('shipment', shipmentId) });
    },
  });
}

// Re-export types so consumer pages can import everything from useOps.
export type {
  ReceivingOrderLineItem, ReceivingOrderLineItemCreate, ReceivingOrderLineItemUpdate,
  ShipmentLineItem, ShipmentLineItemCreate, ShipmentLineItemUpdate,
};
