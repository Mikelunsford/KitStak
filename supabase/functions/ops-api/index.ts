// ops-api bundle.
//
// BUNDLE GATE: plugins.three_pl. Constitutional rule (AUDIT.md / 00-canon):
//   Bundle gate off  -> every route returns 404 NOT_FOUND envelope.
//   Per-route flag   -> 403 FEATURE_DISABLED with details.flag. (Not used here.)
//
// The gate fires BEFORE the route table so even a caller hitting an unknown
// path gets 404. Callers without an org claim land in the standard
// UNAUTHORIZED / NO_ACTIVE_ORG envelopes; we only reach the flag read once
// the caller resolves.
//
// Routes (when plugins.three_pl is enabled for the caller's org):
//   GET    /receiving-orders                 list
//   POST   /receiving-orders                 create
//   GET    /receiving-orders/:id             read
//   PATCH  /receiving-orders/:id             update
//   POST   /receiving-orders/:id/transition  state transition
//   POST   /receiving-orders/:id/receive     complete (->received) + payload
//   GET    /receiving-orders/:id/line-items                 list lines
//   POST   /receiving-orders/:id/line-items                 add line
//   PATCH  /receiving-orders/:id/line-items/:lineId         update line
//   DELETE /receiving-orders/:id/line-items/:lineId         delete line
//
//   GET    /production-runs                  list
//   POST   /production-runs                  create
//   GET    /production-runs/:id              read
//   PATCH  /production-runs/:id              update
//   POST   /production-runs/:id/start        -> in_progress
//   POST   /production-runs/:id/complete     -> completed
//
//   GET    /shipments                        list
//   POST   /shipments                        create
//   GET    /shipments/:id                    read
//   PATCH  /shipments/:id                    update
//   POST   /shipments/:id/transition         state transition
//   POST   /shipments/:id/ship               -> shipped
//   GET    /shipments/:id/line-items                 list lines
//   POST   /shipments/:id/line-items                 add line
//   PATCH  /shipments/:id/line-items/:lineId         update line
//   DELETE /shipments/:id/line-items/:lineId         delete line

import { z } from 'zod';

import { type Route } from '../_shared/route.ts';
import { ApiError, ok, internalError } from '../_shared/responses.ts';
import {
  admin, parseBody, parseUuidParam, respondWithIdempotency, created, requireCap,
} from '../_shared/handler-helpers.ts';
import { assertRefInOrg, assertLotForItem } from '../_shared/crud.ts';
import { requireCaller, type Caller } from '../_shared/tenant.ts';
import { serveBundleWithGate } from '../_shared/bundleGate.ts';
import { getFlag } from '../_shared/feature-flags.ts';
import { FEATURE_FLAGS } from '../_shared/constants.ts';
import {
  ReceivingOrderSchema, ReceivingOrderStatusSchema,
  ProductionRunSchema, ProductionRunStatusSchema,
  ShipmentSchema, ShipmentStatusSchema,
  ReceivingOrderLineSchema, ReceivingOrderPayloadSchema,
  ShipmentLineSchema, ShipmentPayloadSchema,
  ProductionRunConsumedLineSchema, ProductionRunProducedSchema,
  ProductionRunPayloadSchema,
  ReceivingOrderLineItemSchema, ReceivingOrderLineItemCreateSchema,
  ReceivingOrderLineItemUpdateSchema,
  ShipmentLineItemSchema, ShipmentLineItemCreateSchema,
  ShipmentLineItemUpdateSchema,
  type ReceivingOrder, type ProductionRun, type Shipment,
} from '../_shared/types/vendors_inventory_ops.ts';
import {
  RECEIVING_ORDER_FSM, PRODUCTION_RUN_FSM, SHIPMENT_FSM,
  canTransitionVio, type Fsm,
} from '../_shared/workflow/vendors_inventory_ops.ts';
import { nextDocNumber } from '../_shared/numbering.ts';

function assertTransition<S extends string>(fsm: Fsm<S>, from: S, to: S): void {
  if (!canTransitionVio(fsm, from, to)) {
    throw new ApiError('STATE_CONFLICT', 409, `illegal ${fsm.entity} transition: ${from} -> ${to}`);
  }
}

async function loadOrgScoped<T>(table: string, caller: Caller, id: string): Promise<T> {
  const { data, error } = await admin()
    .from(table).select('*')
    .eq('org_id', caller.orgId).eq('id', id).is('deleted_at', null)
    .maybeSingle();
  if (error) throw internalError('ops-api', error);
  if (!data) throw new ApiError('NOT_FOUND', 404);
  return data as T;
}

// ---------------------------------------------------------------------------
// WMS receiving-to-dock guard (F-Wave12-WMS-RECEIVE-DOCK-01).
//
// The dock (warehouse_locations) is accepted on EXACTLY ONE path: the
// /transition handler, and only when to === 'received', and only when the
// caller's org has plugins.wms ON. assertRefInOrg already 404s a cross-tenant
// dock id; this additionally enforces the CROSS-WAREHOUSE rule: the chosen dock
// must live in the SAME warehouse as the receiving order, or the
// receipt-emitting trigger would file the bin row under the wrong warehouse (the
// bin recompute keys on stock_movements.warehouse_id, which the trigger sets
// from the receiving order's warehouse_id, not the dock's).
//
// A mismatch returns 404 NOT_FOUND, the constitutional answer for an
// out-of-scope reference on a write (never 403). It is the same envelope
// assertRefInOrg uses for a cross-tenant id, and it leaks no oracle: the dock
// simply "does not exist" for this receiving order's warehouse.
// ---------------------------------------------------------------------------
async function assertDockInWarehouse(
  caller: Caller,
  dockLocationId: string,
  warehouseId: string,
): Promise<void> {
  // Org scoping first: a cross-tenant dock id 404s here, matching the
  // warehouse_id / vendor_id / project_id convention.
  await assertRefInOrg('warehouse_locations', caller, dockLocationId);
  // active = true matches the SPA picker filter: an inactive (but not deleted)
  // dock is not a valid putaway target, so it 404s like a deleted one rather
  // than landing stock in a deactivated location.
  const { data, error } = await admin()
    .from('warehouse_locations')
    .select('warehouse_id')
    .eq('org_id', caller.orgId)
    .eq('id', dockLocationId)
    .eq('active', true)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw internalError('ops-api', error);
  if (!data || (data as { warehouse_id: string }).warehouse_id !== warehouseId) {
    throw new ApiError('NOT_FOUND', 404, 'dock location not found in this warehouse');
  }
}

