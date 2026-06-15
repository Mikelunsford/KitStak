// wms-api bundle.
//
// Add-on six (WMS, warehouse execution) HTTP surface. Body B deepening core
// (handoff 2026-06-14-wms-bodyb-phase1-handoff.md). Sibling bundle to
// manufacturing-api; gated on plugins.wms, which DEFAULTS OFF (paid add-on,
// unlike plugins.three_pl).
//
// BUNDLE GATE: plugins.wms. Constitutional rule (AUDIT.md / 00-canon):
//   Bundle gate off  -> every route returns 404 NOT_FOUND envelope.
//   Per-route flag   -> 403 FEATURE_DISABLED with details.flag. (Not used here.)
//
// The gate fires BEFORE the route table so even a caller hitting an unknown
// path gets 404. Callers without an org claim land in the standard
// UNAUTHORIZED / NO_ACTIVE_ORG envelopes; we only reach the flag read once
// the caller resolves.
//
// Reads are RLS-only (no read cap on the GET handlers); state-changing routes
// call requireCap(caller, 'wms.location.<action>'). warehouse_locations.active
// is a simple boolean flag (not a registered FSM): deactivate sets it directly.
//
// Routes (when plugins.wms is enabled for the caller's org):
//   GET    /locations                       list (RLS-only; filters via query)
//   POST   /locations                       create
//   GET    /locations/:id                   read (RLS-only)
//   PATCH  /locations/:id                   update
//   DELETE /locations/:id                   soft-delete (reuses location.update)
//   POST   /locations/:id/deactivate        active -> false
//   GET    /bin-stock                        list bin rollup (cap-gated; filters)
//   GET    /bin-stock/:id                    read one bin rollup row (cap-gated)
//   GET    /putaway                          list (RLS-only; filters via query)
//   POST   /putaway                          create
//   GET    /putaway/:id                      read (RLS-only)
//   PATCH  /putaway/:id                      update
//   DELETE /putaway/:id                      soft-delete (reuses putaway.create gate)
//   POST   /putaway/:id/start                suggested -> in_progress
//   POST   /putaway/:id/complete             in_progress -> done (+ emit move)
//   POST   /putaway/:id/cancel               -> cancelled
//
// bin_stock_levels (B2) is a read-only rollup maintained by the
// recompute_bin_stock_level trigger; its GETs require wms.bin_stock.read and
// have no write path. putaway_tasks (B3) is a directed-move FSM moved by the
// start / complete / cancel RPCs; completing a task emits a warehouse-flat
// internal move (transfer_out at the dock + transfer_in at the bin) via the
// complete_putaway_task RPC. B4 (lots) adds its routes per phase.

import { type Route } from '../_shared/route.ts';
import { ApiError, ok, internalError } from '../_shared/responses.ts';
import {
  admin, parseBody, parseUuidParam, respondWithIdempotency, created, requireCap,
} from '../_shared/handler-helpers.ts';
import { requireCaller, type Caller } from '../_shared/tenant.ts';
import { assertRefInOrg } from '../_shared/crud.ts';
import { serveBundleWithGate } from '../_shared/bundleGate.ts';
import { FEATURE_FLAGS } from '../_shared/constants.ts';
import {
  WarehouseLocationSchema,
  WarehouseLocationCreateSchema,
  WarehouseLocationPatchSchema,
  type WarehouseLocation,
  BinStockLevelSchema,
  type BinStockLevel,
  PutawayTaskSchema,
  PutawayTaskCreateSchema,
  PutawayTaskPatchSchema,
  type PutawayTask,
} from '../_shared/types/wms.ts';

const BUNDLE = 'wms-api';

