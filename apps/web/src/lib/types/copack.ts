// Side-car canon: Pillar 3 Co-Pack and Ecom Zod types.
// Byte-identical pair: apps/web/src/lib/types/copack.ts.
// Drift is a release blocker.
//
// Tables (migrations 0073-0076): sales_channels (library),
// sales_orders (parent, state machine) + sales_order_line_items,
// kitting_jobs (parent, state machine) + kitting_job_consumed_line_items
// (item_id REQUIRED) + kitting_job_produced_line_items (item_id NULLABLE),
// fulfillments (parent, state machine). Money is BIGINT _cents; quantities are
// numeric(18,4) carried on the wire as number or numeric-string.

import { z } from 'zod';

const Uuid = z.string().uuid();
const Cents = z.union([z.number().int(), z.string().regex(/^-?\d+$/)]);
const Qty = z.union([z.number(), z.string().regex(/^-?\d+(\.\d+)?$/)]);
const Iso = z.string();
const Currency = z.string().length(3);
// Per-line supply-source override (migration 0121). NULL inherits the item
// default; a non-null value wins for cost roll-ups via COALESCE(line, item).
const SupplySource = z.enum([
  'in_house', 'customer_supplied', 'vendor_consigned', 'third_party_consigned',
]);

// ---------------------------------------------------------------------------
// sales_channels (library, no state machine)
// ---------------------------------------------------------------------------

export const SalesChannelKindSchema = z.enum([
  'manual',
  'shopify',
  'amazon',
  'other',
]);
export type SalesChannelKind = z.infer<typeof SalesChannelKindSchema>;

export const SalesChannelSchema = z.object({
  id: Uuid,
  org_id: Uuid,
  name: z.string(),
  kind: SalesChannelKindSchema,
  is_active: z.boolean(),
  created_at: Iso,
  updated_at: Iso,
});
export type SalesChannel = z.infer<typeof SalesChannelSchema>;

export const SalesChannelCreateSchema = z.object({
  name: z.string().min(1),
  kind: SalesChannelKindSchema.default('manual'),
  is_active: z.boolean().optional(),
});
export type SalesChannelCreate = z.infer<typeof SalesChannelCreateSchema>;

export const SalesChannelPatchSchema = SalesChannelCreateSchema.partial();
export type SalesChannelPatch = z.infer<typeof SalesChannelPatchSchema>;

// ---------------------------------------------------------------------------
// sales_orders (parent, state machine)
// draft -> confirmed -> picking -> packed -> shipped;
// draft|confirmed|picking|packed -> cancelled; shipped terminal.
// Timestamps ordered_at / confirmed_at / shipped_at / cancelled_at handler-set.
// ---------------------------------------------------------------------------

export const SalesOrderStatusSchema = z.enum([
  'draft',
  'confirmed',
  'picking',
  'packed',
  'shipped',
  'cancelled',
]);
export type SalesOrderStatus = z.infer<typeof SalesOrderStatusSchema>;

export const SalesOrderSchema = z.object({
  id: Uuid,
  org_id: Uuid,
  order_number: z.string().nullable(),
  channel_id: Uuid.nullable(),
  customer_id: Uuid.nullable(),
  project_id: Uuid.nullable(),
  status: SalesOrderStatusSchema,
  currency_code: Currency.nullable(),
  ordered_at: Iso.nullable(),
  confirmed_at: Iso.nullable(),
  shipped_at: Iso.nullable(),
  cancelled_at: Iso.nullable(),
  notes: z.string().nullable(),
  payload: z.record(z.unknown()),
  created_at: Iso,
  updated_at: Iso,
});
export type SalesOrder = z.infer<typeof SalesOrderSchema>;

export const SalesOrderCreateSchema = z.object({
  order_number: z.string().optional().nullable(),
  channel_id: Uuid.optional().nullable(),
  customer_id: Uuid.optional().nullable(),
  project_id: Uuid.optional().nullable(),
  currency_code: Currency.optional().nullable(),
  ordered_at: Iso.optional().nullable(),
  notes: z.string().optional().nullable(),
  payload: z.record(z.unknown()).optional(),
});
export type SalesOrderCreate = z.infer<typeof SalesOrderCreateSchema>;