// ---------------------------------------------------------------------------
// Zod inputs
// ---------------------------------------------------------------------------

// F-Wave7-LINEFORM-VALIDATE-01: payload.lines (and consumed/produced) are
// validated at the API boundary using shared line schemas from
// _shared/types/vendors_inventory_ops.ts. A POST/PATCH that carries a line
// with a missing or non-UUID item_id now returns 422 VALIDATION_ERROR with
// structured fieldErrors instead of a silently trigger-skipped row.

const ReceivingCreate = z.object({
  warehouse_id: z.string().uuid(),
  purchase_order_id: z.string().uuid().optional().nullable(),
  vendor_id: z.string().uuid().optional().nullable(),
  // UX-Q6: project linkage. Column + FK + ON DELETE SET NULL live in
  // migrations 0046 + 0061. RLS Pattern A on receiving_orders applies;
  // the projects FK is validated by Postgres before the row lands so a
  // cross-tenant project_id 404s naturally (the projects row is invisible
  // under the caller's org gate, so the FK lookup fails).
  project_id: z.string().uuid().optional().nullable(),
  receiving_number: z.string().optional().nullable(),
  expected_date: z.string().optional().nullable(),
  reference: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  payload: ReceivingOrderPayloadSchema.default({}),
});
const ReceivingUpdate = ReceivingCreate.partial();
const ReceivingTransition = z.object({
  to: ReceivingOrderStatusSchema,
  // WMS receiving-to-dock PRIMARY picker (F-Wave12-WMS-RECEIVE-DOCK-01): the
  // single dock / staging selector. It is honoured by the handler ONLY when
  // to === 'received' AND the caller's org has plugins.wms ON, where it rides
  // the SAME UPDATE that flips status -> received so the AFTER UPDATE OF status
  // receipt-emitting trigger sees new.dock_location_id and stamps it onto every
  // emitted movement. On any other transition, or with plugins.wms OFF, the
  // value is ignored and the dock is forced to NULL (server-authority no-op).
  dock_location_id: z.string().uuid().nullable().optional(),
});
const ReceivingReceive = z.object({
  received_date: z.string().optional(),
  lines: z.array(ReceivingOrderLineSchema).default([]),
});

const ProductionCreate = z.object({
  warehouse_id: z.string().uuid(),
  output_item_id: z.string().uuid(),
  run_number: z.string().optional().nullable(),
  quantity_planned: z.union([z.number(), z.string()]).default(0),
  scheduled_for: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  payload: ProductionRunPayloadSchema.default({}),
});
const ProductionUpdate = ProductionCreate.partial();
const ProductionComplete = z.object({
  quantity_produced: z.union([z.number(), z.string()]),
  consumed: z.array(ProductionRunConsumedLineSchema).default([]),
  produced: ProductionRunProducedSchema.optional(),
});

const ShipmentCreate = z.object({
  warehouse_id: z.string().uuid(),
  customer_id: z.string().uuid().optional().nullable(),
  sales_order_id: z.string().uuid().optional().nullable(),
  // F-Wave9-AUDIT-V3-WAVE-C2-01: project linkage. Column landed in
  // migration 0046 (G-SHIP-FK-01) and was re-declared by 0063 for parity
  // with manufacturing_runs. Optional + nullable; cross-tenant project_id
  // writes still 404 at the projects RLS gate (Pattern A).
  project_id: z.string().uuid().optional().nullable(),
  shipment_number: z.string().optional().nullable(),
  ship_date: z.string().optional().nullable(),
  carrier: z.string().optional().nullable(),
  tracking_number: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  payload: ShipmentPayloadSchema.default({}),
});
const ShipmentUpdate = ShipmentCreate.partial();
const ShipmentTransition = z.object({ to: ShipmentStatusSchema });
const ShipmentShip = z.object({
  ship_date: z.string().optional(),
  carrier: z.string().optional().nullable(),
  tracking_number: z.string().optional().nullable(),
  lines: z.array(ShipmentLineSchema).default([]),
});

// ---------------------------------------------------------------------------
// F-Wave7-LINES-01 + F-Wave7-LINES-DUAL-WRITE-DROP-01: receiving + shipment
// line items live in their own normalised tables. The parent's payload.lines
// JSON mirror is NO LONGER maintained by these handlers.
//
// Step 1 (migration 0050) added the normalised tables and the handler
// dual-wrote both. Step 2 (migration 0051) redirected the emit_movements
// trigger functions for receiving_orders and shipments to read from the
// normalised tables instead of payload.lines. With the read side moved, the
// line-item POST/PATCH/DELETE handlers stopped maintaining payload.lines.
// R-W13-DB-01 finishes the dual-write drop: the /receive and /ship action
// RPCs were still merging body.lines into payload.lines on the terminal
// transition; that write is now removed too, so no handler maintains the
// mirror. The payload.lines JSON column is left in place because the
// multi-stage drop rule defers the column drop to a separate forward
// migration (F-Wave7-LINES-PAYLOAD-DROP-01), which also drops the `lines`
// body param from the receive / ship RPCs.
//
// Production runs are deliberately excluded from this step. The third
// emit_movements trigger (tg_production_runs_emit_movements) still reads
// from payload.lines on production_runs; its handler-side normalisation is
// tracked separately as F-Wave7-PRODUCTION-LINES-NORMALIZE-01.
// ---------------------------------------------------------------------------

async function assertReceivingParent(caller: Caller, id: string): Promise<void> {
  const { data, error } = await admin().from('receiving_orders').select('id')
    .eq('org_id', caller.orgId).eq('id', id).is('deleted_at', null).maybeSingle();
  if (error) throw internalError('ops-api', error);
  if (!data) throw new ApiError('NOT_FOUND', 404);
}

