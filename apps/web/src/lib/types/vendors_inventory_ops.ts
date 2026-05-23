// Side-car canon: vendors + inventory + ops Zod types.
// Byte-identical pair: apps/web/src/lib/types/vendors_inventory_ops.ts.
// Drift is a release blocker.

import { z } from 'zod';

const Uuid = z.string().uuid();
const Cents = z.union([z.number().int(), z.string().regex(/^-?\d+$/)]);
const Qty = z.union([z.number(), z.string().regex(/^-?\d+(\.\d+)?$/)]);
const Iso = z.string();
const Currency = z.string().length(3);

// ---------------------------------------------------------------------------
// Vendors
// ---------------------------------------------------------------------------

export const VendorSchema = z.object({
  id: Uuid,
  org_id: Uuid,
  vendor_number: z.string().nullable(),
  display_name: z.string(),
  legal_name: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  website: z.string().nullable(),
  tax_id: z.string().nullable(),
  default_currency_code: Currency,
  default_payment_terms_days: z.number().int(),
  notes: z.string().nullable(),
  is_active: z.boolean(),
  address_line1: z.string().nullable(),
  address_line2: z.string().nullable(),
  city: z.string().nullable(),
  region: z.string().nullable(),
  postal_code: z.string().nullable(),
  country_code: z.string().nullable(),
  created_at: Iso,
  updated_at: Iso,
});
export type Vendor = z.infer<typeof VendorSchema>;

// ---------------------------------------------------------------------------
// Purchase orders + lines
// ---------------------------------------------------------------------------

export const PurchaseOrderStatusSchema = z.enum([
  'draft',
  'submitted',
  'approved',
  'partial_received',
  'received',
  'closed',
  'cancelled',
]);
export type PurchaseOrderStatus = z.infer<typeof PurchaseOrderStatusSchema>;

export const PurchaseOrderSchema = z.object({
  id: Uuid,
  org_id: Uuid,
  po_number: z.string().nullable(),
  vendor_id: Uuid,
  warehouse_id: Uuid.nullable(),
  status: PurchaseOrderStatusSchema,
  currency_code: Currency,
  order_date: z.string(),
  expected_date: z.string().nullable(),
  received_date: z.string().nullable(),
  subtotal_cents: Cents,
  tax_cents: Cents,
  shipping_cents: Cents,
  total_cents: Cents,
  notes: z.string().nullable(),
  reference: z.string().nullable(),
  created_at: Iso,
  updated_at: Iso,
});
export type PurchaseOrder = z.infer<typeof PurchaseOrderSchema>;

export const PoLineItemSchema = z.object({
  id: Uuid,
  purchase_order_id: Uuid,
  item_id: Uuid.nullable(),
  description: z.string(),
  quantity_ordered: Qty,
  quantity_received: Qty,
  unit_price_cents: Cents,
  tax_rate_bps: z.number().int(),
  line_subtotal_cents: Cents,
  line_tax_cents: Cents,
  line_total_cents: Cents,
  sort_order: z.number().int(),
  created_at: Iso,
  updated_at: Iso,
});
export type PoLineItem = z.infer<typeof PoLineItemSchema>;

// ---------------------------------------------------------------------------
// Vendor bills + payments
// ---------------------------------------------------------------------------

export const VendorBillStatusSchema = z.enum([
  'draft',
  'submitted',
  'approved',
  'partial_paid',
  'paid',
  'closed',
  'cancelled',
]);
export type VendorBillStatus = z.infer<typeof VendorBillStatusSchema>;

export const VendorBillSchema = z.object({
  id: Uuid,
  org_id: Uuid,
  bill_number: z.string().nullable(),
  vendor_id: Uuid,
  purchase_order_id: Uuid.nullable(),
  status: VendorBillStatusSchema,
  currency_code: Currency,
  bill_date: z.string(),
  due_date: z.string().nullable(),
  subtotal_cents: Cents,
  tax_cents: Cents,
  total_cents: Cents,
  paid_cents: Cents,
  balance_cents: Cents,
  notes: z.string().nullable(),
  reference: z.string().nullable(),
  created_at: Iso,
  updated_at: Iso,
});
export type VendorBill = z.infer<typeof VendorBillSchema>;

