// Side-car canon: WMS Body B Zod types (add-on six, warehouse execution).
// Byte-identical pair: apps/web/src/lib/types/wms.ts.
// Drift is a release blocker.
//
// Tables (migration 0106): warehouse_locations (a bin / shelf / rack / dock /
// staging area inside a warehouse; a config table with an active boolean flag,
// not a registered FSM). parent_location_id is a nullable self-ref allowing an
// arbitrary-depth hierarchy. attributes jsonb carries pickable / putaway-
// eligible / capacity. The B2 stock-movement bin dimension, B3 putaway, and B4
// lots add their schemas here per phase.

import { z } from 'zod';

const Uuid = z.string().uuid();
const Iso = z.string();
// numeric(18,4) on the wire: supabase-js returns a string for non-integer
// values and may return a JS number for a clean integer default. Mirrors the
// spine StockLevel Qty posture (vendors_inventory_ops.ts) so the bin rollup
// parses the same shapes.
const Qty = z.union([z.number(), z.string().regex(/^-?\d+(\.\d+)?$/)]);

// ---------------------------------------------------------------------------
// warehouse_locations (parent; config table, active flag, no rich FSM)
// ---------------------------------------------------------------------------

export const WarehouseLocationTypeSchema = z.enum([
  'bin',
  'shelf',
  'rack',
  'dock',
  'staging',
]);
export type WarehouseLocationType = z.infer<typeof WarehouseLocationTypeSchema>;

export const WarehouseLocationSchema = z.object({
  id: Uuid,
  org_id: Uuid,
  warehouse_id: Uuid,
  code: z.string(),
  location_type: WarehouseLocationTypeSchema,
  parent_location_id: Uuid.nullable(),
  attributes: z.record(z.unknown()),
  active: z.boolean(),
  notes: z.string().nullable(),
  created_at: Iso,
  updated_at: Iso,
});
export type WarehouseLocation = z.infer<typeof WarehouseLocationSchema>;

export const WarehouseLocationCreateSchema = z.object({
  warehouse_id: Uuid,
  code: z.string().min(1),
  location_type: WarehouseLocationTypeSchema,
  parent_location_id: Uuid.optional().nullable(),
  attributes: z.record(z.unknown()).optional(),
  active: z.boolean().optional(),
  notes: z.string().optional().nullable(),
});
export type WarehouseLocationCreate = z.infer<typeof WarehouseLocationCreateSchema>;

export const WarehouseLocationPatchSchema = WarehouseLocationCreateSchema.partial();
export type WarehouseLocationPatch = z.infer<typeof WarehouseLocationPatchSchema>;

// ---------------------------------------------------------------------------
// bin_stock_levels (migration 0107; WMS Body B Phase B2 stock-movement bin
// dimension). A read-only rollup derived from the append-only stock_movements
// ledger, grouped by (warehouse, location, item, lot). Maintained by the
// recompute_bin_stock_level SECURITY DEFINER function fired off the AFTER INSERT
// trigger; there is no client write path. The sum of quantity_on_hand over every
// location partition (the NULL no-bin partition included) reconciles to the
// spine stock_levels.quantity_on_hand for the same (warehouse, item) by
// construction. quantity_on_hand is a numeric(18,4) string on the wire.
// ---------------------------------------------------------------------------

export const BinStockLevelSchema = z.object({
  id: Uuid,
  org_id: Uuid,
  warehouse_id: Uuid,
  location_id: Uuid,
  item_id: Uuid,
  lot_id: Uuid.nullable(),
  quantity_on_hand: Qty,
  last_movement_at: Iso.nullable(),
  updated_at: Iso,
});
export type BinStockLevel = z.infer<typeof BinStockLevelSchema>;

// ---------------------------------------------------------------------------
// putaway_tasks (migration 0109; WMS Body B Phase B3 directed putaway). A
// directed move of received stock from a dock (source_location_id) to a final
// bin (actual_location_id). Rich FSM suggested / in_progress / done / cancelled,
// moved by the server RPCs (start / complete / cancel), not table writes.
// Completing a task emits a warehouse-flat internal move (transfer_out at the
// dock + transfer_in at the bin); the warehouse total stays flat while the bin
// grain shifts. lot_id / license_plate_id are nullable uuids (the lot FK lands
// in B4). source_entity_type / source_entity_id are a free-form audit ref (e.g.
// the receiving_order the stock arrived on); no FK.
// ---------------------------------------------------------------------------

