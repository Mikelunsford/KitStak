// Co-Pack and Ecom TanStack Query hooks. Pillar 3.
//
// Mirrors the useManufacturing.ts canon:
//   - C = { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 } per the
//     SPA constitution defaults.
//   - Every state-changing mutation invalidates the relevant entity keys AND
//     auditLogKeys.byEntity(entityType, id). The DB writes audit_log rows on
//     state transitions; SPA must invalidate the timeline so the operator sees
//     the entry without refresh.
//   - Mutation hooks return the `mutation` object (callers use mutation.error
//     for inline rendering).
//
// Three parents carry state machines (sales_orders, kitting_jobs,
// fulfillments); sales_channels is a flat library.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { auditLogKeys } from '@/lib/queryKeys/auditLog';
import {
  salesChannelsKeys,
  coPackWarehousesKeys,
  salesOrdersKeys,
  kittingJobsKeys,
  fulfillmentsKeys,
} from '@/lib/queryKeys/copack';
import {
  listSalesChannels, createSalesChannel, updateSalesChannel,
  listSalesOrders, getSalesOrder, createSalesOrder, updateSalesOrder,
  deleteSalesOrder, confirmSalesOrder, cancelSalesOrder,
  listSalesOrderLines, createSalesOrderLine, updateSalesOrderLine,
  deleteSalesOrderLine,
  listKittingJobs, getKittingJob, createKittingJob, updateKittingJob,
  deleteKittingJob, startKittingJob, completeKittingJob, cancelKittingJob,
  listKittingConsumedLines, createKittingConsumedLine, updateKittingConsumedLine,
  deleteKittingConsumedLine,
  listKittingProducedLines, createKittingProducedLine, updateKittingProducedLine,
  deleteKittingProducedLine,
  listFulfillments, getFulfillment, createFulfillment,
  pickFulfillment, packFulfillment, shipFulfillment, cancelFulfillment,
  listCoPackWarehouses,
  type ListSalesOrdersFilters,
  type SalesChannelCreate,
  type SalesChannelPatch,
  type SalesOrderCreate,
  type SalesOrderPatch,
  type SalesOrderLineItemCreate,
  type SalesOrderLineItemUpdate,
  type ListKittingJobsFilters,
  type KittingJobCreate,
  type KittingJobPatch,
  type KittingJobConsumedLineItemCreate,
  type KittingJobConsumedLineItemUpdate,
  type KittingJobProducedLineItemCreate,
  type KittingJobProducedLineItemUpdate,
  type ListFulfillmentsFilters,
  type FulfillmentCreate,
} from '@/lib/services/copackService';

const C = { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 as const };

// ===========================================================================
// warehouses (read-only, Co-Pack scoped). F-Wave10-CKSMOKE-04. Lets the
// kitting / fulfillment pickers list warehouses without the 3PL-gated
// inventory-api.
// ===========================================================================

export function useCoPackWarehousesList() {
  return useQuery({
    queryKey: coPackWarehousesKeys.list(),
    queryFn: () => listCoPackWarehouses(),
    ...C,
  });
}

// ===========================================================================
// sales_channels (library)
// ===========================================================================

export function useSalesChannelsList() {
  return useQuery({
    queryKey: salesChannelsKeys.list(),
    queryFn: () => listSalesChannels(),
    ...C,
  });
}

export function useCreateSalesChannel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SalesChannelCreate) => createSalesChannel(input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: salesChannelsKeys.all });
    },
  });
}

export function useUpdateSalesChannel(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SalesChannelPatch) => updateSalesChannel(id, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: salesChannelsKeys.all });
      void qc.invalidateQueries({ queryKey: auditLogKeys.byEntity('sales_channel', id) });
    },
  });
}

// ===========================================================================
// sales_orders (parent, state machine)
// ===========================================================================

export function useSalesOrdersList(filters: ListSalesOrdersFilters = {}) {
  return useQuery({
    queryKey: salesOrdersKeys.list(filters),
    queryFn: () => listSalesOrders(filters),
    ...C,
  });
}

export function useSalesOrder(id: string | undefined) {
  return useQuery({
    queryKey: id
      ? salesOrdersKeys.detail(id)
      : ['copack', 'sales-orders', 'detail', 'noop'],
    queryFn: () => getSalesOrder(id as string),
    enabled: !!id,
    ...C,
  });
}

export function useCreateSalesOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SalesOrderCreate) => createSalesOrder(input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: salesOrdersKeys.all });
    },
  });
}

export function useUpdateSalesOrder(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SalesOrderPatch) => updateSalesOrder(id, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: salesOrdersKeys.all });
      void qc.invalidateQueries({ queryKey: auditLogKeys.byEntity('sales_order', id) });
    },
  });
}