export const VendorBillPaymentSchema = z.object({
  id: Uuid,
  vendor_bill_id: Uuid,
  payment_date: z.string(),
  amount_cents: Cents,
  currency_code: Currency,
  method: z.string().nullable(),
  reference: z.string().nullable(),
  notes: z.string().nullable(),
  created_at: Iso,
  updated_at: Iso,
});
export type VendorBillPayment = z.infer<typeof VendorBillPaymentSchema>;

// ---------------------------------------------------------------------------
// Expenses
// ---------------------------------------------------------------------------

export const ExpenseStatusSchema = z.enum([
  'draft',
  'submitted',
  'approved',
  'paid',
  'reimbursed',
  'rejected',
]);
export type ExpenseStatus = z.infer<typeof ExpenseStatusSchema>;

export const ExpenseSchema = z.object({
  id: Uuid,
  org_id: Uuid,
  expense_number: z.string().nullable(),
  expense_category_id: Uuid.nullable(),
  vendor_id: Uuid.nullable(),
  project_id: Uuid.nullable().optional(),
  submitter_user_id: Uuid.nullable(),
  status: ExpenseStatusSchema,
  currency_code: Currency,
  expense_date: z.string(),
  description: z.string().nullable(),
  amount_cents: Cents,
  tax_cents: Cents,
  total_cents: Cents,
  reimbursable: z.boolean(),
  receipt_url: z.string().nullable(),
  notes: z.string().nullable(),
  created_at: Iso,
  updated_at: Iso,
});
export type Expense = z.infer<typeof ExpenseSchema>;

export const ExpenseCategorySchema = z.object({
  id: Uuid,
  org_id: Uuid,
  code: z.string(),
  display_name: z.string(),
  description: z.string().nullable(),
  is_active: z.boolean(),
  created_at: Iso,
  updated_at: Iso,
});
export type ExpenseCategory = z.infer<typeof ExpenseCategorySchema>;

// ---------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------

export const WarehouseSchema = z.object({
  id: Uuid,
  org_id: Uuid,
  code: z.string(),
  display_name: z.string(),
  is_default: z.boolean(),
  address_line1: z.string().nullable(),
  address_line2: z.string().nullable(),
  city: z.string().nullable(),
  region: z.string().nullable(),
  postal_code: z.string().nullable(),
  country_code: z.string().nullable(),
  notes: z.string().nullable(),
  is_active: z.boolean(),
  created_at: Iso,
  updated_at: Iso,
});
export type Warehouse = z.infer<typeof WarehouseSchema>;

export const StockLevelSchema = z.object({
  id: Uuid,
  org_id: Uuid,
  warehouse_id: Uuid,
  item_id: Uuid,
  quantity_on_hand: Qty,
  quantity_reserved: Qty,
  quantity_in_transit: Qty,
  quantity_available: Qty,
  last_movement_at: Iso.nullable(),
  updated_at: Iso,
});
export type StockLevel = z.infer<typeof StockLevelSchema>;

export const StockMovementTypeSchema = z.enum([
  'receipt',
  'shipment',
  'production_consumed',
  'production_produced',
  'adjustment',
  'transfer_in',
  'transfer_out',
]);
export type StockMovementType = z.infer<typeof StockMovementTypeSchema>;

export const StockMovementSchema = z.object({
  id: Uuid,
  org_id: Uuid,
  warehouse_id: Uuid,
  item_id: Uuid,
  movement_type: StockMovementTypeSchema,
  quantity: Qty,
  unit_cost_cents: Cents,
  source_entity_type: z.string().nullable(),
  source_entity_id: Uuid.nullable(),
  notes: z.string().nullable(),
  occurred_at: Iso,
  created_at: Iso,
});
export type StockMovement = z.infer<typeof StockMovementSchema>;