// Snapshot a receiving line's current item_id and lot_id, org-scoped (404
// cross-tenant / missing / wrong parent). Used by the line PATCH to anchor the
// cross-item lot guard against the EFFECTIVE item and lot when the patch omits
// one side.
async function receivingLineSnapshot(
  caller: Caller, receivingOrderId: string, lineId: string,
): Promise<{ item_id: string; lot_id: string | null }> {
  const { data, error } = await admin().from('receiving_order_line_items')
    .select('item_id, lot_id')
    .eq('org_id', caller.orgId)
    .eq('receiving_order_id', receivingOrderId)
    .eq('id', lineId)
    .maybeSingle();
  if (error) throw internalError('ops-api', error);
  if (!data) throw new ApiError('NOT_FOUND', 404);
  return data as { item_id: string; lot_id: string | null };
}

async function assertShipmentParent(caller: Caller, id: string): Promise<void> {
  const { data, error } = await admin().from('shipments').select('id')
    .eq('org_id', caller.orgId).eq('id', id).is('deleted_at', null).maybeSingle();
  if (error) throw internalError('ops-api', error);
  if (!data) throw new ApiError('NOT_FOUND', 404);
}

async function nextPositionFor(
  table: 'receiving_order_line_items' | 'shipment_line_items',
  parentColumn: 'receiving_order_id' | 'shipment_id',
  caller: Caller, parentId: string,
): Promise<number> {
  const { data, error } = await admin().from(table)
    .select('position')
    .eq('org_id', caller.orgId)
    .eq(parentColumn, parentId)
    .order('position', { ascending: false }).limit(1).maybeSingle();
  if (error) throw internalError('ops-api', error);
  return ((data?.position as number | undefined) ?? -1) + 1;
}

// ---------------------------------------------------------------------------
// Route table
// ---------------------------------------------------------------------------

