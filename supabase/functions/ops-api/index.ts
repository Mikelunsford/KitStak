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

import { z } from 'zod';

import { route, type Route } from '../_shared/route.ts';
import { ApiError, ok, fromApiError } from '../_shared/responses.ts';
import {
  admin, parseBody, parseUuidParam, respondWithIdempotency, created,
} from '../_shared/handler-helpers.ts';
import { readCallerContext, requireCaller, type Caller } from '../_shared/tenant.ts';
import { getFlag } from '../_shared/feature-flags.ts';
import { ERROR_CODES, FEATURE_FLAGS } from '../_shared/constants.ts';
import {
  hasVendorsInventoryOpsCap,
  type VendorsInventoryOpsCapability,
} from '../_shared/capabilities/vendors_inventory_ops.ts';
import {
  ReceivingOrderSchema, ReceivingOrderStatusSchema,
  ProductionRunSchema, ProductionRunStatusSchema,
  ShipmentSchema, ShipmentStatusSchema,
  ReceivingOrderLineSchema, ReceivingOrderPayloadSchema,
  ShipmentLineSchema, ShipmentPayloadSchema,
  ProductionRunConsumedLineSchema, ProductionRunProducedSchema,
  ProductionRunPayloadSchema,
  type ReceivingOrder, type ProductionRun, type Shipment,
} from '../_shared/types/vendors_inventory_ops.ts';
import {
  RECEIVING_ORDER_FSM, PRODUCTION_RUN_FSM, SHIPMENT_FSM,
  canTransitionVio, type Fsm,
} from '../_shared/workflow/vendors_inventory_ops.ts';

function requireVioCap(caller: Caller, cap: VendorsInventoryOpsCapability): void {
  if (hasVendorsInventoryOpsCap(caller.role, cap)) return;
  throw new ApiError('FORBIDDEN', 403, `caller lacks capability: ${cap}`);
}

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
  if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
  if (!data) throw new ApiError('NOT_FOUND', 404);
  return data as T;
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
  receiving_number: z.string().optional().nullable(),
  expected_date: z.string().optional().nullable(),
  reference: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  payload: ReceivingOrderPayloadSchema.default({}),
});
const ReceivingUpdate = ReceivingCreate.partial();
const ReceivingTransition = z.object({ to: ReceivingOrderStatusSchema });
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
// Route table
// ---------------------------------------------------------------------------