export const SalesOrderPatchSchema = SalesOrderCreateSchema.partial();
export type SalesOrderPatch = z.infer<typeof SalesOrderPatchSchema>;

// item_id REQUIRED: an order line names what was ordered.
export const SalesOrderLineItemSchema = z.object({
  id: Uuid,
  org_id: Uuid,
  sales_order_id: Uuid,
  item_id: Uuid,
  quantity: Qty,
  unit_price_cents: Cents.nullable(),
  uom: z.string().nullable(),
  reference: z.string().nullable(),
  position: z.number().int(),
  created_at: Iso,
  updated_at: Iso,
});
export type SalesOrderLineItem = z.infer<typeof SalesOrderLineItemSchema>;

export const SalesOrderLineItemCreateSchema = z.object({
  item_id: Uuid,
  quantity: Qty,
  unit_price_cents: Cents.optional().nullable(),
  uom: z.string().min(1).max(16).optional().nullable(),
  reference: z.string().optional().nullable(),
  position: z.number().int().optional(),
});
export type SalesOrderLineItemCreate = z.infer<typeof SalesOrderLineItemCreateSchema>;

export const SalesOrderLineItemUpdateSchema =
  SalesOrderLineItemCreateSchema.partial();
export type SalesOrderLineItemUpdate = z.infer<typeof SalesOrderLineItemUpdateSchema>;

// ---------------------------------------------------------------------------
// kitting_jobs (parent, state machine)
// draft -> started -> completed; draft|started -> cancelled; completed terminal.
// Mirrors manufacturing_runs one-for-one. warehouse_id NULLABLE.
// ---------------------------------------------------------------------------

export const KittingJobStatusSchema = z.enum([
  'draft',
  'started',
  'completed',
  'cancelled',
]);
export type KittingJobStatus = z.infer<typeof KittingJobStatusSchema>;

export const KittingJobSchema = z.object({
  id: Uuid,
  org_id: Uuid,
  job_number: z.string().nullable(),
  sales_order_id: Uuid.nullable(),
  warehouse_id: Uuid.nullable(),
  status: KittingJobStatusSchema,
  planned_start_at: Iso.nullable(),
  planned_complete_at: Iso.nullable(),
  started_at: Iso.nullable(),
  completed_at: Iso.nullable(),
  cancelled_at: Iso.nullable(),
  notes: z.string().nullable(),
  payload: z.record(z.unknown()),
  created_at: Iso,
  updated_at: Iso,
});
export type KittingJob = z.infer<typeof KittingJobSchema>;

export const KittingJobCreateSchema = z.object({
  job_number: z.string().optional().nullable(),
  sales_order_id: Uuid.optional().nullable(),
  warehouse_id: Uuid.optional().nullable(),
  planned_start_at: Iso.optional().nullable(),
  planned_complete_at: Iso.optional().nullable(),
  notes: z.string().optional().nullable(),
  payload: z.record(z.unknown()).optional(),
});
export type KittingJobCreate = z.infer<typeof KittingJobCreateSchema>;

export const KittingJobPatchSchema = KittingJobCreateSchema.partial();
export type KittingJobPatch = z.infer<typeof KittingJobPatchSchema>;

// Consumed: item_id REQUIRED (strict).
export const KittingJobConsumedLineItemSchema = z.object({
  id: Uuid,
  org_id: Uuid,
  kitting_job_id: Uuid,
  item_id: Uuid,
  quantity: Qty,
  unit_cost_cents: Cents.nullable(),
  uom: z.string().nullable(),
  reference: z.string().nullable(),
  supply_source: SupplySource.nullable().optional(),
  position: z.number().int(),
  created_at: Iso,
  updated_at: Iso,
});
export type KittingJobConsumedLineItem = z.infer<typeof KittingJobConsumedLineItemSchema>;