function nowIso(): string {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Loaders and parent-existence probes. Cross-tenant or soft-deleted rows
// resolve to NOT_FOUND 404, matching the three-pl-api / ops-api precedent.
// ---------------------------------------------------------------------------

async function loadWarehouseLocation(
  caller: Caller, id: string,
): Promise<WarehouseLocation> {
  const { data, error } = await admin()
    .from('warehouse_locations').select('*')
    .eq('org_id', caller.orgId).eq('id', id).is('deleted_at', null)
    .maybeSingle();
  if (error) throw internalError(BUNDLE, error);
  if (!data) throw new ApiError('NOT_FOUND', 404);
  return WarehouseLocationSchema.parse(data);
}

async function assertWarehouseLocationParent(
  caller: Caller, id: string,
): Promise<void> {
  const { data, error } = await admin().from('warehouse_locations').select('id')
    .eq('org_id', caller.orgId).eq('id', id).is('deleted_at', null).maybeSingle();
  if (error) throw internalError(BUNDLE, error);
  if (!data) throw new ApiError('NOT_FOUND', 404);
}

// bin_stock_levels is a read-only rollup (B2). No soft-delete column; a
// cross-tenant or missing id resolves to NOT_FOUND 404, matching the locations
// loader.
async function loadBinStockLevel(
  caller: Caller, id: string,
): Promise<BinStockLevel> {
  const { data, error } = await admin()
    .from('bin_stock_levels').select('*')
    .eq('org_id', caller.orgId).eq('id', id)
    .maybeSingle();
  if (error) throw internalError(BUNDLE, error);
  if (!data) throw new ApiError('NOT_FOUND', 404);
  return BinStockLevelSchema.parse(data);
}

async function loadPutawayTask(
  caller: Caller, id: string,
): Promise<PutawayTask> {
  const { data, error } = await admin()
    .from('putaway_tasks').select('*')
    .eq('org_id', caller.orgId).eq('id', id).is('deleted_at', null)
    .maybeSingle();
  if (error) throw internalError(BUNDLE, error);
  if (!data) throw new ApiError('NOT_FOUND', 404);
  return PutawayTaskSchema.parse(data);
}

async function assertPutawayTaskExists(
  caller: Caller, id: string,
): Promise<void> {
  const { data, error } = await admin().from('putaway_tasks').select('id')
    .eq('org_id', caller.orgId).eq('id', id).is('deleted_at', null).maybeSingle();
  if (error) throw internalError(BUNDLE, error);
  if (!data) throw new ApiError('NOT_FOUND', 404);
}

// Resolve a receiving_order's dock as the putaway source when the create omits
// source_location_id and points at a receiving_order. Org-scoped admin read; a
// cross-tenant or missing order is rejected upstream by assertRefInOrg, so this
// returns the dock (or null when the order has no dock).
async function dockForReceivingOrder(
  caller: Caller, receivingOrderId: string,
): Promise<string | null> {
  const { data, error } = await admin().from('receiving_orders')
    .select('dock_location_id')
    .eq('org_id', caller.orgId).eq('id', receivingOrderId)
    .maybeSingle();
  if (error) throw internalError(BUNDLE, error);
  return (data?.dock_location_id as string | null) ?? null;
}

// Cross-warehouse location guard. A putaway task in warehouse A must not carry a
// dock / bin that physically lives in warehouse B: that would upsert a
// bin_stock_levels row under the wrong warehouse when the task completes.
// Org-scoped admin read of warehouse_locations; a cross-tenant or missing row,
// OR a row whose warehouse_id does not match, resolves to NOT_FOUND 404 (never
// 403, so no cross-warehouse existence oracle leaks). Models ops-api 0108
// assertDockInWarehouse.
async function assertLocationInWarehouse(
  caller: Caller, locationId: string, warehouseId: string,
): Promise<void> {
  const { data, error } = await admin()
    .from('warehouse_locations')
    .select('warehouse_id')
    .eq('org_id', caller.orgId).eq('id', locationId).is('deleted_at', null)
    .maybeSingle();
  if (error) throw internalError(BUNDLE, error);
  if (!data || (data as { warehouse_id: string }).warehouse_id !== warehouseId) {
    throw new ApiError('NOT_FOUND', 404, 'location not found in this warehouse');
  }
}

// ---------------------------------------------------------------------------
// Route table
// ---------------------------------------------------------------------------

const TABLE: Route[] = [
  // -------------------------------------------------------------------------
  // warehouse_locations (parent; config table, active flag, no rich FSM)
  // -------------------------------------------------------------------------
  {
    method: 'GET', path: '/locations',
    handler: async ({ req, url }) => {
      const caller = requireCaller(req);
      const warehouseId = url.searchParams.get('warehouse_id');
      const locationType = url.searchParams.get('location_type');
      const parentLocationId = url.searchParams.get('parent_location_id');
      const activeParam = url.searchParams.get('active');
      let q = admin()
        .from('warehouse_locations').select('*')
        .eq('org_id', caller.orgId).is('deleted_at', null)
        .order('code', { ascending: true }).limit(500);
      if (warehouseId) q = q.eq('warehouse_id', warehouseId);
      if (locationType) q = q.eq('location_type', locationType);
      if (parentLocationId) q = q.eq('parent_location_id', parentLocationId);
      if (activeParam === 'true') q = q.eq('active', true);
      if (activeParam === 'false') q = q.eq('active', false);
      const { data, error } = await q;
      if (error) throw internalError(BUNDLE, error);
      return ok((data ?? []).map((r) => WarehouseLocationSchema.parse(r)));
    },
  },
  {
    method: 'POST', path: '/locations',
    handler: async ({ req }) => {
      const caller = requireCaller(req);
      requireCap(caller, 'wms.location.create');
      const body = await parseBody(req, WarehouseLocationCreateSchema);
      return respondWithIdempotency(req, caller, BUNDLE, '/locations', body, async () => {
        // warehouse_id is REQUIRED and must exist in-org; a cross-tenant or
        // missing warehouse resolves to NOT_FOUND 404 (never 403).
        await assertRefInOrg('warehouses', caller, body.warehouse_id);
        // parent_location_id is an optional in-org self-ref; validate when set.
        if (body.parent_location_id) {
          await assertRefInOrg('warehouse_locations', caller, body.parent_location_id);
        }
        const insert: Record<string, unknown> = {
          org_id: caller.orgId,
          warehouse_id: body.warehouse_id,
          code: body.code,
          location_type: body.location_type,
          parent_location_id: body.parent_location_id ?? null,
          attributes: body.attributes ?? {},
          active: body.active ?? true,
          notes: body.notes ?? null,
          created_by: caller.userId,
          updated_by: caller.userId,
        };
        const { data, error } = await admin().from('warehouse_locations')
          .insert(insert).select('*').single();
        if (error) throw internalError(BUNDLE, error);
        return created(WarehouseLocationSchema.parse(data));
      });
    },
  },
  {
    method: 'GET', path: '/locations/:id',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      parseUuidParam(params.id);
      const row = await loadWarehouseLocation(caller, params.id);
      return ok(row);
    },
  },
  {
    method: 'PATCH', path: '/locations/:id',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      requireCap(caller, 'wms.location.update');
      parseUuidParam(params.id);
      const body = await parseBody(req, WarehouseLocationPatchSchema);
      return respondWithIdempotency(req, caller, BUNDLE, '/locations/:id', body, async () => {
        await assertWarehouseLocationParent(caller, params.id);
        if (body.warehouse_id) {
          await assertRefInOrg('warehouses', caller, body.warehouse_id);
        }
        if (body.parent_location_id) {
          await assertRefInOrg('warehouse_locations', caller, body.parent_location_id);
        }
        // active is set via the deactivate route, not here.
        const patch: Record<string, unknown> = {
          updated_by: caller.userId,
          updated_at: nowIso(),
        };
        if (body.warehouse_id !== undefined) patch.warehouse_id = body.warehouse_id;
        if (body.code !== undefined) patch.code = body.code;
        if (body.location_type !== undefined) patch.location_type = body.location_type;
        if (body.parent_location_id !== undefined) patch.parent_location_id = body.parent_location_id;
        if (body.attributes !== undefined) patch.attributes = body.attributes;
        if (body.notes !== undefined) patch.notes = body.notes;
        const { data, error } = await admin().from('warehouse_locations')
          .update(patch)
          .eq('org_id', caller.orgId).eq('id', params.id).is('deleted_at', null)
          .select('*').maybeSingle();
        if (error) throw internalError(BUNDLE, error);
        if (!data) throw new ApiError('NOT_FOUND', 404);
        return ok(WarehouseLocationSchema.parse(data));
      });
    },
  },
  {
    method: 'DELETE', path: '/locations/:id',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      // No dedicated wms.location.delete cap; reuse wms.location.update (same
      // role gate the dedicated cap would have granted), matching the accounts
      // soft-delete precedent.
      requireCap(caller, 'wms.location.update');
      parseUuidParam(params.id);
      return respondWithIdempotency(req, caller, BUNDLE, '/locations/:id-delete', null, async () => {
        await assertWarehouseLocationParent(caller, params.id);
        const { data, error } = await admin().from('warehouse_locations')
          .update({
            deleted_at: nowIso(),
            updated_by: caller.userId,
            updated_at: nowIso(),
          })
          .eq('org_id', caller.orgId).eq('id', params.id).is('deleted_at', null)
          .select('id').maybeSingle();
        if (error) throw internalError(BUNDLE, error);
        if (!data) throw new ApiError('NOT_FOUND', 404);
        return ok({ id: params.id, deleted: true });
      });
    },
  },
  {
    method: 'POST', path: '/locations/:id/deactivate',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      requireCap(caller, 'wms.location.deactivate');
      parseUuidParam(params.id);
      return respondWithIdempotency(req, caller, BUNDLE, '/locations/:id/deactivate', null, async () => {
        await assertWarehouseLocationParent(caller, params.id);
        const ts = nowIso();
        const { data, error } = await admin().from('warehouse_locations')
          .update({ active: false, updated_by: caller.userId, updated_at: ts })
          .eq('org_id', caller.orgId).eq('id', params.id).is('deleted_at', null)
          .select('*').maybeSingle();
        if (error) throw internalError(BUNDLE, error);
        if (!data) throw new ApiError('NOT_FOUND', 404);
        return ok(WarehouseLocationSchema.parse(data));
      });
    },
  },
  // -------------------------------------------------------------------------
  // bin_stock_levels (B2; read-only rollup, no write path). Maintained by the
  // recompute_bin_stock_level trigger off the append-only ledger. Reads are
  // cap-gated (wms.bin_stock.read) and org-scoped; no idempotency wrapper (GET).
  // -------------------------------------------------------------------------
  {
    method: 'GET', path: '/bin-stock',
    handler: async ({ req, url }) => {
      const caller = requireCaller(req);
      requireCap(caller, 'wms.bin_stock.read');
      const warehouseId = url.searchParams.get('warehouse_id');
      const itemId = url.searchParams.get('item_id');
      const locationId = url.searchParams.get('location_id');
      let q = admin()
        .from('bin_stock_levels').select('*')
        .eq('org_id', caller.orgId)
        .order('updated_at', { ascending: false }).limit(500);
      if (warehouseId) q = q.eq('warehouse_id', warehouseId);
      if (itemId) q = q.eq('item_id', itemId);
      if (locationId) q = q.eq('location_id', locationId);
      const { data, error } = await q;
      if (error) throw internalError(BUNDLE, error);
      return ok((data ?? []).map((r) => BinStockLevelSchema.parse(r)));
    },
  },
  {
    method: 'GET', path: '/bin-stock/:id',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      requireCap(caller, 'wms.bin_stock.read');
      parseUuidParam(params.id);
      const row = await loadBinStockLevel(caller, params.id);
      return ok(row);
    },
  },
  // -------------------------------------------------------------------------
  // putaway_tasks (B3; directed-move FSM). suggested -> in_progress -> done;
  // any non-done -> cancelled. Completing a task emits a warehouse-flat internal
  // move (transfer_out at the source dock + transfer_in at the destination bin)
  // via the complete_putaway_task RPC. Reads are RLS-only; writes are cap-gated.
  // -------------------------------------------------------------------------
  {
    method: 'GET', path: '/putaway',
    handler: async ({ req, url }) => {
      const caller = requireCaller(req);
      const status = url.searchParams.get('status');
      const warehouseId = url.searchParams.get('warehouse_id');
      let q = admin()
        .from('putaway_tasks').select('*')
        .eq('org_id', caller.orgId).is('deleted_at', null)
        .order('created_at', { ascending: false }).limit(500);
      if (status) q = q.eq('status', status);
      if (warehouseId) q = q.eq('warehouse_id', warehouseId);
      const { data, error } = await q;
      if (error) throw internalError(BUNDLE, error);
      return ok((data ?? []).map((r) => PutawayTaskSchema.parse(r)));
    },
  },
  {
    method: 'POST', path: '/putaway',
    handler: async ({ req }) => {
      const caller = requireCaller(req);
      requireCap(caller, 'wms.putaway.create');
      const body = await parseBody(req, PutawayTaskCreateSchema);
      return respondWithIdempotency(req, caller, BUNDLE, '/putaway', body, async () => {
        // lot_id is fail-closed until B4: no lots table exists yet, and a lot on
        // a putaway without lot capture at receive would skew the bin-lot grain.
        // The column stays in the schema as a forward-ref bare uuid, but no client
        // may set it in B3. B4 removes this guard when it wires lot capture.
        if (body.lot_id != null) {
          throw new ApiError('VALIDATION_ERROR', 422, 'lot capture is not available until WMS B4');
        }
        // warehouse_id and item_id are REQUIRED and must exist in-org; a
        // cross-tenant or missing ref resolves to NOT_FOUND 404 (never 403).
        await assertRefInOrg('warehouses', caller, body.warehouse_id);
        await assertRefInOrg('items', caller, body.item_id);
        // Location refs are optional in-org; validate each when set, AND assert
        // each lives in body.warehouse_id (a bin in another warehouse would
        // mis-file the bin row). assertLocationInWarehouse 404s on a cross-tenant,
        // missing, or cross-warehouse location, subsuming the in-org existence
        // check.
        if (body.suggested_location_id) {
          await assertLocationInWarehouse(caller, body.suggested_location_id, body.warehouse_id);
        }
        if (body.actual_location_id) {
          await assertLocationInWarehouse(caller, body.actual_location_id, body.warehouse_id);
        }
        // source_location_id: validate when supplied. Otherwise auto-fill from a
        // receiving_order's dock when the create references one.
        let sourceLocationId: string | null = body.source_location_id ?? null;
        if (sourceLocationId) {
          // supplied directly: assert same-warehouse below with the final value.
        } else if (
          body.source_entity_type === 'receiving_order' && body.source_entity_id
        ) {
          // The referenced receiving_order must exist in-org (404 otherwise);
          // then take its header dock as the putaway source.
          await assertRefInOrg('receiving_orders', caller, body.source_entity_id);
          sourceLocationId = await dockForReceivingOrder(caller, body.source_entity_id);
        }
        // Assert the FINAL resolved source (whether supplied or auto-filled from
        // the dock) lives in body.warehouse_id, so a task in warehouse A can never
        // carry a source dock from warehouse B.
        if (sourceLocationId) {
          await assertLocationInWarehouse(caller, sourceLocationId, body.warehouse_id);
        }
        const insert: Record<string, unknown> = {
          org_id: caller.orgId,
          warehouse_id: body.warehouse_id,
          item_id: body.item_id,
          quantity: body.quantity,
          source_location_id: sourceLocationId,
          suggested_location_id: body.suggested_location_id ?? null,
          actual_location_id: body.actual_location_id ?? null,
          lot_id: body.lot_id ?? null,
          license_plate_id: body.license_plate_id ?? null,
          source_entity_type: body.source_entity_type ?? null,
          source_entity_id: body.source_entity_id ?? null,
          notes: body.notes ?? null,
          created_by: caller.userId,
          updated_by: caller.userId,
        };
        const { data, error } = await admin().from('putaway_tasks')
          .insert(insert).select('*').single();
        if (error) throw internalError(BUNDLE, error);
        return created(PutawayTaskSchema.parse(data));
      });
    },
  },
  {
    method: 'GET', path: '/putaway/:id',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      parseUuidParam(params.id);
      const row = await loadPutawayTask(caller, params.id);
      return ok(row);
    },
  },
  {
    method: 'PATCH', path: '/putaway/:id',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      requireCap(caller, 'wms.putaway.create');
      parseUuidParam(params.id);
      const body = await parseBody(req, PutawayTaskPatchSchema);
      return respondWithIdempotency(req, caller, BUNDLE, '/putaway/:id', body, async () => {
        // Load the current row (404 cross-tenant / missing / soft-deleted) so we
        // can guard terminal state and resolve the effective warehouse for the
        // cross-warehouse location checks.
        const current = await loadPutawayTask(caller, params.id);
        // Terminal-state guard: a done or cancelled task has already posted (or
        // never will post) its immutable stock_movements; editing its
        // ledger-affecting fields (quantity, the location ids, lot_id) out from
        // under those rows is forbidden. 409 STATE_CONFLICT.
        if (current.status === 'done' || current.status === 'cancelled') {
          throw new ApiError(
            'STATE_CONFLICT', 409,
            `putaway task is ${current.status}; its fields can no longer be edited`,
          );
        }
        // lot_id is fail-closed until B4 (see POST /putaway). No client may set a
        // non-null lot_id in B3; B4 removes this guard when it wires lot capture.
        if (body.lot_id != null) {
          throw new ApiError('VALIDATION_ERROR', 422, 'lot capture is not available until WMS B4');
        }
        if (body.warehouse_id) {
          await assertRefInOrg('warehouses', caller, body.warehouse_id);
        }
        if (body.item_id) {
          await assertRefInOrg('items', caller, body.item_id);
        }
        // Cross-warehouse location guard. The effective warehouse is the patched
        // warehouse_id when present, else the current row's. Validate the EFFECTIVE
        // value (patched when the key is present, else the current row's) of each
        // location whenever that location changes OR the warehouse changes, so a
        // patch that only moves the warehouse cannot strand an existing bin in the
        // old warehouse (which would mis-file the bin row on complete). 404 on a
        // missing or cross-warehouse location.
        const effectiveWarehouseId = body.warehouse_id ?? current.warehouse_id;
        const warehouseChanged =
          body.warehouse_id !== undefined && body.warehouse_id !== current.warehouse_id;
        const effSource =
          body.source_location_id !== undefined ? body.source_location_id : current.source_location_id;
        const effSuggested =
          body.suggested_location_id !== undefined
            ? body.suggested_location_id
            : current.suggested_location_id;
        const effActual =
          body.actual_location_id !== undefined ? body.actual_location_id : current.actual_location_id;
        if ((body.source_location_id !== undefined || warehouseChanged) && effSource != null) {
          await assertLocationInWarehouse(caller, effSource, effectiveWarehouseId);
        }
        if ((body.suggested_location_id !== undefined || warehouseChanged) && effSuggested != null) {
          await assertLocationInWarehouse(caller, effSuggested, effectiveWarehouseId);
        }
        if ((body.actual_location_id !== undefined || warehouseChanged) && effActual != null) {
          await assertLocationInWarehouse(caller, effActual, effectiveWarehouseId);
        }
        // status moves via the start / complete / cancel routes, not here.
        const patch: Record<string, unknown> = {
          updated_by: caller.userId,
          updated_at: nowIso(),
        };
        if (body.warehouse_id !== undefined) patch.warehouse_id = body.warehouse_id;
        if (body.item_id !== undefined) patch.item_id = body.item_id;
        if (body.quantity !== undefined) patch.quantity = body.quantity;
        if (body.source_location_id !== undefined) patch.source_location_id = body.source_location_id;
        if (body.suggested_location_id !== undefined) patch.suggested_location_id = body.suggested_location_id;
        if (body.actual_location_id !== undefined) patch.actual_location_id = body.actual_location_id;
        if (body.lot_id !== undefined) patch.lot_id = body.lot_id;
        if (body.license_plate_id !== undefined) patch.license_plate_id = body.license_plate_id;
        if (body.source_entity_type !== undefined) patch.source_entity_type = body.source_entity_type;
        if (body.source_entity_id !== undefined) patch.source_entity_id = body.source_entity_id;
        if (body.notes !== undefined) patch.notes = body.notes;
        const { data, error } = await admin().from('putaway_tasks')
          .update(patch)
          .eq('org_id', caller.orgId).eq('id', params.id).is('deleted_at', null)
          .select('*').maybeSingle();
        if (error) throw internalError(BUNDLE, error);
        if (!data) throw new ApiError('NOT_FOUND', 404);
        return ok(PutawayTaskSchema.parse(data));
      });
    },
  },
  {
    method: 'DELETE', path: '/putaway/:id',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      // No dedicated wms.putaway.delete cap; reuse wms.putaway.create (same role
      // gate), matching the locations soft-delete precedent.
      requireCap(caller, 'wms.putaway.create');
      parseUuidParam(params.id);
      return respondWithIdempotency(req, caller, BUNDLE, '/putaway/:id-delete', null, async () => {
        await assertPutawayTaskExists(caller, params.id);
        const { data, error } = await admin().from('putaway_tasks')
          .update({
            deleted_at: nowIso(),
            updated_by: caller.userId,
            updated_at: nowIso(),
          })
          .eq('org_id', caller.orgId).eq('id', params.id).is('deleted_at', null)
          .select('id').maybeSingle();
        if (error) throw internalError(BUNDLE, error);
        if (!data) throw new ApiError('NOT_FOUND', 404);
        return ok({ id: params.id, deleted: true });
      });
    },
  },
  {
    method: 'POST', path: '/putaway/:id/start',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      requireCap(caller, 'wms.putaway.start');
      parseUuidParam(params.id);
      return respondWithIdempotency(req, caller, BUNDLE, '/putaway/:id/start', null, async () => {
        const { error } = await admin().rpc('start_putaway_task', {
          p_putaway_task_id: params.id, p_actor: caller.userId, p_caller_org_id: caller.orgId,
        });
        if (error) {
          if (/NOT_FOUND/.test(error.message)) throw new ApiError('NOT_FOUND', 404);
          if (/STATE_CONFLICT/.test(error.message)) throw new ApiError('STATE_CONFLICT', 409, error.message);
          throw internalError(BUNDLE, error);
        }
        return ok(await loadPutawayTask(caller, params.id));
      });
    },
  },
  {
    method: 'POST', path: '/putaway/:id/complete',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      requireCap(caller, 'wms.putaway.complete');
      parseUuidParam(params.id);
      return respondWithIdempotency(req, caller, BUNDLE, '/putaway/:id/complete', null, async () => {
        const { error } = await admin().rpc('complete_putaway_task', {
          p_putaway_task_id: params.id, p_actor: caller.userId, p_caller_org_id: caller.orgId,
        });
        if (error) {
          if (/NOT_FOUND/.test(error.message)) throw new ApiError('NOT_FOUND', 404);
          if (/STATE_CONFLICT/.test(error.message)) throw new ApiError('STATE_CONFLICT', 409, error.message);
          throw internalError(BUNDLE, error);
        }
        return ok(await loadPutawayTask(caller, params.id));
      });
    },
  },
  {
    method: 'POST', path: '/putaway/:id/cancel',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      requireCap(caller, 'wms.putaway.cancel');
      parseUuidParam(params.id);
      return respondWithIdempotency(req, caller, BUNDLE, '/putaway/:id/cancel', null, async () => {
        const { error } = await admin().rpc('cancel_putaway_task', {
          p_putaway_task_id: params.id, p_actor: caller.userId, p_caller_org_id: caller.orgId,
        });
        if (error) {
          if (/NOT_FOUND/.test(error.message)) throw new ApiError('NOT_FOUND', 404);
          if (/STATE_CONFLICT/.test(error.message)) throw new ApiError('STATE_CONFLICT', 409, error.message);
          throw internalError(BUNDLE, error);
        }
        return ok(await loadPutawayTask(caller, params.id));
      });
    },
  },
];

// ---------------------------------------------------------------------------
// Bundle-level dispatcher: gate on plugins.wms before any route runs.
// WMS is a single add-on, so use `flagKey` (one flag), not `flagKeys`.
// Shared with ops-api, quotes-api, projects-api, inventory-api,
// manufacturing-api via _shared/bundleGate.ts. Exactly one of
// flagKey / flagKeys is required or the gate fails closed to 404.
// ---------------------------------------------------------------------------

serveBundleWithGate({
  flagKey: FEATURE_FLAGS.PLUGINS_WMS,
  routes: TABLE,
  bundle: BUNDLE,
});
