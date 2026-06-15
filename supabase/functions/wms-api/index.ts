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
//
// bin_stock_levels (B2) is a read-only rollup maintained by the
// recompute_bin_stock_level trigger; its GETs require wms.bin_stock.read and
// have no write path. B3 (putaway) and B4 (lots) add their routes per phase.

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
