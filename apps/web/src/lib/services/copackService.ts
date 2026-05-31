// Co-Pack and Ecom service. Lives under bundle-gated copack-api. Pillar 3.
//
// The edge function bundle gates on plugins.copack_ecom and returns 404 for
// orgs that lack the flag (constitution rule: bundle gate off -> 404).
// The Idempotency-Key header is auto-injected by apiClient for non-GET.
//
// Three parents carry state machines (sales_orders, kitting_jobs,
// fulfillments); sales_channels is a flat library. Reads are RLS-only.

import { apiRequest } from '@/lib/apiClient';
import {
  SalesChannelSchema,
  SalesOrderSchema,
  SalesOrderLineItemSchema,
  KittingJobSchema,
  KittingJobConsumedLineItemSchema,
  KittingJobProducedLineItemSchema,
  FulfillmentSchema,
  type SalesChannel,
  type SalesChannelCreate,
  type SalesChannelPatch,
  type SalesOrder,
  type SalesOrderStatus,
  type SalesOrderCreate,
  type SalesOrderPatch,
  type SalesOrderLineItem,
  type SalesOrderLineItemCreate,
  type SalesOrderLineItemUpdate,
  type KittingJob,
  type KittingJobStatus,
  type KittingJobCreate,
  type KittingJobPatch,
  type KittingJobConsumedLineItem,
  type KittingJobConsumedLineItemCreate,
  type KittingJobConsumedLineItemUpdate,
  type KittingJobProducedLineItem,
  type KittingJobProducedLineItemCreate,
  type KittingJobProducedLineItemUpdate,
  type Fulfillment,
  type FulfillmentStatus,
  type FulfillmentCreate,
} from '@/lib/types/copack';

export type {
  SalesChannel,
  SalesChannelCreate,
  SalesChannelPatch,
  SalesOrder,
  SalesOrderStatus,
  SalesOrderCreate,
  SalesOrderPatch,
  SalesOrderLineItem,
  SalesOrderLineItemCreate,
  SalesOrderLineItemUpdate,
  KittingJob,
  KittingJobStatus,
  KittingJobCreate,
  KittingJobPatch,
  KittingJobConsumedLineItem,
  KittingJobConsumedLineItemCreate,
  KittingJobConsumedLineItemUpdate,
  KittingJobProducedLineItem,
  KittingJobProducedLineItemCreate,
  KittingJobProducedLineItemUpdate,
  Fulfillment,
  FulfillmentStatus,
  FulfillmentCreate,
};

const BASE = '/copack-api';

// ===========================================================================
// sales_channels (library)
// ===========================================================================

export async function listSalesChannels(): Promise<SalesChannel[]> {
  const data = await apiRequest<unknown>(`${BASE}/sales-channels`, { method: 'GET' });
  return (data as SalesChannel[]).map((r) => SalesChannelSchema.parse(r));
}

export async function createSalesChannel(input: SalesChannelCreate): Promise<SalesChannel> {
  const data = await apiRequest<unknown>(`${BASE}/sales-channels`, { method: 'POST', body: input });
  return SalesChannelSchema.parse(data);
}

export async function updateSalesChannel(
  id: string, input: SalesChannelPatch,
): Promise<SalesChannel> {
  const data = await apiRequest<unknown>(`${BASE}/sales-channels/${id}`, { method: 'PATCH', body: input });
  return SalesChannelSchema.parse(data);
}

// ===========================================================================
// sales_orders (parent, state machine)
// ===========================================================================

export type ListSalesOrdersFilters = {
  status?: SalesOrderStatus | 'all';
  channel_id?: string;
  customer_id?: string;
  project_id?: string;
};

function ordersQs(f: ListSalesOrdersFilters): string {
  const p = new URLSearchParams();
  if (f.status && f.status !== 'all') p.set('status', f.status);
  if (f.channel_id) p.set('channel_id', f.channel_id);
  if (f.customer_id) p.set('customer_id', f.customer_id);
  if (f.project_id) p.set('project_id', f.project_id);
  const s = p.toString();
  return s ? `?${s}` : '';
}

export async function listSalesOrders(
  filters: ListSalesOrdersFilters = {},
): Promise<SalesOrder[]> {
  const data = await apiRequest<unknown>(`${BASE}/sales-orders${ordersQs(filters)}`, { method: 'GET' });
  return (data as SalesOrder[]).map((r) => SalesOrderSchema.parse(r));
}

export async function getSalesOrder(id: string): Promise<SalesOrder> {
  const data = await apiRequest<unknown>(`${BASE}/sales-orders/${id}`, { method: 'GET' });
  return SalesOrderSchema.parse(data);
}

export async function createSalesOrder(input: SalesOrderCreate): Promise<SalesOrder> {
  const data = await apiRequest<unknown>(`${BASE}/sales-orders`, { method: 'POST', body: input });
  return SalesOrderSchema.parse(data);
}

export async function updateSalesOrder(id: string, input: SalesOrderPatch): Promise<SalesOrder> {
  const data = await apiRequest<unknown>(`${BASE}/sales-orders/${id}`, { method: 'PATCH', body: input });
  return SalesOrderSchema.parse(data);
}