export const BomItemSchema = z.object({
  id: Uuid,
  org_id: Uuid,
  parent_item_id: Uuid,
  component_item_id: Uuid,
  quantity_per: Qty,
  unit_of_measure: z.string().nullable(),
  notes: z.string().nullable(),
  sort_order: z.number().int(),
  created_at: Iso,
  updated_at: Iso,
});
export type BomItem = z.infer<typeof BomItemSchema>;

// ---------------------------------------------------------------------------
// 3PL Ops
// ---------------------------------------------------------------------------

export const ReceivingOrderStatusSchema = z.enum([
  'created',
  'in_progress',
  'received',
  'cancelled',
]);
export type ReceivingOrderStatus = z.infer<typeof ReceivingOrderStatusSchema>;

export const ReceivingOrderSchema = z.object({
  id: Uuid,
  org_id: Uuid,
  receiving_number: z.string().nullable(),
  purchase_order_id: Uuid.nullable(),
  warehouse_id: Uuid,
  vendor_id: Uuid.nullable(),
  // UX-Q6: project linkage column landed in migration 0046 and was locked
  // in by 0061. Nullable for historical rows. Receivers may not be linked
  // to a project (e.g. raw-stock inbound for general inventory).
  project_id: Uuid.nullable(),
  status: ReceivingOrderStatusSchema,
  expected_date: z.string().nullable(),
  received_date: z.string().nullable(),
  reference: z.string().nullable(),
  notes: z.string().nullable(),
  payload: z.record(z.unknown()),
  created_at: Iso,
  updated_at: Iso,
});
export type ReceivingOrder = z.infer<typeof ReceivingOrderSchema>;

export const ProductionRunStatusSchema = z.enum([
  'planned',
  'in_progress',
  'completed',
  'cancelled',
]);
export type ProductionRunStatus = z.infer<typeof ProductionRunStatusSchema>;

export const ProductionRunSchema = z.object({
  id: Uuid,
  org_id: Uuid,
  run_number: z.string().nullable(),
  warehouse_id: Uuid,
  output_item_id: Uuid,
  status: ProductionRunStatusSchema,
  quantity_planned: Qty,
  quantity_produced: Qty,
  scheduled_for: z.string().nullable(),
  started_at: Iso.nullable(),
  completed_at: Iso.nullable(),
  notes: z.string().nullable(),
  payload: z.record(z.unknown()),
  created_at: Iso,
  updated_at: Iso,
});
export type ProductionRun = z.infer<typeof ProductionRunSchema>;

export const ShipmentStatusSchema = z.enum([
  'created',
  'picking',
  'shipped',
  'cancelled',
]);
export type ShipmentStatus = z.infer<typeof ShipmentStatusSchema>;

export const ShipmentSchema = z.object({
  id: Uuid,
  org_id: Uuid,
  shipment_number: z.string().nullable(),
  warehouse_id: Uuid,
  customer_id: Uuid.nullable(),
  sales_order_id: Uuid.nullable(),
  // F-Wave9-AUDIT-V3-WAVE-C2-01: project linkage column added structurally
  // by migration 0046 (G-SHIP-FK-01) and re-declared by 0063 for parity
  // with manufacturing_runs. Nullable; ON DELETE SET NULL at the FK.
  // Legacy rows pre-0046 carry NULL.
  project_id: Uuid.nullable().optional(),
  status: ShipmentStatusSchema,
  ship_date: z.string().nullable(),
  carrier: z.string().nullable(),
  tracking_number: z.string().nullable(),
  notes: z.string().nullable(),
  payload: z.record(z.unknown()),
  created_at: Iso,
  updated_at: Iso,
});
export type Shipment = z.infer<typeof ShipmentSchema>;