export function useDeleteSalesOrder(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => deleteSalesOrder(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: salesOrdersKeys.all });
      void qc.invalidateQueries({ queryKey: auditLogKeys.byEntity('sales_order', id) });
    },
  });
}

export function useConfirmSalesOrder(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => confirmSalesOrder(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: salesOrdersKeys.all });
      void qc.invalidateQueries({ queryKey: auditLogKeys.byEntity('sales_order', id) });
    },
  });
}

export function useCancelSalesOrder(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => cancelSalesOrder(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: salesOrdersKeys.all });
      void qc.invalidateQueries({ queryKey: auditLogKeys.byEntity('sales_order', id) });
    },
  });
}

// --- order line items ---

export function useSalesOrderLines(orderId: string | undefined) {
  return useQuery({
    queryKey: orderId
      ? salesOrdersKeys.lines(orderId)
      : ['copack', 'sales-orders', 'detail', '__none__', 'lines'],
    queryFn: () => listSalesOrderLines(orderId as string),
    enabled: !!orderId,
    ...C,
  });
}

export function useAddSalesOrderLine(orderId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SalesOrderLineItemCreate) => createSalesOrderLine(orderId, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: salesOrdersKeys.lines(orderId) });
      void qc.invalidateQueries({ queryKey: salesOrdersKeys.detail(orderId) });
      void qc.invalidateQueries({ queryKey: auditLogKeys.byEntity('sales_order', orderId) });
    },
  });
}

export function useUpdateSalesOrderLine(orderId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { lineId: string; body: SalesOrderLineItemUpdate }) =>
      updateSalesOrderLine(orderId, args.lineId, args.body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: salesOrdersKeys.lines(orderId) });
      void qc.invalidateQueries({ queryKey: salesOrdersKeys.detail(orderId) });
      void qc.invalidateQueries({ queryKey: auditLogKeys.byEntity('sales_order', orderId) });
    },
  });
}

export function useDeleteSalesOrderLine(orderId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (lineId: string) => deleteSalesOrderLine(orderId, lineId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: salesOrdersKeys.lines(orderId) });
      void qc.invalidateQueries({ queryKey: salesOrdersKeys.detail(orderId) });
      void qc.invalidateQueries({ queryKey: auditLogKeys.byEntity('sales_order', orderId) });
    },
  });
}

// ===========================================================================
// kitting_jobs (parent, state machine)
// ===========================================================================

export function useKittingJobsList(filters: ListKittingJobsFilters = {}) {
  return useQuery({
    queryKey: kittingJobsKeys.list(filters),
    queryFn: () => listKittingJobs(filters),
    ...C,
  });
}

export function useKittingJob(id: string | undefined) {
  return useQuery({
    queryKey: id
      ? kittingJobsKeys.detail(id)
      : ['copack', 'kitting-jobs', 'detail', 'noop'],
    queryFn: () => getKittingJob(id as string),
    enabled: !!id,
    ...C,
  });
}

export function useCreateKittingJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: KittingJobCreate) => createKittingJob(input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: kittingJobsKeys.all });
    },
  });
}

export function useUpdateKittingJob(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: KittingJobPatch) => updateKittingJob(id, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: kittingJobsKeys.all });
      void qc.invalidateQueries({ queryKey: auditLogKeys.byEntity('kitting_job', id) });
    },
  });
}

export function useDeleteKittingJob(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => deleteKittingJob(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: kittingJobsKeys.all });
      void qc.invalidateQueries({ queryKey: auditLogKeys.byEntity('kitting_job', id) });
    },
  });
}

export function useStartKittingJob(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => startKittingJob(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: kittingJobsKeys.all });
      void qc.invalidateQueries({ queryKey: auditLogKeys.byEntity('kitting_job', id) });
    },
  });
}

export function useCompleteKittingJob(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => completeKittingJob(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: kittingJobsKeys.all });
      void qc.invalidateQueries({ queryKey: auditLogKeys.byEntity('kitting_job', id) });
    },
  });
}

export function useCancelKittingJob(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => cancelKittingJob(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: kittingJobsKeys.all });
      void qc.invalidateQueries({ queryKey: auditLogKeys.byEntity('kitting_job', id) });
    },
  });
}

// --- consumed line items ---

export function useKittingConsumedLines(jobId: string | undefined) {
  return useQuery({
    queryKey: jobId
      ? kittingJobsKeys.consumed(jobId)
      : ['copack', 'kitting-jobs', 'detail', '__none__', 'consumed'],
    queryFn: () => listKittingConsumedLines(jobId as string),
    enabled: !!jobId,
    ...C,
  });
}