export async function deleteSalesOrder(id: string): Promise<{ id: string; deleted: boolean }> {
  return apiRequest<{ id: string; deleted: boolean }>(`${BASE}/sales-orders/${id}`, { method: 'DELETE' });
}

export async function confirmSalesOrder(id: string): Promise<SalesOrder> {
  const data = await apiRequest<unknown>(`${BASE}/sales-orders/${id}/confirm`, { method: 'POST' });
  return SalesOrderSchema.parse(data);
}

export async function cancelSalesOrder(id: string): Promise<SalesOrder> {
  const data = await apiRequest<unknown>(`${BASE}/sales-orders/${id}/cancel`, { method: 'POST' });
  return SalesOrderSchema.parse(data);
}

// --- order line items (item_id REQUIRED) ---

export async function listSalesOrderLines(orderId: string): Promise<SalesOrderLineItem[]> {
  const data = await apiRequest<unknown>(`${BASE}/sales-orders/${orderId}/lines`, { method: 'GET' });
  return (data as SalesOrderLineItem[]).map((r) => SalesOrderLineItemSchema.parse(r));
}

export async function createSalesOrderLine(
  orderId: string, input: SalesOrderLineItemCreate,
): Promise<SalesOrderLineItem> {
  const data = await apiRequest<unknown>(`${BASE}/sales-orders/${orderId}/lines`, { method: 'POST', body: input });
  return SalesOrderLineItemSchema.parse(data);
}

export async function updateSalesOrderLine(
  orderId: string, lineId: string, input: SalesOrderLineItemUpdate,
): Promise<SalesOrderLineItem> {
  const data = await apiRequest<unknown>(`${BASE}/sales-orders/${orderId}/lines/${lineId}`, { method: 'PATCH', body: input });
  return SalesOrderLineItemSchema.parse(data);
}

export async function deleteSalesOrderLine(
  orderId: string, lineId: string,
): Promise<{ id: string; deleted: boolean }> {
  return apiRequest<{ id: string; deleted: boolean }>(`${BASE}/sales-orders/${orderId}/lines/${lineId}`, { method: 'DELETE' });
}

// ===========================================================================
// kitting_jobs (parent, state machine)
// ===========================================================================

export type ListKittingJobsFilters = {
  status?: KittingJobStatus | 'all';
  sales_order_id?: string;
  warehouse_id?: string;
};

function kittingQs(f: ListKittingJobsFilters): string {
  const p = new URLSearchParams();
  if (f.status && f.status !== 'all') p.set('status', f.status);
  if (f.sales_order_id) p.set('sales_order_id', f.sales_order_id);
  if (f.warehouse_id) p.set('warehouse_id', f.warehouse_id);
  const s = p.toString();
  return s ? `?${s}` : '';
}

export async function listKittingJobs(
  filters: ListKittingJobsFilters = {},
): Promise<KittingJob[]> {
  const data = await apiRequest<unknown>(`${BASE}/kitting-jobs${kittingQs(filters)}`, { method: 'GET' });
  return (data as KittingJob[]).map((r) => KittingJobSchema.parse(r));
}

export async function getKittingJob(id: string): Promise<KittingJob> {
  const data = await apiRequest<unknown>(`${BASE}/kitting-jobs/${id}`, { method: 'GET' });
  return KittingJobSchema.parse(data);
}

export async function createKittingJob(input: KittingJobCreate): Promise<KittingJob> {
  const data = await apiRequest<unknown>(`${BASE}/kitting-jobs`, { method: 'POST', body: input });
  return KittingJobSchema.parse(data);
}

export async function updateKittingJob(id: string, input: KittingJobPatch): Promise<KittingJob> {
  const data = await apiRequest<unknown>(`${BASE}/kitting-jobs/${id}`, { method: 'PATCH', body: input });
  return KittingJobSchema.parse(data);
}

export async function deleteKittingJob(id: string): Promise<{ id: string; deleted: boolean }> {
  return apiRequest<{ id: string; deleted: boolean }>(`${BASE}/kitting-jobs/${id}`, { method: 'DELETE' });
}

export async function startKittingJob(id: string): Promise<KittingJob> {
  const data = await apiRequest<unknown>(`${BASE}/kitting-jobs/${id}/start`, { method: 'POST' });
  return KittingJobSchema.parse(data);
}

export async function completeKittingJob(id: string): Promise<KittingJob> {
  const data = await apiRequest<unknown>(`${BASE}/kitting-jobs/${id}/complete`, { method: 'POST' });
  return KittingJobSchema.parse(data);
}

export async function cancelKittingJob(id: string): Promise<KittingJob> {
  const data = await apiRequest<unknown>(`${BASE}/kitting-jobs/${id}/cancel`, { method: 'POST' });
  return KittingJobSchema.parse(data);
}

// --- consumed line items (item_id REQUIRED) ---