// ---------------------------------------------------------------------------
// 3PL Ops — payload line shapes (API-boundary validation)
//
// F-Wave7-LINEFORM-VALIDATE-01: receiving / shipment / production_run
// payloads carry `lines` (and for production_run, `consumed` + `produced`)
// arrays. The DB triggers in migration 0048 tolerate malformed entries by
// skipping them, but the API boundary now rejects malformed payloads up
// front so the operator sees a structured 422 instead of a silently
// dropped stock movement.
//
// Wire shape today (payload is jsonb, lines come from the SPA's freeform
// JSON editor): `{ item_id: uuid, quantity: number|numeric-string,
// unit_cost_cents?: cents }`. We keep the optional descriptive fields
// (`name`, `description`, `uom`, `reference`, `quantity_expected`) as
// passthrough so the existing SPA template
// `[{ item_id, name, quantity_expected }]` still validates once the
// operator fills in a real item_id.
//
// Production runs split into two distinct shapes per migration 0048:
//   * consumed: array of line objects, item_id REQUIRED (no fallback in
//     trigger; lines without item_id are skipped).
//   * produced: SINGLE object, all fields optional; trigger coalesces
//     item_id -> output_item_id and quantity -> quantity_produced.
// ---------------------------------------------------------------------------

export const ReceivingOrderLineSchema = z.object({
  item_id: Uuid,
  quantity: Qty,
  unit_cost_cents: Cents.optional(),
  uom: z.string().min(1).max(16).optional(),
  reference: z.string().optional(),
}).passthrough();
export type ReceivingOrderLine = z.infer<typeof ReceivingOrderLineSchema>;

export const ShipmentLineSchema = z.object({
  item_id: Uuid,
  quantity: Qty,
  unit_cost_cents: Cents.optional(),
  uom: z.string().min(1).max(16).optional(),
  reference: z.string().optional(),
}).passthrough();
export type ShipmentLine = z.infer<typeof ShipmentLineSchema>;

export const ProductionRunConsumedLineSchema = z.object({
  item_id: Uuid,
  quantity: Qty,
  unit_cost_cents: Cents.optional(),
  uom: z.string().min(1).max(16).optional(),
  reference: z.string().optional(),
}).passthrough();
export type ProductionRunConsumedLine = z.infer<typeof ProductionRunConsumedLineSchema>;

export const ProductionRunProducedSchema = z.object({
  item_id: Uuid.optional(),
  quantity: Qty.optional(),
  unit_cost_cents: Cents.optional(),
}).passthrough();
export type ProductionRunProduced = z.infer<typeof ProductionRunProducedSchema>;

export const ReceivingOrderPayloadSchema = z.object({
  lines: z.array(ReceivingOrderLineSchema).optional(),
}).passthrough();
export type ReceivingOrderPayload = z.infer<typeof ReceivingOrderPayloadSchema>;

export const ShipmentPayloadSchema = z.object({
  lines: z.array(ShipmentLineSchema).optional(),
}).passthrough();
export type ShipmentPayload = z.infer<typeof ShipmentPayloadSchema>;

export const ProductionRunPayloadSchema = z.object({
  consumed: z.array(ProductionRunConsumedLineSchema).optional(),
  produced: ProductionRunProducedSchema.optional(),
}).passthrough();
export type ProductionRunPayload = z.infer<typeof ProductionRunPayloadSchema>;

// ---------------------------------------------------------------------------
// 3PL Ops - normalised line item tables (F-Wave7-LINES-01, migration 0050)
//
// Receiving + shipment line items live in their own tables. The
// emit_movements triggers were migrated off the JSON read in 0051
// (F-Wave7-EMIT-MOVEMENTS-MIGRATION-01) and the handler-side dual-write was
// retired in F-Wave7-LINES-DUAL-WRITE-DROP-01. The parent's payload.lines
// JSON column still exists for backward compatibility with the receive /
// ship RPC body shape; F-Wave7-LINES-PAYLOAD-DROP-01 will retire it.
// Production runs intentionally stay JSON for this round; the `consumed` /
// `produced` schemas above remain authoritative there (production-run line
// normalisation is tracked as F-Wave7-PRODUCTION-LINES-NORMALIZE-01).
// ---------------------------------------------------------------------------

