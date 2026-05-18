import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
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
    onSuccess: () => { qc.invalidateQueries({ queryKey: receivingOrdersKeys.all }); },
  });
}
export function useTransitionReceivingOrder(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (to: ReceivingOrderStatus) => transitionReceivingOrder(id, to),
    onSuccess: () => { qc.invalidateQueries({ queryKey: receivingOrdersKeys.all }); },
  });
}
export function useReceiveReceivingOrder(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { received_date?: string; lines: Array<{ item_id: string; quantity: number; unit_cost_cents?: number }> }) =>
      receiveReceivingOrder(id, input),
    onSuccess: () => { qc.invalidateQueries({ queryKey: receivingOrdersKeys.all }); },
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
    onSuccess: () => { qc.invalidateQueries({ queryKey: productionRunsKeys.all }); },
  });
}
export function useStartProductionRun(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => startProductionRun(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: productionRunsKeys.all }); },
  });
}
export function useCompleteProductionRun(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CompleteRunInput) => completeProductionRun(id, input),
    onSuccess: () => { qc.invalidateQueries({ queryKey: productionRunsKeys.all }); },
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
    onSuccess: () => { qc.invalidateQueries({ queryKey: shipmentsKeys.all }); },
  });
}
export function useTransitionShipment(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (to: ShipmentStatus) => transitionShipment(id, to),
    onSuccess: () => { qc.invalidateQueries({ queryKey: shipmentsKeys.all }); },
  });
}
export function useShipShipment(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ShipShipmentInput) => shipShipment(id, input),
    onSuccess: () => { qc.invalidateQueries({ queryKey: shipmentsKeys.all }); },
  });
}