export const PutawayTaskStatusSchema = z.enum([
  'suggested',
  'in_progress',
  'done',
  'cancelled',
]);
export type PutawayTaskStatus = z.infer<typeof PutawayTaskStatusSchema>;

export const PutawayTaskSchema = z.object({
  id: Uuid,
  org_id: Uuid,
  warehouse_id: Uuid,
  item_id: Uuid,
  quantity: Qty,
  source_location_id: Uuid.nullable(),
  suggested_location_id: Uuid.nullable(),
  actual_location_id: Uuid.nullable(),
  lot_id: Uuid.nullable(),
  license_plate_id: Uuid.nullable(),
  source_entity_type: z.string().nullable(),
  source_entity_id: Uuid.nullable(),
  status: PutawayTaskStatusSchema,
  started_at: Iso.nullable(),
  completed_at: Iso.nullable(),
  cancelled_at: Iso.nullable(),
  notes: z.string().nullable(),
  created_at: Iso,
  updated_at: Iso,
});
export type PutawayTask = z.infer<typeof PutawayTaskSchema>;

export const PutawayTaskCreateSchema = z.object({
  warehouse_id: Uuid,
  item_id: Uuid,
  quantity: Qty,
  source_location_id: Uuid.optional().nullable(),
  suggested_location_id: Uuid.optional().nullable(),
  actual_location_id: Uuid.optional().nullable(),
  lot_id: Uuid.optional().nullable(),
  license_plate_id: Uuid.optional().nullable(),
  source_entity_type: z.string().optional().nullable(),
  source_entity_id: Uuid.optional().nullable(),
  notes: z.string().optional().nullable(),
});
export type PutawayTaskCreate = z.infer<typeof PutawayTaskCreateSchema>;

export const PutawayTaskPatchSchema = PutawayTaskCreateSchema.partial();
export type PutawayTaskPatch = z.infer<typeof PutawayTaskPatchSchema>;

// Set-destination action body (migration 0114; R-W13-WMS-01). The destination
// bin is REQUIRED here: this action exists precisely to set actual_location_id
// before a complete, since a complete with a null destination now raises
// STATE_CONFLICT instead of marking the task done with zero movements. The
// server still validates the bin lives in the task's warehouse.
export const PutawayDestinationSchema = z.object({
  actual_location_id: Uuid,
});
export type PutawayDestination = z.infer<typeof PutawayDestinationSchema>;

// ---------------------------------------------------------------------------
// lots (migration 0110; WMS Body B Phase B4 lot and expiration capture). A lot
// / batch of an item with optional expiration. A near-config FSM whose state is
// its status (active / quarantined / expired / consumed); Phase 1 ships only
// the quarantine hold (active -> quarantined). lot_code is required on create;
// expiration_date, received_at, and notes are optional (decision (c): lot is
// always optional, never mandatory, in Phase 1). Captured at receiving and
// putaway; the 0107 bin recompute null-safe-matches lot, so a lot-keyed bin row
// reconciles to the warehouse total. expiration_date is a date string on the
// wire; received_at is an ISO timestamp.
// ---------------------------------------------------------------------------

export const LotStatusSchema = z.enum([
  'active',
  'quarantined',
  'expired',
  'consumed',
]);
export type LotStatus = z.infer<typeof LotStatusSchema>;

export const LotSchema = z.object({
  id: Uuid,
  org_id: Uuid,
  item_id: Uuid,
  lot_code: z.string(),
  expiration_date: z.string().nullable(),
  received_at: Iso.nullable(),
  status: LotStatusSchema,
  notes: z.string().nullable(),
  created_at: Iso,
  updated_at: Iso,
});
export type Lot = z.infer<typeof LotSchema>;

// status is deliberately OMITTED on create (matching PutawayTaskCreateSchema).
// A new lot ALWAYS starts at the DB default 'active'; the quarantine hold
// (active -> quarantined) is the only status move, and it flows through the
// quarantine_lot RPC, never a client-supplied status. LotPatchSchema inherits
// this omission, so PATCH cannot set status either.
export const LotCreateSchema = z.object({
  item_id: Uuid,
  lot_code: z.string().min(1),
  expiration_date: z.string().optional().nullable(),
  received_at: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});
export type LotCreate = z.infer<typeof LotCreateSchema>;

export const LotPatchSchema = LotCreateSchema.partial();
export type LotPatch = z.infer<typeof LotPatchSchema>;