export const ReceivingOrderLineItemSchema = z.object({
  id: Uuid,
  org_id: Uuid,
  receiving_order_id: Uuid,
  item_id: Uuid,
  quantity: Qty,
  unit_cost_cents: Cents.nullable(),
  uom: z.string().nullable(),
  reference: z.string().nullable(),
  position: z.number().int(),
  created_at: Iso,
  updated_at: Iso,
});
export type ReceivingOrderLineItem = z.infer<typeof ReceivingOrderLineItemSchema>;

export const ReceivingOrderLineItemCreateSchema = z.object({
  item_id: Uuid,
  quantity: Qty,
  unit_cost_cents: Cents.optional().nullable(),
  uom: z.string().min(1).max(16).optional().nullable(),
  reference: z.string().optional().nullable(),
  position: z.number().int().optional(),
});
export type ReceivingOrderLineItemCreate = z.infer<typeof ReceivingOrderLineItemCreateSchema>;

export const ReceivingOrderLineItemUpdateSchema =
  ReceivingOrderLineItemCreateSchema.partial();
export type ReceivingOrderLineItemUpdate = z.infer<typeof ReceivingOrderLineItemUpdateSchema>;

export const ShipmentLineItemSchema = z.object({
  id: Uuid,
  org_id: Uuid,
  shipment_id: Uuid,
  item_id: Uuid,
  quantity: Qty,
  unit_cost_cents: Cents.nullable(),
  uom: z.string().nullable(),
  reference: z.string().nullable(),
  position: z.number().int(),
  created_at: Iso,
  updated_at: Iso,
});
export type ShipmentLineItem = z.infer<typeof ShipmentLineItemSchema>;

export const ShipmentLineItemCreateSchema = z.object({
  item_id: Uuid,
  quantity: Qty,
  unit_cost_cents: Cents.optional().nullable(),
  uom: z.string().min(1).max(16).optional().nullable(),
  reference: z.string().optional().nullable(),
  position: z.number().int().optional(),
});
export type ShipmentLineItemCreate = z.infer<typeof ShipmentLineItemCreateSchema>;

export const ShipmentLineItemUpdateSchema =
  ShipmentLineItemCreateSchema.partial();
export type ShipmentLineItemUpdate = z.infer<typeof ShipmentLineItemUpdateSchema>;

// ---------------------------------------------------------------------------
// Pillar 2 Manufacturing (Path A1 — migration 0052).
//
// Three tables: manufacturing_runs (parent) + manufacturing_run_consumed_line_items
// (item_id REQUIRED) + manufacturing_run_produced_line_items (item_id NULLABLE).
// State machine: draft -> started -> completed; draft|started -> cancelled.
// Timestamps started_at / completed_at / cancelled_at are handler-set
// (mirrors production_runs convention). warehouse_id is NULLABLE per A1
// (admin-only runs that do not touch warehouse inventory).
// ---------------------------------------------------------------------------

export const ManufacturingRunStatusSchema = z.enum([
  'draft',
  'started',
  'completed',
  'cancelled',
]);
export type ManufacturingRunStatus = z.infer<typeof ManufacturingRunStatusSchema>;

