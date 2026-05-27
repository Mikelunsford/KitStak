// inventory-api bundle.
//
// BUNDLE GATE: plugins.three_pl. The entire bundle returns 404 NOT_FOUND
// when the pillar plugin flag is off for the caller's org. Warehouses,
// stock levels, stock movements, and BOM items are all 3PL pillar
// surfaces. Per constitutional rule (CLAUDE.md): plugin bundle gates
// return 404, per-route feature flags return 403. Implementation lives
// in _shared/bundleGate.ts.
//
// Routes:
//   GET    /warehouses                list
//   POST   /warehouses                create
//   GET    /warehouses/:id            read
//   PATCH  /warehouses/:id            update
//   DELETE /warehouses/:id            soft-delete
//
//   GET    /stock-levels              read-only; filterable by warehouse, item
//   GET    /stock-movements           read-only ledger
//
//   GET    /bom-items                 list (optional ?parent_item_id=)
//   POST   /bom-items                 create
//   PATCH  /bom-items/:id             update
//   DELETE /bom-items/:id             delete
//
// stock_levels and stock_movements are read-only via constitutional design;
// movements are emitted by triggers in 0030/0032. No POST exposed.

import { z } from 'zod';
import { type Route } from '../_shared/route.ts';
import { serveBundleWithGate } from '../_shared/bundleGate.ts';
import { FEATURE_FLAGS } from '../_shared/constants.ts';
import {
  ApiError, ok, admin, parseBody, parseLimit, paginate, paginateByUpdatedAt,
  parseUuidParam, respondWithIdempotency, created,
  requireCaller, requireCap,
} from './shared.ts';
import {
  WarehouseSchema, StockLevelSchema, StockMovementSchema, BomItemSchema,
  type Warehouse,
} from '../_shared/types/vendors_inventory_ops.ts';

const WarehouseInput = z.object({
  code: z.string().min(1),
  display_name: z.string().min(1),
  is_default: z.boolean().default(false),
  address_line1: z.string().optional().nullable(),
  address_line2: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  region: z.string().optional().nullable(),
  postal_code: z.string().optional().nullable(),
  country_code: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  is_active: z.boolean().default(true),
});
const WarehouseUpdate = WarehouseInput.partial();

const BomInput = z.object({
  parent_item_id: z.string().uuid(),
  component_item_id: z.string().uuid(),
  quantity_per: z.union([z.number(), z.string()]).default(1),
  unit_of_measure: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  sort_order: z.number().int().default(0),
});
const BomUpdate = BomInput.partial();