export const KittingJobConsumedLineItemCreateSchema = z.object({
  item_id: Uuid,
  quantity: Qty,
  unit_cost_cents: Cents.optional().nullable(),
  uom: z.string().min(1).max(16).optional().nullable(),
  reference: z.string().optional().nullable(),
  supply_source: SupplySource.nullable().optional(),
  position: z.number().int().optional(),
});
export type KittingJobConsumedLineItemCreate = z.infer<typeof KittingJobConsumedLineItemCreateSchema>;

export const KittingJobConsumedLineItemUpdateSchema =
  KittingJobConsumedLineItemCreateSchema.partial();
export type KittingJobConsumedLineItemUpdate = z.infer<typeof KittingJobConsumedLineItemUpdateSchema>;

// Produced: item_id NULLABLE (lenient).
export const KittingJobProducedLineItemSchema = z.object({
  id: Uuid,
  org_id: Uuid,
  kitting_job_id: Uuid,
  item_id: Uuid.nullable(),
  quantity: Qty,
  unit_cost_cents: Cents.nullable(),
  uom: z.string().nullable(),
  reference: z.string().nullable(),
  position: z.number().int(),
  created_at: Iso,
  updated_at: Iso,
});
export type KittingJobProducedLineItem = z.infer<typeof KittingJobProducedLineItemSchema>;

export const KittingJobProducedLineItemCreateSchema = z.object({
  item_id: Uuid.optional().nullable(),
  quantity: Qty,
  unit_cost_cents: Cents.optional().nullable(),
  uom: z.string().min(1).max(16).optional().nullable(),
  reference: z.string().optional().nullable(),
  position: z.number().int().optional(),
});
export type KittingJobProducedLineItemCreate = z.infer<typeof KittingJobProducedLineItemCreateSchema>;

export const KittingJobProducedLineItemUpdateSchema =
  KittingJobProducedLineItemCreateSchema.partial();
export type KittingJobProducedLineItemUpdate = z.infer<typeof KittingJobProducedLineItemUpdateSchema>;

// ---------------------------------------------------------------------------
// fulfillments (parent, state machine)
// pending -> picking -> packed -> shipped;
// pending|picking|packed -> cancelled; shipped terminal.
// A fulfillment reaching shipped advances its sales_order to shipped.
// ---------------------------------------------------------------------------

export const FulfillmentStatusSchema = z.enum([
  'pending',
  'picking',
  'packed',
  'shipped',
  'cancelled',
]);
export type FulfillmentStatus = z.infer<typeof FulfillmentStatusSchema>;

export const FulfillmentSchema = z.object({
  id: Uuid,
  org_id: Uuid,
  fulfillment_number: z.string().nullable(),
  sales_order_id: Uuid,
  warehouse_id: Uuid.nullable(),
  shipment_id: Uuid.nullable(),
  status: FulfillmentStatusSchema,
  picked_at: Iso.nullable(),
  packed_at: Iso.nullable(),
  shipped_at: Iso.nullable(),
  cancelled_at: Iso.nullable(),
  notes: z.string().nullable(),
  payload: z.record(z.unknown()),
  created_at: Iso,
  updated_at: Iso,
});
export type Fulfillment = z.infer<typeof FulfillmentSchema>;

export const FulfillmentCreateSchema = z.object({
  sales_order_id: Uuid,
  fulfillment_number: z.string().optional().nullable(),
  warehouse_id: Uuid.optional().nullable(),
  shipment_id: Uuid.optional().nullable(),
  notes: z.string().optional().nullable(),
  payload: z.record(z.unknown()).optional(),
});
export type FulfillmentCreate = z.infer<typeof FulfillmentCreateSchema>;

export const FulfillmentPatchSchema = FulfillmentCreateSchema.partial();
export type FulfillmentPatch = z.infer<typeof FulfillmentPatchSchema>;

// ---------------------------------------------------------------------------
// Shared transition request: { reason } for confirm/cancel/start/complete/
// pick/pack/ship endpoints. The target state is fixed by the route, so only an
// optional operator reason rides the body.
// ---------------------------------------------------------------------------

export const CoPackTransitionRequestSchema = z.object({
  reason: z.string().optional().nullable(),
});
export type CoPackTransitionRequest = z.infer<typeof CoPackTransitionRequestSchema>;