export const ManufacturingRunSchema = z.object({
  id: Uuid,
  org_id: Uuid,
  run_number: z.string().nullable(),
  status: ManufacturingRunStatusSchema,
  warehouse_id: Uuid.nullable(),
  // F-Wave9-AUDIT-V3-WAVE-C2-01: project linkage column added by migration
  // 0063. Nullable; ON DELETE SET NULL at the FK. Optional on the read
  // schema so legacy rows that pre-date the column (and any synthetic
  // mock state that omits it) still parse cleanly. The DB column default
  // is NULL.
  project_id: Uuid.nullable().optional(),
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
export type ManufacturingRun = z.infer<typeof ManufacturingRunSchema>;

export const ManufacturingRunCreateSchema = z.object({
  run_number: z.string().optional().nullable(),
  warehouse_id: Uuid.optional().nullable(),
  // F-Wave9-AUDIT-V3-WAVE-C2-01: optional nullable project linkage on
  // create. Mirror of receiving_orders ReceivingCreate.project_id added
  // for UX-Q6. Cross-tenant project_id writes still 404 at the handler
  // level because the projects row is invisible under the org gate.
  project_id: Uuid.nullable().optional(),
  planned_start_at: Iso.optional().nullable(),
  planned_complete_at: Iso.optional().nullable(),
  notes: z.string().optional().nullable(),
  payload: z.record(z.unknown()).optional(),
});
export type ManufacturingRunCreate = z.infer<typeof ManufacturingRunCreateSchema>;

export const ManufacturingRunPatchSchema = ManufacturingRunCreateSchema.partial();
export type ManufacturingRunPatch = z.infer<typeof ManufacturingRunPatchSchema>;

// Consumed: item_id REQUIRED (strict).
export const ManufacturingRunConsumedLineItemSchema = z.object({
  id: Uuid,
  org_id: Uuid,
  manufacturing_run_id: Uuid,
  item_id: Uuid,
  quantity: Qty,
  unit_cost_cents: Cents.nullable(),
  uom: z.string().nullable(),
  reference: z.string().nullable(),
  position: z.number().int(),
  created_at: Iso,
  updated_at: Iso,
});
export type ManufacturingRunConsumedLineItem = z.infer<typeof ManufacturingRunConsumedLineItemSchema>;

export const ManufacturingRunConsumedLineItemCreateSchema = z.object({
  item_id: Uuid,
  quantity: Qty,
  unit_cost_cents: Cents.optional().nullable(),
  uom: z.string().min(1).max(16).optional().nullable(),
  reference: z.string().optional().nullable(),
  position: z.number().int().optional(),
});
export type ManufacturingRunConsumedLineItemCreate = z.infer<typeof ManufacturingRunConsumedLineItemCreateSchema>;

export const ManufacturingRunConsumedLineItemUpdateSchema =
  ManufacturingRunConsumedLineItemCreateSchema.partial();
export type ManufacturingRunConsumedLineItemUpdate = z.infer<typeof ManufacturingRunConsumedLineItemUpdateSchema>;

// Produced: item_id NULLABLE (lenient).
export const ManufacturingRunProducedLineItemSchema = z.object({
  id: Uuid,
  org_id: Uuid,
  manufacturing_run_id: Uuid,
  item_id: Uuid.nullable(),
  quantity: Qty,
  unit_cost_cents: Cents.nullable(),
  uom: z.string().nullable(),
  reference: z.string().nullable(),
  position: z.number().int(),
  created_at: Iso,
  updated_at: Iso,
});
export type ManufacturingRunProducedLineItem = z.infer<typeof ManufacturingRunProducedLineItemSchema>;

export const ManufacturingRunProducedLineItemCreateSchema = z.object({
  item_id: Uuid.optional().nullable(),
  quantity: Qty,
  unit_cost_cents: Cents.optional().nullable(),
  uom: z.string().min(1).max(16).optional().nullable(),
  reference: z.string().optional().nullable(),
  position: z.number().int().optional(),
});
export type ManufacturingRunProducedLineItemCreate = z.infer<typeof ManufacturingRunProducedLineItemCreateSchema>;

export const ManufacturingRunProducedLineItemUpdateSchema =
  ManufacturingRunProducedLineItemCreateSchema.partial();
export type ManufacturingRunProducedLineItemUpdate = z.infer<typeof ManufacturingRunProducedLineItemUpdateSchema>;