const TABLE: Route[] = [
  // -------------------------------------------------------------- warehouses
  {
    method: 'GET', path: '/warehouses',
    handler: async ({ req, url }) => {
      const caller = requireCaller(req);
      requireCap(caller, 'warehouses.warehouse.read');
      const limit = parseLimit(url);
      const { data, error } = await admin()
        .from('warehouses').select('*')
        .eq('org_id', caller.orgId)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(limit + 1);
      if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
      const parsed = (data ?? []).map((r) => WarehouseSchema.parse(r)) as Array<Warehouse>;
      return ok(paginate(parsed, limit));
    },
  },
  {
    method: 'POST', path: '/warehouses',
    handler: async ({ req }) => {
      const caller = requireCaller(req);
      requireCap(caller, 'warehouses.warehouse.create');
      const body = await parseBody(req, WarehouseInput);
      return respondWithIdempotency(req, caller, 'inventory-api', '/warehouses', body, async () => {
        const { data, error } = await admin()
          .from('warehouses')
          .insert({
            ...body, org_id: caller.orgId,
            created_by: caller.userId, updated_by: caller.userId,
          })
          .select('*').single();
        if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
        return created(WarehouseSchema.parse(data));
      });
    },
  },
  {
    method: 'GET', path: '/warehouses/:id',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      requireCap(caller, 'warehouses.warehouse.read');
      parseUuidParam(params.id);
      const { data, error } = await admin()
        .from('warehouses').select('*')
        .eq('org_id', caller.orgId).eq('id', params.id).is('deleted_at', null)
        .maybeSingle();
      if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
      if (!data) throw new ApiError('NOT_FOUND', 404);
      return ok(WarehouseSchema.parse(data));
    },
  },
  {
    method: 'PATCH', path: '/warehouses/:id',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      requireCap(caller, 'warehouses.warehouse.update');
      parseUuidParam(params.id);
      const body = await parseBody(req, WarehouseUpdate);
      return respondWithIdempotency(req, caller, 'inventory-api', '/warehouses/:id', body, async () => {
        const { data, error } = await admin()
          .from('warehouses')
          .update({ ...body, updated_by: caller.userId, updated_at: new Date().toISOString() })
          .eq('org_id', caller.orgId).eq('id', params.id).is('deleted_at', null)
          .select('*').maybeSingle();
        if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
        if (!data) throw new ApiError('NOT_FOUND', 404);
        return ok(WarehouseSchema.parse(data));
      });
    },
  },
  {
    method: 'DELETE', path: '/warehouses/:id',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      requireCap(caller, 'warehouses.warehouse.delete');
      parseUuidParam(params.id);
      return respondWithIdempotency(req, caller, 'inventory-api', '/warehouses/:id', null, async () => {
        const { error } = await admin()
          .from('warehouses')
          .update({ deleted_at: new Date().toISOString(), updated_by: caller.userId })
          .eq('org_id', caller.orgId).eq('id', params.id);
        if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
        return ok({ id: params.id, deleted: true });
      });
    },
  },
  // -------------------------------------------------------------- stock_levels
  {
    method: 'GET', path: '/stock-levels',
    handler: async ({ req, url }) => {
      const caller = requireCaller(req);
      requireCap(caller, 'stock.level.read');
      const limit = parseLimit(url);
      let q = admin()
        .from('stock_levels').select('*')
        .eq('org_id', caller.orgId)
        .order('updated_at', { ascending: false })
        .limit(limit + 1);
      const wh = url.searchParams.get('warehouse_id');
      if (wh) q = q.eq('warehouse_id', wh);
      const item = url.searchParams.get('item_id');
      if (item) q = q.eq('item_id', item);
      const { data, error } = await q;
      if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
      const parsed = (data ?? []).map((r) => StockLevelSchema.parse(r));
      return ok(paginateByUpdatedAt(parsed, limit));
    },
  },
  // -------------------------------------------------------------- stock_movements
  {
    method: 'GET', path: '/stock-movements',
    handler: async ({ req, url }) => {
      const caller = requireCaller(req);
      requireCap(caller, 'stock.movement.read');
      let q = admin()
        .from('stock_movements').select('*')
        .eq('org_id', caller.orgId)
        .order('occurred_at', { ascending: false })
        .limit(200);
      const wh = url.searchParams.get('warehouse_id');
      if (wh) q = q.eq('warehouse_id', wh);
      const item = url.searchParams.get('item_id');
      if (item) q = q.eq('item_id', item);
      const { data, error } = await q;
      if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
      return ok((data ?? []).map((r) => StockMovementSchema.parse(r)));
    },
  },
  // -------------------------------------------------------------- bom_items
  {
    method: 'GET', path: '/bom-items',
    handler: async ({ req, url }) => {
      const caller = requireCaller(req);
      requireCap(caller, 'stock.bom.read');
      const limit = parseLimit(url);
      let q = admin()
        .from('bom_items').select('*')
        .eq('org_id', caller.orgId)
        .order('created_at', { ascending: false })
        .limit(limit + 1);
      const pid = url.searchParams.get('parent_item_id');
      if (pid) q = q.eq('parent_item_id', pid);
      const { data, error } = await q;
      if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
      const parsed = (data ?? []).map((r) => BomItemSchema.parse(r));
      return ok(paginate(parsed, limit));
    },
  },
  {
    method: 'POST', path: '/bom-items',
    handler: async ({ req }) => {
      const caller = requireCaller(req);
      requireCap(caller, 'stock.bom.write');
      const body = await parseBody(req, BomInput);
      return respondWithIdempotency(req, caller, 'inventory-api', '/bom-items', body, async () => {
        const { data, error } = await admin()
          .from('bom_items')
          .insert({ ...body, org_id: caller.orgId, created_by: caller.userId, updated_by: caller.userId })
          .select('*').single();
        if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
        return created(BomItemSchema.parse(data));
      });
    },
  },
  {
    method: 'PATCH', path: '/bom-items/:id',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      requireCap(caller, 'stock.bom.write');
      parseUuidParam(params.id);
      const body = await parseBody(req, BomUpdate);
      return respondWithIdempotency(req, caller, 'inventory-api', '/bom-items/:id', body, async () => {
        const { data, error } = await admin()
          .from('bom_items')
          .update({ ...body, updated_by: caller.userId, updated_at: new Date().toISOString() })
          .eq('org_id', caller.orgId).eq('id', params.id)
          .select('*').maybeSingle();
        if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
        if (!data) throw new ApiError('NOT_FOUND', 404);
        return ok(BomItemSchema.parse(data));
      });
    },
  },
  {
    method: 'DELETE', path: '/bom-items/:id',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      requireCap(caller, 'stock.bom.write');
      parseUuidParam(params.id);
      return respondWithIdempotency(req, caller, 'inventory-api', '/bom-items/:id', null, async () => {
        const { error } = await admin()
          .from('bom_items').delete()
          .eq('org_id', caller.orgId).eq('id', params.id);
        if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
        return ok({ id: params.id, deleted: true });
      });
    },
  },
];

serveBundleWithGate({
  flagKey: FEATURE_FLAGS.PLUGINS_THREE_PL,
  routes: TABLE,
  bundle: 'inventory-api',
});