const TABLE: Route[] = [
  // receiving_orders
  {
    method: 'GET', path: '/receiving-orders',
    handler: async ({ req, url }) => {
      const caller = requireCaller(req);
      requireVioCap(caller, 'receiving.order.read');
      // F-Wave7-LISTFILTER-01: vendor_id FK filter lifts VendorDetailPage
      // client-side .filter(...) into a SQL where-clause. RLS Pattern A
      // wraps the org gate so a cross-tenant vendor_id still 200 + [].
      const vendorId = url.searchParams.get('vendor_id');
      let q = admin()
        .from('receiving_orders').select('*')
        .eq('org_id', caller.orgId).is('deleted_at', null)
        .order('created_at', { ascending: false }).limit(200);
      if (vendorId) q = q.eq('vendor_id', vendorId);
      const { data, error } = await q;
      if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
      return ok((data ?? []).map((r) => ReceivingOrderSchema.parse(r)));
    },
  },
  {
    method: 'POST', path: '/receiving-orders',
    handler: async ({ req }) => {
      const caller = requireCaller(req);
      requireVioCap(caller, 'receiving.order.create');
      const body = await parseBody(req, ReceivingCreate);
      return respondWithIdempotency(req, caller, 'ops-api', '/receiving-orders', body, async () => {
        const { data, error } = await admin().from('receiving_orders').insert({
          ...body, status: 'created', org_id: caller.orgId,
          created_by: caller.userId, updated_by: caller.userId,
        }).select('*').single();
        if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
        return created(ReceivingOrderSchema.parse(data));
      });
    },
  },
  {
    method: 'GET', path: '/receiving-orders/:id',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      requireVioCap(caller, 'receiving.order.read');
      parseUuidParam(params.id);
      const row = await loadOrgScoped<ReceivingOrder>('receiving_orders', caller, params.id);
      return ok(ReceivingOrderSchema.parse(row));
    },
  },
  {
    method: 'PATCH', path: '/receiving-orders/:id',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      requireVioCap(caller, 'receiving.order.update');
      parseUuidParam(params.id);
      const body = await parseBody(req, ReceivingUpdate);
      return respondWithIdempotency(req, caller, 'ops-api', '/receiving-orders/:id', body, async () => {
        const { data, error } = await admin().from('receiving_orders')
          .update({ ...body, updated_by: caller.userId, updated_at: new Date().toISOString() })
          .eq('org_id', caller.orgId).eq('id', params.id).is('deleted_at', null)
          .select('*').maybeSingle();
        if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
        if (!data) throw new ApiError('NOT_FOUND', 404);
        return ok(ReceivingOrderSchema.parse(data));
      });
    },
  },
  {
    method: 'POST', path: '/receiving-orders/:id/transition',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      requireVioCap(caller, 'receiving.order.update');
      parseUuidParam(params.id);
      const body = await parseBody(req, ReceivingTransition);
      return respondWithIdempotency(req, caller, 'ops-api', '/receiving-orders/:id/transition', body, async () => {
        const cur = await loadOrgScoped<ReceivingOrder>('receiving_orders', caller, params.id);
        assertTransition(RECEIVING_ORDER_FSM, cur.status, body.to);
        const { data, error } = await admin().from('receiving_orders')
          .update({ status: body.to, updated_by: caller.userId, updated_at: new Date().toISOString() })
          .eq('org_id', caller.orgId).eq('id', params.id).select('*').single();
        if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
        return ok(ReceivingOrderSchema.parse(data));
      });
    },
  },
  {
    method: 'POST', path: '/receiving-orders/:id/receive',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      requireVioCap(caller, 'receiving.receive');
      parseUuidParam(params.id);
      const body = await parseBody(req, ReceivingReceive);
      return respondWithIdempotency(req, caller, 'ops-api', '/receiving-orders/:id/receive', body, async () => {
        const cur = await loadOrgScoped<ReceivingOrder>('receiving_orders', caller, params.id);
        assertTransition(RECEIVING_ORDER_FSM, cur.status, 'received');
        const merged = { ...(cur.payload as Record<string, unknown>), lines: body.lines };
        const { data, error } = await admin().from('receiving_orders')
          .update({
            status: 'received',
            received_date: body.received_date ?? new Date().toISOString().slice(0, 10),
            payload: merged,
            updated_by: caller.userId,
            updated_at: new Date().toISOString(),
          })
          .eq('org_id', caller.orgId).eq('id', params.id).select('*').single();
        if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
        return ok(ReceivingOrderSchema.parse(data));
      });
    },
  },

  // production_runs
  {
    method: 'GET', path: '/production-runs',
    handler: async ({ req }) => {
      const caller = requireCaller(req);
      requireVioCap(caller, 'production.run.read');
      const { data, error } = await admin().from('production_runs').select('*')
        .eq('org_id', caller.orgId).is('deleted_at', null)
        .order('created_at', { ascending: false }).limit(200);
      if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
      return ok((data ?? []).map((r) => ProductionRunSchema.parse(r)));
    },
  },
  {
    method: 'POST', path: '/production-runs',
    handler: async ({ req }) => {
      const caller = requireCaller(req);
      requireVioCap(caller, 'production.run.create');
      const body = await parseBody(req, ProductionCreate);
      return respondWithIdempotency(req, caller, 'ops-api', '/production-runs', body, async () => {
        const { data, error } = await admin().from('production_runs').insert({
          ...body, status: 'planned', org_id: caller.orgId,
          created_by: caller.userId, updated_by: caller.userId,
        }).select('*').single();
        if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
        return created(ProductionRunSchema.parse(data));
      });
    },
  },
  {
    method: 'GET', path: '/production-runs/:id',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      requireVioCap(caller, 'production.run.read');
      parseUuidParam(params.id);
      const row = await loadOrgScoped<ProductionRun>('production_runs', caller, params.id);
      return ok(ProductionRunSchema.parse(row));
    },
  },
  {
    method: 'PATCH', path: '/production-runs/:id',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      requireVioCap(caller, 'production.run.update');
      parseUuidParam(params.id);
      const body = await parseBody(req, ProductionUpdate);
      return respondWithIdempotency(req, caller, 'ops-api', '/production-runs/:id', body, async () => {
        const { data, error } = await admin().from('production_runs')
          .update({ ...body, updated_by: caller.userId, updated_at: new Date().toISOString() })
          .eq('org_id', caller.orgId).eq('id', params.id).is('deleted_at', null)
          .select('*').maybeSingle();
        if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
        if (!data) throw new ApiError('NOT_FOUND', 404);
        return ok(ProductionRunSchema.parse(data));
      });
    },
  },
  {
    method: 'POST', path: '/production-runs/:id/start',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      requireVioCap(caller, 'production.start');
      parseUuidParam(params.id);
      return respondWithIdempotency(req, caller, 'ops-api', '/production-runs/:id/start', null, async () => {
        const cur = await loadOrgScoped<ProductionRun>('production_runs', caller, params.id);
        assertTransition(PRODUCTION_RUN_FSM, cur.status, 'in_progress');
        const { data, error } = await admin().from('production_runs')
          .update({
            status: 'in_progress',
            started_at: new Date().toISOString(),
            updated_by: caller.userId,
            updated_at: new Date().toISOString(),
          })
          .eq('org_id', caller.orgId).eq('id', params.id).select('*').single();
        if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
        return ok(ProductionRunSchema.parse(data));
      });
    },
  },
  {
    method: 'POST', path: '/production-runs/:id/complete',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      requireVioCap(caller, 'production.complete');
      parseUuidParam(params.id);
      const body = await parseBody(req, ProductionComplete);
      return respondWithIdempotency(req, caller, 'ops-api', '/production-runs/:id/complete', body, async () => {
        const cur = await loadOrgScoped<ProductionRun>('production_runs', caller, params.id);
        assertTransition(PRODUCTION_RUN_FSM, cur.status, 'completed');
        const merged = {
          ...(cur.payload as Record<string, unknown>),
          consumed: body.consumed,
          produced: body.produced ?? { quantity: body.quantity_produced },
        };
        const { data, error } = await admin().from('production_runs')
          .update({
            status: 'completed',
            quantity_produced: body.quantity_produced,
            completed_at: new Date().toISOString(),
            payload: merged,
            updated_by: caller.userId,
            updated_at: new Date().toISOString(),
          })
          .eq('org_id', caller.orgId).eq('id', params.id).select('*').single();
        if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
        return ok(ProductionRunSchema.parse(data));
      });
    },
  },

  // shipments
  {
    method: 'GET', path: '/shipments',
    handler: async ({ req, url }) => {
      const caller = requireCaller(req);
      requireVioCap(caller, 'shipments.shipment.read');
      // F-Wave7-LISTFILTER-01: customer_id FK filter mirrors the customer-hub
      // pattern. RLS Pattern A wraps the org gate so a cross-tenant
      // customer_id still resolves to 200 + [].
      const customerId = url.searchParams.get('customer_id');
      let q = admin().from('shipments').select('*')
        .eq('org_id', caller.orgId).is('deleted_at', null)
        .order('created_at', { ascending: false }).limit(200);
      if (customerId) q = q.eq('customer_id', customerId);
      const { data, error } = await q;
      if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
      return ok((data ?? []).map((r) => ShipmentSchema.parse(r)));
    },
  },
  {
    method: 'POST', path: '/shipments',
    handler: async ({ req }) => {
      const caller = requireCaller(req);
      requireVioCap(caller, 'shipments.shipment.create');
      const body = await parseBody(req, ShipmentCreate);
      return respondWithIdempotency(req, caller, 'ops-api', '/shipments', body, async () => {
        const { data, error } = await admin().from('shipments').insert({
          ...body, status: 'created', org_id: caller.orgId,
          created_by: caller.userId, updated_by: caller.userId,
        }).select('*').single();
        if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
        return created(ShipmentSchema.parse(data));
      });
    },
  },
  {
    method: 'GET', path: '/shipments/:id',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      requireVioCap(caller, 'shipments.shipment.read');
      parseUuidParam(params.id);
      const row = await loadOrgScoped<Shipment>('shipments', caller, params.id);
      return ok(ShipmentSchema.parse(row));
    },
  },
  {
    method: 'PATCH', path: '/shipments/:id',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      requireVioCap(caller, 'shipments.shipment.update');
      parseUuidParam(params.id);
      const body = await parseBody(req, ShipmentUpdate);
      return respondWithIdempotency(req, caller, 'ops-api', '/shipments/:id', body, async () => {
        const { data, error } = await admin().from('shipments')
          .update({ ...body, updated_by: caller.userId, updated_at: new Date().toISOString() })
          .eq('org_id', caller.orgId).eq('id', params.id).is('deleted_at', null)
          .select('*').maybeSingle();
        if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
        if (!data) throw new ApiError('NOT_FOUND', 404);
        return ok(ShipmentSchema.parse(data));
      });
    },
  },
  {
    method: 'POST', path: '/shipments/:id/transition',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      requireVioCap(caller, 'shipments.shipment.update');
      parseUuidParam(params.id);
      const body = await parseBody(req, ShipmentTransition);
      return respondWithIdempotency(req, caller, 'ops-api', '/shipments/:id/transition', body, async () => {
        const cur = await loadOrgScoped<Shipment>('shipments', caller, params.id);
        assertTransition(SHIPMENT_FSM, cur.status, body.to);
        const { data, error } = await admin().from('shipments')
          .update({ status: body.to, updated_by: caller.userId, updated_at: new Date().toISOString() })
          .eq('org_id', caller.orgId).eq('id', params.id).select('*').single();
        if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
        return ok(ShipmentSchema.parse(data));
      });
    },
  },
  {
    method: 'POST', path: '/shipments/:id/ship',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      requireVioCap(caller, 'shipments.ship');
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
        const merged = { ...(cur.payload as Record<string, unknown>), lines: body.lines };
        const { data, error } = await admin().from('shipments')
          .update({
            status: 'shipped',
            ship_date: body.ship_date ?? new Date().toISOString().slice(0, 10),
            carrier: body.carrier ?? cur.carrier,
            tracking_number: body.tracking_number ?? cur.tracking_number,
            payload: merged,
            updated_by: caller.userId,
            updated_at: new Date().toISOString(),
          })
          .eq('org_id', caller.orgId).eq('id', params.id).select('*').single();
        if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
        return ok(ShipmentSchema.parse(data));
      });
    },
  },
];

// ---------------------------------------------------------------------------
// Bundle-level dispatcher: gate on plugins.three_pl before any route runs.
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return route(req, [], { bundle: 'ops-api' });
  }
  // Resolve org claim leniently. If absent, fall through to the standard
  // route() error envelope (UNAUTHORIZED / NO_ACTIVE_ORG via requireCaller).
  const ctx = readCallerContext(req);
  if (ctx.orgId) {
    const flag = await getFlag(ctx.orgId, FEATURE_FLAGS.PLUGINS_THREE_PL);
    if (!flag.enabled) {
      // Hide the entire bundle: every method, every path -> 404.
      return fromApiError(new ApiError(ERROR_CODES.NOT_FOUND, 404));
    }
  }
  return route(req, TABLE, { bundle: 'ops-api' });
});
