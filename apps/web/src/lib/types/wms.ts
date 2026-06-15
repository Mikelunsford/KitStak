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