export async function listKittingConsumedLines(jobId: string): Promise<KittingJobConsumedLineItem[]> {
  const data = await apiRequest<unknown>(`${BASE}/kitting-jobs/${jobId}/consumed`, { method: 'GET' });
  return (data as KittingJobConsumedLineItem[]).map((r) => KittingJobConsumedLineItemSchema.parse(r));
}

export async function createKittingConsumedLine(
  jobId: string, input: KittingJobConsumedLineItemCreate,
): Promise<KittingJobConsumedLineItem> {
  const data = await apiRequest<unknown>(`${BASE}/kitting-jobs/${jobId}/consumed`, { method: 'POST', body: input });
  return KittingJobConsumedLineItemSchema.parse(data);
}

export async function updateKittingConsumedLine(
  jobId: string, lineId: string, input: KittingJobConsumedLineItemUpdate,
): Promise<KittingJobConsumedLineItem> {
  const data = await apiRequest<unknown>(`${BASE}/kitting-jobs/${jobId}/consumed/${lineId}`, { method: 'PATCH', body: input });
  return KittingJobConsumedLineItemSchema.parse(data);
}

export async function deleteKittingConsumedLine(
  jobId: string, lineId: string,
): Promise<{ id: string; deleted: boolean }> {
  return apiRequest<{ id: string; deleted: boolean }>(`${BASE}/kitting-jobs/${jobId}/consumed/${lineId}`, { method: 'DELETE' });
}

// --- produced line items (item_id NULLABLE) ---

export async function listKittingProducedLines(jobId: string): Promise<KittingJobProducedLineItem[]> {
  const data = await apiRequest<unknown>(`${BASE}/kitting-jobs/${jobId}/produced`, { method: 'GET' });
  return (data as KittingJobProducedLineItem[]).map((r) => KittingJobProducedLineItemSchema.parse(r));
}

export async function createKittingProducedLine(
  jobId: string, input: KittingJobProducedLineItemCreate,
): Promise<KittingJobProducedLineItem> {
  const data = await apiRequest<unknown>(`${BASE}/kitting-jobs/${jobId}/produced`, { method: 'POST', body: input });
  return KittingJobProducedLineItemSchema.parse(data);
}

export async function updateKittingProducedLine(
  jobId: string, lineId: string, input: KittingJobProducedLineItemUpdate,
): Promise<KittingJobProducedLineItem> {
  const data = await apiRequest<unknown>(`${BASE}/kitting-jobs/${jobId}/produced/${lineId}`, { method: 'PATCH', body: input });
  return KittingJobProducedLineItemSchema.parse(data);
}

export async function deleteKittingProducedLine(
  jobId: string, lineId: string,
): Promise<{ id: string; deleted: boolean }> {
  return apiRequest<{ id: string; deleted: boolean }>(`${BASE}/kitting-jobs/${jobId}/produced/${lineId}`, { method: 'DELETE' });
}

// ===========================================================================
// fulfillments (parent, state machine)
// ===========================================================================

export type ListFulfillmentsFilters = {
  status?: FulfillmentStatus | 'all';
  sales_order_id?: string;
};

function fulfillmentsQs(f: ListFulfillmentsFilters): string {
  const p = new URLSearchParams();
  if (f.status && f.status !== 'all') p.set('status', f.status);
  if (f.sales_order_id) p.set('sales_order_id', f.sales_order_id);
  const s = p.toString();
  return s ? `?${s}` : '';
}

export async function listFulfillments(
  filters: ListFulfillmentsFilters = {},
): Promise<Fulfillment[]> {
  const data = await apiRequest<unknown>(`${BASE}/fulfillments${fulfillmentsQs(filters)}`, { method: 'GET' });
  return (data as Fulfillment[]).map((r) => FulfillmentSchema.parse(r));
}

export async function getFulfillment(id: string): Promise<Fulfillment> {
  const data = await apiRequest<unknown>(`${BASE}/fulfillments/${id}`, { method: 'GET' });
  return FulfillmentSchema.parse(data);
}

export async function createFulfillment(input: FulfillmentCreate): Promise<Fulfillment> {
  const data = await apiRequest<unknown>(`${BASE}/fulfillments`, { method: 'POST', body: input });
  return FulfillmentSchema.parse(data);
}

export async function pickFulfillment(id: string): Promise<Fulfillment> {
  const data = await apiRequest<unknown>(`${BASE}/fulfillments/${id}/pick`, { method: 'POST' });
  return FulfillmentSchema.parse(data);
}

export async function packFulfillment(id: string): Promise<Fulfillment> {
  const data = await apiRequest<unknown>(`${BASE}/fulfillments/${id}/pack`, { method: 'POST' });
  return FulfillmentSchema.parse(data);
}

export async function shipFulfillment(id: string): Promise<Fulfillment> {
  const data = await apiRequest<unknown>(`${BASE}/fulfillments/${id}/ship`, { method: 'POST' });
  return FulfillmentSchema.parse(data);
}

export async function cancelFulfillment(id: string): Promise<Fulfillment> {
  const data = await apiRequest<unknown>(`${BASE}/fulfillments/${id}/cancel`, { method: 'POST' });
  return FulfillmentSchema.parse(data);
}