const TABLE: Route[] = [
  // receiving_orders
  {
    method: 'GET', path: '/receiving-orders',
    handler: async ({ req, url }) => {
      const caller = requireCaller(req);
      requireCap(caller, 'receiving.order.read');
      // F-Wave7-LISTFILTER-01: vendor_id FK filter lifts VendorDetailPage
      // client-side .filter(...) into a SQL where-clause. RLS Pattern A
      // wraps the org gate so a cross-tenant vendor_id still 200 + [].
      //
      // UX-Q6: project_id filter added so ProjectDetailPage can ask the
      // server for only receiving orders bound to a given project instead
      // of fetching the whole list and filtering client-side. The
      // receiving_orders_project_id_idx (0061) covers this lookup.
      const vendorId = url.searchParams.get('vendor_id');
      const projectId = url.searchParams.get('project_id');
      let q = admin()
        .from('receiving_orders').select('*')
        .eq('org_id', caller.orgId).is('deleted_at', null)
        .order('created_at', { ascending: false }).limit(200);
      if (vendorId) q = q.eq('vendor_id', vendorId);
      if (projectId) q = q.eq('project_id', projectId);
      const { data, error } = await q;
      if (error) throw internalError('ops-api', error);
      return ok((data ?? []).map((r) => ReceivingOrderSchema.parse(r)));
    },
  },
  {
    method: 'POST', path: '/receiving-orders',
    handler: async ({ req }) => {
      const caller = requireCaller(req);
      requireCap(caller, 'receiving.order.create');
      const body = await parseBody(req, ReceivingCreate);
      return respondWithIdempotency(req, caller, 'ops-api', '/receiving-orders', body, async () => {
        // Cross-tenant FK guard: every client-supplied reference must belong to
        // the caller's org. assertRefInOrg 404s on a cross-tenant id.
        await assertRefInOrg('warehouses', caller, body.warehouse_id);
        if (body.purchase_order_id) { await assertRefInOrg('purchase_orders', caller, body.purchase_order_id); }
        if (body.vendor_id) { await assertRefInOrg('vendors', caller, body.vendor_id); }
        if (body.project_id) { await assertRefInOrg('projects', caller, body.project_id); }
        // F-Wave9-AUTO-NUMBERING-01 (B8): operator may pass a `receiving_number`
        // to override; otherwise allocate the next RCV-YYYY-NNNNN via the
        // org-scoped numbering chassis (next_doc_number / 0038). Mirrors the
        // manufacturing-api pattern from 0054.
        const suppliedRecv = body.receiving_number?.trim();
        const receiving_number = suppliedRecv
          ? suppliedRecv
          : await nextDocNumber(caller.orgId, 'receiving_order');
        const { data, error } = await admin().from('receiving_orders').insert({
          ...body, receiving_number, status: 'created', org_id: caller.orgId,
          created_by: caller.userId, updated_by: caller.userId,
        }).select('*').single();
        if (error) throw internalError('ops-api', error);
        return created(ReceivingOrderSchema.parse(data));
      });
    },
  },
  {
    method: 'GET', path: '/receiving-orders/:id',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      requireCap(caller, 'receiving.order.read');
      parseUuidParam(params.id);
      const row = await loadOrgScoped<ReceivingOrder>('receiving_orders', caller, params.id);
      return ok(ReceivingOrderSchema.parse(row));
    },
  },
  {
    method: 'PATCH', path: '/receiving-orders/:id',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      requireCap(caller, 'receiving.order.update');
      parseUuidParam(params.id);
      const body = await parseBody(req, ReceivingUpdate);
      return respondWithIdempotency(req, caller, 'ops-api', '/receiving-orders/:id', body, async () => {
        // Cross-tenant FK guard on any client-supplied reference in this PATCH.
        if (body.warehouse_id) { await assertRefInOrg('warehouses', caller, body.warehouse_id); }
        if (body.purchase_order_id) { await assertRefInOrg('purchase_orders', caller, body.purchase_order_id); }
        if (body.vendor_id) { await assertRefInOrg('vendors', caller, body.vendor_id); }
        if (body.project_id) { await assertRefInOrg('projects', caller, body.project_id); }
        const { data, error } = await admin().from('receiving_orders')
          .update({ ...body, updated_by: caller.userId, updated_at: new Date().toISOString() })
          .eq('org_id', caller.orgId).eq('id', params.id).is('deleted_at', null)
          .select('*').maybeSingle();
        if (error) throw internalError('ops-api', error);
        if (!data) throw new ApiError('NOT_FOUND', 404);
        return ok(ReceivingOrderSchema.parse(data));
      });
    },
  },
  {
    method: 'POST', path: '/receiving-orders/:id/transition',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      requireCap(caller, 'receiving.order.update');
      parseUuidParam(params.id);
      const body = await parseBody(req, ReceivingTransition);
      return respondWithIdempotency(req, caller, 'ops-api', '/receiving-orders/:id/transition', body, async () => {
        const cur = await loadOrgScoped<ReceivingOrder>('receiving_orders', caller, params.id);
        assertTransition(RECEIVING_ORDER_FSM, cur.status, body.to);
        // B9 fix: the SPA detail page state-machine button POSTs to /transition
        // (not the dedicated /receive endpoint that stamps received_date). Stamp
        // received_date here when transitioning TO 'received' so the column is
        // populated atomically with the status change. Match the YYYY-MM-DD
        // date format used by /receive (received_date is a `date` column per
        // migration 0032_ops_receiving_production_shipments.sql).
        const updatePayload: Record<string, unknown> = {
          status: body.to,
          updated_by: caller.userId,
          updated_at: new Date().toISOString(),
        };
        if (body.to === 'received') {
          updatePayload.received_date = new Date().toISOString().slice(0, 10);
          // WMS receiving-to-dock (F-Wave12-WMS-RECEIVE-DOCK-01). The dock is
          // accepted ONLY here, ONLY on the transition to 'received', and ONLY
          // when the caller's org has plugins.wms ON. It rides this SAME UPDATE
          // so the AFTER UPDATE OF status receipt-emitting trigger (0108) sees
          // new.dock_location_id and stamps it onto every emitted movement.
          //
          // Server-authority no-op (constitution: the SPA hides buttons, the
          // server is authority). Read plugins.wms the same way the bundle gate
          // reads a plugin flag for the org: getFlag(orgId, flagKey).enabled,
          // memoized per (org_id, flag_key). When WMS is OFF we FORCE
          // dock_location_id to NULL in the update set regardless of what the
          // client sent, so a wms-off org can never land a dock even with a
          // valid same-warehouse warehouse_locations id. When WMS is ON and a
          // non-null dock is supplied, it must be org-scoped AND in this
          // receiving order's warehouse (cur.warehouse_id); a mismatch 404s.
          const wmsFlag = await getFlag(caller.orgId, FEATURE_FLAGS.PLUGINS_WMS);
          if (!wmsFlag.enabled) {
            // WMS OFF: hard NULL no-op. Whatever the client sent, the dock can
            // never land. This is the load-bearing server-authority fix.
            updatePayload.dock_location_id = null;
          } else if (body.dock_location_id !== undefined) {
            // WMS ON and the client expressed a dock (null clears it; a uuid is
            // validated org-scoped + same-warehouse, 404 on mismatch). An
            // undefined dock (no pick) leaves the existing header untouched.
            if (body.dock_location_id !== null) {
              await assertDockInWarehouse(caller, body.dock_location_id, cur.warehouse_id);
            }
            updatePayload.dock_location_id = body.dock_location_id;
          }
        }
        // R-W13-FIN-01: status-equals-from guard. cur.status was read above
        // (loadOrgScoped); carrying it into the UPDATE WHERE clause turns the
        // transition into a compare-and-set so two concurrent transitions off
        // the same status yield one win and one STATE_CONFLICT 409 instead of
        // a silent double-apply. maybeSingle keeps a 0-row result as null.
        const { data, error } = await admin().from('receiving_orders')
          .update(updatePayload)
          .eq('org_id', caller.orgId).eq('id', params.id)
          .eq('status', cur.status).select('*').maybeSingle();
        if (error) throw internalError('ops-api', error);
        if (!data) throw new ApiError('STATE_CONFLICT', 409, `receiving_order transition conflict from ${cur.status}`);
        return ok(ReceivingOrderSchema.parse(data));
      });
    },
  },
  {
    method: 'POST', path: '/receiving-orders/:id/receive',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      requireCap(caller, 'receiving.receive');
      parseUuidParam(params.id);
      const body = await parseBody(req, ReceivingReceive);
      return respondWithIdempotency(req, caller, 'ops-api', '/receiving-orders/:id/receive', body, async () => {
        const cur = await loadOrgScoped<ReceivingOrder>('receiving_orders', caller, params.id);
        assertTransition(RECEIVING_ORDER_FSM, cur.status, 'received');
        // R-W13-DB-01 (multi-stage drop, stage 1): stop dual-writing the
        // payload.lines JSON mirror. The receipt emit trigger
        // (tg_receiving_orders_emit_movements, migration 0051) now reads
        // exclusively from receiving_order_line_items, and the SPA detail
        // page reads lines via useReceivingOrderLineItems. No reader depends
        // on payload.lines, so the body.lines mirror write is removed here.
        // The payload.lines column itself stays for one more release per the
        // multi-stage drop rule (its drop is F-Wave7-LINES-PAYLOAD-DROP-01).
        // R-W13-FIN-01: status-equals-from guard on the terminal transition.
        const { data, error } = await admin().from('receiving_orders')
          .update({
            status: 'received',
            received_date: body.received_date ?? new Date().toISOString().slice(0, 10),
            updated_by: caller.userId,
            updated_at: new Date().toISOString(),
          })
          .eq('org_id', caller.orgId).eq('id', params.id)
          .eq('status', cur.status).select('*').maybeSingle();
        if (error) throw internalError('ops-api', error);
        if (!data) throw new ApiError('STATE_CONFLICT', 409, `receiving_order transition conflict from ${cur.status}`);
        return ok(ReceivingOrderSchema.parse(data));
      });
    },
  },

  // receiving_orders line items (F-Wave7-LINES-01)
  {
    method: 'GET', path: '/receiving-orders/:id/line-items',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      requireCap(caller, 'receiving.line_item.read');
      parseUuidParam(params.id);
      await assertReceivingParent(caller, params.id);
      const { data, error } = await admin()
        .from('receiving_order_line_items').select('*')
        .eq('org_id', caller.orgId)
        .eq('receiving_order_id', params.id)
        .order('position', { ascending: true });
      if (error) throw internalError('ops-api', error);
      return ok((data ?? []).map((r) => ReceivingOrderLineItemSchema.parse(r)));
    },
  },
  {
    method: 'POST', path: '/receiving-orders/:id/line-items',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      requireCap(caller, 'receiving.line_item.create');
      parseUuidParam(params.id);
      const body = await parseBody(req, ReceivingOrderLineItemCreateSchema);
      return respondWithIdempotency(
        req, caller, 'ops-api', '/receiving-orders/:id/line-items', body,
        async () => {
          await assertReceivingParent(caller, params.id);
          await assertRefInOrg('items', caller, body.item_id);
          // WMS Body B Phase B4: an optional lot on the received line. When set,
          // the lot must exist in-org AND be bound to THIS line's item
          // (lots.item_id NOT NULL). A lot for a different item is incoherent and
          // would credit a lot-keyed bin row for the wrong item, so it 404s
          // (assertLotForItem; never 403). The receipt emitter threads this lot
          // onto the spine ledger row so a lot-keyed bin row forms.
          if (body.lot_id) {
            await assertLotForItem(caller, body.lot_id, body.item_id);
          }
          const position = body.position ?? await nextPositionFor(
            'receiving_order_line_items', 'receiving_order_id', caller, params.id,
          );
          const insert = {
            org_id: caller.orgId,
            receiving_order_id: params.id,
            item_id: body.item_id,
            quantity: body.quantity,
            unit_cost_cents: body.unit_cost_cents ?? null,
            uom: body.uom ?? null,
            reference: body.reference ?? null,
            lot_id: body.lot_id ?? null,
            position,
            created_by: caller.userId,
            updated_by: caller.userId,
          };
          const { data, error } = await admin()
            .from('receiving_order_line_items').insert(insert)
            .select('*').single();
          if (error) throw internalError('ops-api', error);
          return created(ReceivingOrderLineItemSchema.parse(data));
        },
      );
    },
  },
  {
    method: 'PATCH', path: '/receiving-orders/:id/line-items/:lineId',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      requireCap(caller, 'receiving.line_item.update');
      parseUuidParam(params.id);
      parseUuidParam(params.lineId, 'lineId');
      const body = await parseBody(req, ReceivingOrderLineItemUpdateSchema);
      return respondWithIdempotency(
        req, caller, 'ops-api', '/receiving-orders/:id/line-items/:lineId', body,
        async () => {
          await assertReceivingParent(caller, params.id);
          if (body.item_id) { await assertRefInOrg('items', caller, body.item_id); }
          // WMS Body B Phase B4: an optional lot on the received line. The
          // EFFECTIVE lot must be bound to the EFFECTIVE item. Re-validate whenever
          // the lot changes OR the item changes on a lot-bearing line, so a patch
          // that only re-targets the item cannot leave a now-incoherent lot
          // attached (which the receipt emitter would then credit to the wrong
          // item). 404 on a missing, cross-tenant, or wrong-item lot; never 403.
          // The current snapshot is read only when a side is absent from the body.
          if (body.lot_id !== undefined || body.item_id !== undefined) {
            const cur = await receivingLineSnapshot(caller, params.id, params.lineId);
            const effItemId = body.item_id ?? cur.item_id;
            const effLotId = body.lot_id !== undefined ? body.lot_id : cur.lot_id;
            const itemChanged = body.item_id !== undefined && body.item_id !== cur.item_id;
            if ((body.lot_id !== undefined || itemChanged) && effLotId != null) {
              await assertLotForItem(caller, effLotId, effItemId);
            }
          }
          const patch: Record<string, unknown> = {
            updated_by: caller.userId,
          };
          if (body.item_id !== undefined) patch.item_id = body.item_id;
          if (body.quantity !== undefined) patch.quantity = body.quantity;
          if (body.unit_cost_cents !== undefined) patch.unit_cost_cents = body.unit_cost_cents;
          if (body.uom !== undefined) patch.uom = body.uom;
          if (body.reference !== undefined) patch.reference = body.reference;
          if (body.lot_id !== undefined) patch.lot_id = body.lot_id;
          if (body.position !== undefined) patch.position = body.position;
          const { data, error } = await admin().from('receiving_order_line_items')
            .update(patch)
            .eq('org_id', caller.orgId)
            .eq('receiving_order_id', params.id)
            .eq('id', params.lineId)
            .select('*').maybeSingle();
          if (error) throw internalError('ops-api', error);
          if (!data) throw new ApiError('NOT_FOUND', 404);
          return ok(ReceivingOrderLineItemSchema.parse(data));
        },
      );
    },
  },
  {
    method: 'DELETE', path: '/receiving-orders/:id/line-items/:lineId',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      requireCap(caller, 'receiving.line_item.delete');
      parseUuidParam(params.id);
      parseUuidParam(params.lineId, 'lineId');
      return respondWithIdempotency(
        req, caller, 'ops-api', '/receiving-orders/:id/line-items/:lineId-delete', null,
        async () => {
          await assertReceivingParent(caller, params.id);
          const { data, error } = await admin().from('receiving_order_line_items')
            .delete()
            .eq('org_id', caller.orgId)
            .eq('receiving_order_id', params.id)
            .eq('id', params.lineId)
            .select('id').maybeSingle();
          if (error) throw internalError('ops-api', error);
          if (!data) throw new ApiError('NOT_FOUND', 404);
          return ok({ id: params.lineId, deleted: true });
        },
      );
    },
  },

  // production_runs
  {
    method: 'GET', path: '/production-runs',
    handler: async ({ req }) => {
      const caller = requireCaller(req);
      requireCap(caller, 'production.run.read');
      const { data, error } = await admin().from('production_runs').select('*')
        .eq('org_id', caller.orgId).is('deleted_at', null)
        .order('created_at', { ascending: false }).limit(200);
      if (error) throw internalError('ops-api', error);
      return ok((data ?? []).map((r) => ProductionRunSchema.parse(r)));
    },
  },
  {
    method: 'POST', path: '/production-runs',
    handler: async ({ req }) => {
      const caller = requireCaller(req);
      requireCap(caller, 'production.run.create');
      const body = await parseBody(req, ProductionCreate);
      return respondWithIdempotency(req, caller, 'ops-api', '/production-runs', body, async () => {
        // Cross-tenant FK guard on client-supplied references.
        await assertRefInOrg('warehouses', caller, body.warehouse_id);
        await assertRefInOrg('items', caller, body.output_item_id);
        const { data, error } = await admin().from('production_runs').insert({
          ...body, status: 'planned', org_id: caller.orgId,
          created_by: caller.userId, updated_by: caller.userId,
        }).select('*').single();
        if (error) throw internalError('ops-api', error);
        return created(ProductionRunSchema.parse(data));
      });
    },
  },
  {
    method: 'GET', path: '/production-runs/:id',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      requireCap(caller, 'production.run.read');
      parseUuidParam(params.id);
      const row = await loadOrgScoped<ProductionRun>('production_runs', caller, params.id);
      return ok(ProductionRunSchema.parse(row));
    },
  },
  {
    method: 'PATCH', path: '/production-runs/:id',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      requireCap(caller, 'production.run.update');
      parseUuidParam(params.id);
      const body = await parseBody(req, ProductionUpdate);
      return respondWithIdempotency(req, caller, 'ops-api', '/production-runs/:id', body, async () => {
        // Cross-tenant FK guard on any client-supplied reference in this PATCH.
        if (body.warehouse_id) { await assertRefInOrg('warehouses', caller, body.warehouse_id); }
        if (body.output_item_id) { await assertRefInOrg('items', caller, body.output_item_id); }
        const { data, error } = await admin().from('production_runs')
          .update({ ...body, updated_by: caller.userId, updated_at: new Date().toISOString() })
          .eq('org_id', caller.orgId).eq('id', params.id).is('deleted_at', null)
          .select('*').maybeSingle();
        if (error) throw internalError('ops-api', error);
        if (!data) throw new ApiError('NOT_FOUND', 404);
        return ok(ProductionRunSchema.parse(data));
      });
    },
  },
  {
    method: 'POST', path: '/production-runs/:id/start',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      requireCap(caller, 'production.start');
      parseUuidParam(params.id);
      return respondWithIdempotency(req, caller, 'ops-api', '/production-runs/:id/start', null, async () => {
        const cur = await loadOrgScoped<ProductionRun>('production_runs', caller, params.id);
        assertTransition(PRODUCTION_RUN_FSM, cur.status, 'in_progress');
        // R-W13-FIN-01: status-equals-from guard. Concurrent starts off the
        // same status yield one win and one STATE_CONFLICT 409.
        const { data, error } = await admin().from('production_runs')
          .update({
            status: 'in_progress',
            started_at: new Date().toISOString(),
            updated_by: caller.userId,
            updated_at: new Date().toISOString(),
          })
          .eq('org_id', caller.orgId).eq('id', params.id)
          .eq('status', cur.status).select('*').maybeSingle();
        if (error) throw internalError('ops-api', error);
        if (!data) throw new ApiError('STATE_CONFLICT', 409, `production_run transition conflict from ${cur.status}`);
        return ok(ProductionRunSchema.parse(data));
      });
    },
  },
  {
    method: 'POST', path: '/production-runs/:id/complete',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      requireCap(caller, 'production.complete');
      parseUuidParam(params.id);
      const body = await parseBody(req, ProductionComplete);
      return respondWithIdempotency(req, caller, 'ops-api', '/production-runs/:id/complete', body, async () => {
        const cur = await loadOrgScoped<ProductionRun>('production_runs', caller, params.id);
        assertTransition(PRODUCTION_RUN_FSM, cur.status, 'completed');
        // Cross-tenant FK guard on every consumed line and the produced line.
        for (const c of body.consumed) { await assertRefInOrg('items', caller, c.item_id); }
        if (body.produced?.item_id) { await assertRefInOrg('items', caller, body.produced.item_id); }
        // R-W13-DB-01: the payload.consumed / payload.produced JSON mirror is
        // NOT dropped here. The production emit trigger
        // (tg_production_runs_emit_movements, migration 0048) reads
        // new.payload -> 'consumed' and new.payload -> 'produced' on the same
        // UPDATE that flips status to 'completed'. Production-run lines are not
        // normalised (F-Wave7-PRODUCTION-LINES-NORMALIZE-01 is open), so this
        // mirror is a live reader dependency and the write must stay.
        const merged = {
          ...(cur.payload as Record<string, unknown>),
          consumed: body.consumed,
          produced: body.produced ?? { quantity: body.quantity_produced },
        };
        // R-W13-FIN-01: status-equals-from guard. Concurrent completes off the
        // same status yield one win and one STATE_CONFLICT 409 so the emit
        // trigger fires exactly once.
        const { data, error } = await admin().from('production_runs')
          .update({
            status: 'completed',
            quantity_produced: body.quantity_produced,
            completed_at: new Date().toISOString(),
            payload: merged,
            updated_by: caller.userId,
            updated_at: new Date().toISOString(),
          })
          .eq('org_id', caller.orgId).eq('id', params.id)
          .eq('status', cur.status).select('*').maybeSingle();
        if (error) throw internalError('ops-api', error);
        if (!data) throw new ApiError('STATE_CONFLICT', 409, `production_run transition conflict from ${cur.status}`);
        return ok(ProductionRunSchema.parse(data));
      });
    },
  },

  // shipments
  {
    method: 'GET', path: '/shipments',
    handler: async ({ req, url }) => {
      const caller = requireCaller(req);
      requireCap(caller, 'shipments.shipment.read');
      // F-Wave7-LISTFILTER-01: customer_id FK filter mirrors the customer-hub
      // pattern. RLS Pattern A wraps the org gate so a cross-tenant
      // customer_id still resolves to 200 + [].
      //
      // F-Wave9-AUDIT-V3-WAVE-C4-01: project_id filter added so
      // ProjectDetailPage can ask the server for only shipments bound to
      // a given project. Mirrors the receiving_orders project_id filter
      // shape (UX-Q6). Backed by shipments_project_id_idx (migration 0063
      // re-declaration of 0046).
      const customerId = url.searchParams.get('customer_id');
      const projectId = url.searchParams.get('project_id');
      let q = admin().from('shipments').select('*')
        .eq('org_id', caller.orgId).is('deleted_at', null)
        .order('created_at', { ascending: false }).limit(200);
      if (customerId) q = q.eq('customer_id', customerId);
      if (projectId) q = q.eq('project_id', projectId);
      const { data, error } = await q;
      if (error) throw internalError('ops-api', error);
      return ok((data ?? []).map((r) => ShipmentSchema.parse(r)));
    },
  },
  {
    method: 'POST', path: '/shipments',
    handler: async ({ req }) => {
      const caller = requireCaller(req);
      requireCap(caller, 'shipments.shipment.create');
      const body = await parseBody(req, ShipmentCreate);
      return respondWithIdempotency(req, caller, 'ops-api', '/shipments', body, async () => {
        // Cross-tenant FK guard on client-supplied references.
        await assertRefInOrg('warehouses', caller, body.warehouse_id);
        if (body.customer_id) { await assertRefInOrg('customers', caller, body.customer_id); }
        if (body.sales_order_id) { await assertRefInOrg('sales_orders', caller, body.sales_order_id); }
        if (body.project_id) { await assertRefInOrg('projects', caller, body.project_id); }
        // F-Wave9-AUTO-NUMBERING-01 (B8): operator may pass a `shipment_number`
        // to override; otherwise allocate the next SHP-YYYY-NNNNN via the
        // org-scoped numbering chassis (next_doc_number / 0038). Mirrors the
        // manufacturing-api pattern from 0054.
        const suppliedShip = body.shipment_number?.trim();
        const shipment_number = suppliedShip
          ? suppliedShip
          : await nextDocNumber(caller.orgId, 'shipment');
        const { data, error } = await admin().from('shipments').insert({
          ...body, shipment_number, status: 'created', org_id: caller.orgId,
          created_by: caller.userId, updated_by: caller.userId,
        }).select('*').single();
        if (error) throw internalError('ops-api', error);
        return created(ShipmentSchema.parse(data));
      });
    },
  },
  {
    method: 'GET', path: '/shipments/:id',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      requireCap(caller, 'shipments.shipment.read');
      parseUuidParam(params.id);
      const row = await loadOrgScoped<Shipment>('shipments', caller, params.id);
      return ok(ShipmentSchema.parse(row));
    },
  },
  {
    method: 'PATCH', path: '/shipments/:id',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      requireCap(caller, 'shipments.shipment.update');
      parseUuidParam(params.id);
      const body = await parseBody(req, ShipmentUpdate);
      return respondWithIdempotency(req, caller, 'ops-api', '/shipments/:id', body, async () => {
        // Cross-tenant FK guard on any client-supplied reference in this PATCH.
        if (body.warehouse_id) { await assertRefInOrg('warehouses', caller, body.warehouse_id); }
        if (body.customer_id) { await assertRefInOrg('customers', caller, body.customer_id); }
        if (body.sales_order_id) { await assertRefInOrg('sales_orders', caller, body.sales_order_id); }
        if (body.project_id) { await assertRefInOrg('projects', caller, body.project_id); }
        const { data, error } = await admin().from('shipments')
          .update({ ...body, updated_by: caller.userId, updated_at: new Date().toISOString() })
          .eq('org_id', caller.orgId).eq('id', params.id).is('deleted_at', null)
          .select('*').maybeSingle();
        if (error) throw internalError('ops-api', error);
        if (!data) throw new ApiError('NOT_FOUND', 404);
        return ok(ShipmentSchema.parse(data));
      });
    },
  },
  {
    method: 'POST', path: '/shipments/:id/transition',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      requireCap(caller, 'shipments.shipment.update');
      parseUuidParam(params.id);
      const body = await parseBody(req, ShipmentTransition);
      return respondWithIdempotency(req, caller, 'ops-api', '/shipments/:id/transition', body, async () => {
        const cur = await loadOrgScoped<Shipment>('shipments', caller, params.id);
        assertTransition(SHIPMENT_FSM, cur.status, body.to);
        // R-W13-FIN-01: status-equals-from guard. Concurrent transitions off
        // the same status yield one win and one STATE_CONFLICT 409.
        const { data, error } = await admin().from('shipments')
          .update({ status: body.to, updated_by: caller.userId, updated_at: new Date().toISOString() })
          .eq('org_id', caller.orgId).eq('id', params.id)
          .eq('status', cur.status).select('*').maybeSingle();
        if (error) throw internalError('ops-api', error);
        if (!data) throw new ApiError('STATE_CONFLICT', 409, `shipment transition conflict from ${cur.status}`);
        return ok(ShipmentSchema.parse(data));
      });
    },
  },
  {
    method: 'POST', path: '/shipments/:id/ship',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      requireCap(caller, 'shipments.ship');
      parseUuidParam(params.id);
      const body = await parseBody(req, ShipmentShip);
      return respondWithIdempotency(req, caller, 'ops-api', '/shipments/:id/ship', body, async () => {
        const cur = await loadOrgScoped<Shipment>('shipments', caller, params.id);
        // Allow ship from either 'created' or 'picking'.
        if (cur.status !== 'picking' && cur.status !== 'created') {
          throw new ApiError('STATE_CONFLICT', 409, `cannot ship from ${cur.status}`);
        }
        if (cur.status === 'created') {
          assertTransition(SHIPMENT_FSM, 'created', 'picking');
        }
        assertTransition(SHIPMENT_FSM, 'picking', 'shipped');
        // R-W13-DB-01 (multi-stage drop, stage 1): stop dual-writing the
        // payload.lines JSON mirror. The shipment emit trigger
        // (tg_shipments_emit_movements, migration 0051) now reads exclusively
        // from shipment_line_items, and the SPA detail page reads lines via
        // useShipmentLineItems. No reader depends on payload.lines, so the
        // body.lines mirror write is removed here. The payload.lines column
        // itself stays for one more release (F-Wave7-LINES-PAYLOAD-DROP-01).
        // R-W13-FIN-01: status-equals-from guard. cur.status is the status read
        // above (either 'created' or 'picking'); carrying it into the UPDATE
        // makes the ship a compare-and-set so concurrent ships yield one win
        // and one STATE_CONFLICT 409 and the emit trigger fires exactly once.
        const { data, error } = await admin().from('shipments')
          .update({
            status: 'shipped',
            ship_date: body.ship_date ?? new Date().toISOString().slice(0, 10),
            carrier: body.carrier ?? cur.carrier,
            tracking_number: body.tracking_number ?? cur.tracking_number,
            updated_by: caller.userId,
            updated_at: new Date().toISOString(),
          })
          .eq('org_id', caller.orgId).eq('id', params.id)
          .eq('status', cur.status).select('*').maybeSingle();
        if (error) throw internalError('ops-api', error);
        if (!data) throw new ApiError('STATE_CONFLICT', 409, `shipment transition conflict from ${cur.status}`);
        return ok(ShipmentSchema.parse(data));
      });
    },
  },

  // shipment line items (F-Wave7-LINES-01)
  {
    method: 'GET', path: '/shipments/:id/line-items',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      requireCap(caller, 'shipment.line_item.read');
      parseUuidParam(params.id);
      await assertShipmentParent(caller, params.id);
      const { data, error } = await admin()
        .from('shipment_line_items').select('*')
        .eq('org_id', caller.orgId)
        .eq('shipment_id', params.id)
        .order('position', { ascending: true });
      if (error) throw internalError('ops-api', error);
      return ok((data ?? []).map((r) => ShipmentLineItemSchema.parse(r)));
    },
  },
  {
    method: 'POST', path: '/shipments/:id/line-items',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      requireCap(caller, 'shipment.line_item.create');
      parseUuidParam(params.id);
      const body = await parseBody(req, ShipmentLineItemCreateSchema);
      return respondWithIdempotency(
        req, caller, 'ops-api', '/shipments/:id/line-items', body,
        async () => {
          await assertShipmentParent(caller, params.id);
          await assertRefInOrg('items', caller, body.item_id);
          const position = body.position ?? await nextPositionFor(
            'shipment_line_items', 'shipment_id', caller, params.id,
          );
          const insert = {
            org_id: caller.orgId,
            shipment_id: params.id,
            item_id: body.item_id,
            quantity: body.quantity,
            unit_cost_cents: body.unit_cost_cents ?? null,
            uom: body.uom ?? null,
            reference: body.reference ?? null,
            position,
            created_by: caller.userId,
            updated_by: caller.userId,
          };
          const { data, error } = await admin()
            .from('shipment_line_items').insert(insert)
            .select('*').single();
          if (error) throw internalError('ops-api', error);
          return created(ShipmentLineItemSchema.parse(data));
        },
      );
    },
  },
  {
    method: 'PATCH', path: '/shipments/:id/line-items/:lineId',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      requireCap(caller, 'shipment.line_item.update');
      parseUuidParam(params.id);
      parseUuidParam(params.lineId, 'lineId');
      const body = await parseBody(req, ShipmentLineItemUpdateSchema);
      return respondWithIdempotency(
        req, caller, 'ops-api', '/shipments/:id/line-items/:lineId', body,
        async () => {
          await assertShipmentParent(caller, params.id);
          if (body.item_id) { await assertRefInOrg('items', caller, body.item_id); }
          const patch: Record<string, unknown> = {
            updated_by: caller.userId,
          };
          if (body.item_id !== undefined) patch.item_id = body.item_id;
          if (body.quantity !== undefined) patch.quantity = body.quantity;
          if (body.unit_cost_cents !== undefined) patch.unit_cost_cents = body.unit_cost_cents;
          if (body.uom !== undefined) patch.uom = body.uom;
          if (body.reference !== undefined) patch.reference = body.reference;
          if (body.position !== undefined) patch.position = body.position;
          const { data, error } = await admin().from('shipment_line_items')
            .update(patch)
            .eq('org_id', caller.orgId)
            .eq('shipment_id', params.id)
            .eq('id', params.lineId)
            .select('*').maybeSingle();
          if (error) throw internalError('ops-api', error);
          if (!data) throw new ApiError('NOT_FOUND', 404);
          return ok(ShipmentLineItemSchema.parse(data));
        },
      );
    },
  },
  {
    method: 'DELETE', path: '/shipments/:id/line-items/:lineId',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      requireCap(caller, 'shipment.line_item.delete');
      parseUuidParam(params.id);
      parseUuidParam(params.lineId, 'lineId');
      return respondWithIdempotency(
        req, caller, 'ops-api', '/shipments/:id/line-items/:lineId-delete', null,
        async () => {
          await assertShipmentParent(caller, params.id);
          const { data, error } = await admin().from('shipment_line_items')
            .delete()
            .eq('org_id', caller.orgId)
            .eq('shipment_id', params.id)
            .eq('id', params.lineId)
            .select('id').maybeSingle();
          if (error) throw internalError('ops-api', error);
          if (!data) throw new ApiError('NOT_FOUND', 404);
          return ok({ id: params.lineId, deleted: true });
        },
      );
    },
  },
];

// ---------------------------------------------------------------------------
// Bundle-level dispatcher: gate on plugins.three_pl before any route runs.
// Implementation lives in _shared/bundleGate.ts so quotes-api, projects-api,
// inventory-api, and manufacturing-api share one tested gate.
// ---------------------------------------------------------------------------

serveBundleWithGate({
  flagKey: FEATURE_FLAGS.PLUGINS_THREE_PL,
  routes: TABLE,
  bundle: 'ops-api',
});