export function useAddKittingConsumedLine(jobId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: KittingJobConsumedLineItemCreate) =>
      createKittingConsumedLine(jobId, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: kittingJobsKeys.consumed(jobId) });
      void qc.invalidateQueries({ queryKey: kittingJobsKeys.detail(jobId) });
      void qc.invalidateQueries({ queryKey: auditLogKeys.byEntity('kitting_job', jobId) });
    },
  });
}

export function useUpdateKittingConsumedLine(jobId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { lineId: string; body: KittingJobConsumedLineItemUpdate }) =>
      updateKittingConsumedLine(jobId, args.lineId, args.body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: kittingJobsKeys.consumed(jobId) });
      void qc.invalidateQueries({ queryKey: kittingJobsKeys.detail(jobId) });
      void qc.invalidateQueries({ queryKey: auditLogKeys.byEntity('kitting_job', jobId) });
    },
  });
}

export function useDeleteKittingConsumedLine(jobId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (lineId: string) => deleteKittingConsumedLine(jobId, lineId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: kittingJobsKeys.consumed(jobId) });
      void qc.invalidateQueries({ queryKey: kittingJobsKeys.detail(jobId) });
      void qc.invalidateQueries({ queryKey: auditLogKeys.byEntity('kitting_job', jobId) });
    },
  });
}

// --- produced line items ---

export function useKittingProducedLines(jobId: string | undefined) {
  return useQuery({
    queryKey: jobId
      ? kittingJobsKeys.produced(jobId)
      : ['copack', 'kitting-jobs', 'detail', '__none__', 'produced'],
    queryFn: () => listKittingProducedLines(jobId as string),
    enabled: !!jobId,
    ...C,
  });
}

export function useAddKittingProducedLine(jobId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: KittingJobProducedLineItemCreate) =>
      createKittingProducedLine(jobId, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: kittingJobsKeys.produced(jobId) });
      void qc.invalidateQueries({ queryKey: kittingJobsKeys.detail(jobId) });
      void qc.invalidateQueries({ queryKey: auditLogKeys.byEntity('kitting_job', jobId) });
    },
  });
}

export function useUpdateKittingProducedLine(jobId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { lineId: string; body: KittingJobProducedLineItemUpdate }) =>
      updateKittingProducedLine(jobId, args.lineId, args.body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: kittingJobsKeys.produced(jobId) });
      void qc.invalidateQueries({ queryKey: kittingJobsKeys.detail(jobId) });
      void qc.invalidateQueries({ queryKey: auditLogKeys.byEntity('kitting_job', jobId) });
    },
  });
}

export function useDeleteKittingProducedLine(jobId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (lineId: string) => deleteKittingProducedLine(jobId, lineId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: kittingJobsKeys.produced(jobId) });
      void qc.invalidateQueries({ queryKey: kittingJobsKeys.detail(jobId) });
      void qc.invalidateQueries({ queryKey: auditLogKeys.byEntity('kitting_job', jobId) });
    },
  });
}

// ===========================================================================
// fulfillments (parent, state machine)
// ===========================================================================

export function useFulfillmentsList(filters: ListFulfillmentsFilters = {}) {
  return useQuery({
    queryKey: fulfillmentsKeys.list(filters),
    queryFn: () => listFulfillments(filters),
    ...C,
  });
}

export function useFulfillment(id: string | undefined) {
  return useQuery({
    queryKey: id
      ? fulfillmentsKeys.detail(id)
      : ['copack', 'fulfillments', 'detail', 'noop'],
    queryFn: () => getFulfillment(id as string),
    enabled: !!id,
    ...C,
  });
}

export function useCreateFulfillment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: FulfillmentCreate) => createFulfillment(input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: fulfillmentsKeys.all });
    },
  });
}

export function usePickFulfillment(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => pickFulfillment(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: fulfillmentsKeys.all });
      void qc.invalidateQueries({ queryKey: auditLogKeys.byEntity('fulfillment', id) });
    },
  });
}

export function usePackFulfillment(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => packFulfillment(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: fulfillmentsKeys.all });
      void qc.invalidateQueries({ queryKey: auditLogKeys.byEntity('fulfillment', id) });
    },
  });
}

export function useShipFulfillment(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => shipFulfillment(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: fulfillmentsKeys.all });
      void qc.invalidateQueries({ queryKey: auditLogKeys.byEntity('fulfillment', id) });
    },
  });
}

export function useCancelFulfillment(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => cancelFulfillment(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: fulfillmentsKeys.all });
      void qc.invalidateQueries({ queryKey: auditLogKeys.byEntity('fulfillment', id) });
    },
  });
}
