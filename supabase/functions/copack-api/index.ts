// copack-api bundle.
//
// Pillar 3 (Co-Pack and Ecom) HTTP surface. Sibling bundle to
// manufacturing-api; implements section 6 of
// 03-workspace/specs/copack-ecom-pillar-spec.md (APPROVED 2026-05-31).
//
// BUNDLE GATE: plugins.copack_ecom. Constitutional rule (AUDIT.md / 00-canon):
//   Bundle gate off  -> every route returns 404 NOT_FOUND envelope.
//   Per-route flag   -> 403 FEATURE_DISABLED with details.flag. (Not used here.)
//
// The gate fires BEFORE the route table so even a caller hitting an unknown
// path gets 404. Callers without an org claim land in the standard
// UNAUTHORIZED / NO_ACTIVE_ORG envelopes; we only reach the flag read once
// the caller resolves.
//
// State machines (handler-enforced, mirror the CHECK constraints from
// migrations 0073 / 0074 / 0076 and the audit-trigger guards in the same
// files). Invalid transitions are rejected with STATE_CONFLICT 409 BEFORE the
// DB call so the operator never sees a 500-class error bubble out of the
// status CHECK constraint (matches the manufacturing-api / ops-api precedent):
//   sales_orders   draft -> confirmed; {draft,confirmed,picking,packed} ->
//                  cancelled. picking/packed/shipped are driven by the
//                  fulfillment ship trigger (0076), not direct routes.
//   kitting_jobs   draft -> started -> completed; {draft,started} -> cancelled.
//                  Mirrors manufacturing_runs one-for-one.
//   fulfillments   pending -> picking -> packed -> shipped;
//                  {pending,picking,packed} -> cancelled. A fulfillment
//                  reaching shipped advances its sales_order to shipped via the
//                  DB trigger tg_fulfillments_advance_order (0076); the handler
//                  just sets the fulfillment status.
//
// Capabilities (C1, registered in _shared/capabilities.ts and the SPA mirror):
//   Reads are RLS-only; no read cap exists. State-changing routes call
//   requireCap. Two routes reuse an existing cap because the spec's cap set
//   (section 5) has no dedicated entry for them; the reuse keeps them on the
//   same role gate the dedicated cap would have granted:
//     DELETE /sales-orders/:id  reuses copack.order.update
//     POST   /fulfillments       reuses copack.fulfillment.pick
//     POST   /fulfillments/:id/cancel reuses copack.fulfillment.pick
//   (owner / admin / ops already hold all of pick / pack / ship.)
//
// Routes (when plugins.copack_ecom is enabled for the caller's org):
//   GET    /sales-channels                         list (RLS-only)
//   POST   /sales-channels                         create
//   PATCH  /sales-channels/:id                     update
//   GET    /sales-orders                           list (RLS-only)
//   POST   /sales-orders                           create
//   GET    /sales-orders/:id                       read (RLS-only)
//   PATCH  /sales-orders/:id                       update (draft only)
//   DELETE /sales-orders/:id                       soft-delete
//   POST   /sales-orders/:id/confirm               draft -> confirmed
//   POST   /sales-orders/:id/cancel                -> cancelled
//   GET    /sales-orders/:id/lines                 list line items
//   POST   /sales-orders/:id/lines                 add line
//   PATCH  /sales-orders/:id/lines/:lineId         update
//   DELETE /sales-orders/:id/lines/:lineId         delete
//   GET    /kitting-jobs                            list (RLS-only)
//   POST   /kitting-jobs                            create
//   GET    /kitting-jobs/:id                        read (RLS-only)
//   PATCH  /kitting-jobs/:id                        update (draft only)
//   DELETE /kitting-jobs/:id                        soft-delete
//   POST   /kitting-jobs/:id/start                  draft -> started
//   POST   /kitting-jobs/:id/complete               started -> completed
//   POST   /kitting-jobs/:id/cancel                 -> cancelled
//   GET    /kitting-jobs/:id/consumed               list consumed lines
//   POST   /kitting-jobs/:id/consumed               add consumed line
//   PATCH  /kitting-jobs/:id/consumed/:lineId       update
//   DELETE /kitting-jobs/:id/consumed/:lineId       delete
//   GET    /kitting-jobs/:id/produced               list produced lines
//   POST   /kitting-jobs/:id/produced               add produced line
//   PATCH  /kitting-jobs/:id/produced/:lineId       update
//   DELETE /kitting-jobs/:id/produced/:lineId       delete
//   GET    /fulfillments                            list (filter order, status)
//   POST   /fulfillments                            create (for a sales order)
//   GET    /fulfillments/:id                        read (RLS-only)
//   POST   /fulfillments/:id/pick                   pending -> picking
//   POST   /fulfillments/:id/pack                   picking -> packed
//   POST   /fulfillments/:id/ship                   packed -> shipped
//   POST   /fulfillments/:id/cancel                 -> cancelled

import { type Route } from '../_shared/route.ts';
import { ApiError, ok, internalError } from '../_shared/responses.ts';
import {
  admin, parseBody, parseUuidParam, respondWithIdempotency, created, requireCap,
} from '../_shared/handler-helpers.ts';
import { requireCaller, type Caller } from '../_shared/tenant.ts';
import { serveBundleWithGate } from '../_shared/bundleGate.ts';
import { nextDocNumber } from '../_shared/numbering.ts';
import { FEATURE_FLAGS } from '../_shared/constants.ts';
import {
  SalesChannelSchema,
  SalesChannelCreateSchema,
  SalesChannelPatchSchema,
  SalesOrderSchema,
  SalesOrderCreateSchema,
  SalesOrderPatchSchema,
  SalesOrderLineItemSchema,
  SalesOrderLineItemCreateSchema,
  SalesOrderLineItemUpdateSchema,
  KittingJobSchema,
  KittingJobCreateSchema,
  KittingJobPatchSchema,
  KittingJobConsumedLineItemSchema,
  KittingJobConsumedLineItemCreateSchema,
  KittingJobConsumedLineItemUpdateSchema,
  KittingJobProducedLineItemSchema,
  KittingJobProducedLineItemCreateSchema,
  KittingJobProducedLineItemUpdateSchema,
  FulfillmentSchema,
  FulfillmentCreateSchema,
  type SalesOrder,
  type SalesOrderStatus,
  type KittingJob,
  type KittingJobStatus,
  type Fulfillment,
  type FulfillmentStatus,
} from '../_shared/types/copack.ts';

const BUNDLE = 'copack-api';

type KittingLineTable =
  | 'kitting_job_consumed_line_items'
  | 'kitting_job_produced_line_items';

// ---------------------------------------------------------------------------
// Loaders and parent-existence probes. Cross-tenant or soft-deleted rows
// resolve to NOT_FOUND 404, matching the manufacturing-api precedent.
// ---------------------------------------------------------------------------

async function loadOrder(caller: Caller, id: string): Promise<SalesOrder> {
  const { data, error } = await admin()
    .from('sales_orders').select('*')
    .eq('org_id', caller.orgId).eq('id', id).is('deleted_at', null)
    .maybeSingle();
  if (error) throw internalError('copack-api', error);
  if (!data) throw new ApiError('NOT_FOUND', 404);
  return SalesOrderSchema.parse(data);
}

async function assertOrderParent(caller: Caller, id: string): Promise<void> {
  const { data, error } = await admin().from('sales_orders').select('id')
    .eq('org_id', caller.orgId).eq('id', id).is('deleted_at', null).maybeSingle();
  if (error) throw internalError('copack-api', error);
  if (!data) throw new ApiError('NOT_FOUND', 404);
}

async function loadKittingJob(caller: Caller, id: string): Promise<KittingJob> {
  const { data, error } = await admin()
    .from('kitting_jobs').select('*')
    .eq('org_id', caller.orgId).eq('id', id).is('deleted_at', null)
    .maybeSingle();
  if (error) throw internalError('copack-api', error);
  if (!data) throw new ApiError('NOT_FOUND', 404);
  return KittingJobSchema.parse(data);
}

async function assertKittingJobParent(caller: Caller, id: string): Promise<void> {
  const { data, error } = await admin().from('kitting_jobs').select('id')
    .eq('org_id', caller.orgId).eq('id', id).is('deleted_at', null).maybeSingle();
  if (error) throw internalError('copack-api', error);
  if (!data) throw new ApiError('NOT_FOUND', 404);
}

async function loadFulfillment(caller: Caller, id: string): Promise<Fulfillment> {
  const { data, error } = await admin()
    .from('fulfillments').select('*')
    .eq('org_id', caller.orgId).eq('id', id).is('deleted_at', null)
    .maybeSingle();
  if (error) throw internalError('copack-api', error);
  if (!data) throw new ApiError('NOT_FOUND', 404);
  return FulfillmentSchema.parse(data);
}

async function nextOrderLinePosition(caller: Caller, orderId: string): Promise<number> {
  const { data, error } = await admin().from('sales_order_line_items')
    .select('position')
    .eq('org_id', caller.orgId)
    .eq('sales_order_id', orderId)
    .order('position', { ascending: false }).limit(1).maybeSingle();
  if (error) throw internalError('copack-api', error);
  return ((data?.position as number | undefined) ?? -1) + 1;
}

async function nextKittingLinePosition(
  table: KittingLineTable, caller: Caller, jobId: string,
): Promise<number> {
  const { data, error } = await admin().from(table)
    .select('position')
    .eq('org_id', caller.orgId)
    .eq('kitting_job_id', jobId)
    .order('position', { ascending: false }).limit(1).maybeSingle();
  if (error) throw internalError('copack-api', error);
  return ((data?.position as number | undefined) ?? -1) + 1;
}

// ---------------------------------------------------------------------------
// State-machine guards. Reject illegal transitions BEFORE the DB call with
// STATE_CONFLICT 409 (canonical FSM-violation envelope per ERROR_CODES).
// ---------------------------------------------------------------------------

function assertOrderTransition(from: SalesOrderStatus, to: SalesOrderStatus): void {
  const allowed: Record<SalesOrderStatus, ReadonlyArray<SalesOrderStatus>> = {
    draft: ['confirmed', 'cancelled'],
    confirmed: ['picking', 'packed', 'shipped', 'cancelled'],
    picking: ['packed', 'shipped', 'cancelled'],
    packed: ['shipped', 'cancelled'],
    shipped: [],
    cancelled: [],
  };
  if (!allowed[from].includes(to)) {
    throw new ApiError(
      'STATE_CONFLICT', 409,
      `illegal sales_order transition: ${from} -> ${to}`,
    );
  }
}

function assertKittingTransition(from: KittingJobStatus, to: KittingJobStatus): void {
  const allowed: Record<KittingJobStatus, ReadonlyArray<KittingJobStatus>> = {
    draft: ['started', 'cancelled'],
    started: ['completed', 'cancelled'],
    completed: [],
    cancelled: [],
  };
  if (!allowed[from].includes(to)) {
    throw new ApiError(
      'STATE_CONFLICT', 409,
      `illegal kitting_job transition: ${from} -> ${to}`,
    );
  }
}

function assertFulfillmentTransition(from: FulfillmentStatus, to: FulfillmentStatus): void {
  const allowed: Record<FulfillmentStatus, ReadonlyArray<FulfillmentStatus>> = {
    pending: ['picking', 'cancelled'],
    picking: ['packed', 'cancelled'],
    packed: ['shipped', 'cancelled'],
    shipped: [],
    cancelled: [],
  };
  if (!allowed[from].includes(to)) {
    throw new ApiError(
      'STATE_CONFLICT', 409,
      `illegal fulfillment transition: ${from} -> ${to}`,
    );
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Route table
// ---------------------------------------------------------------------------

const TABLE: Route[] = [
  // -------------------------------------------------------------------------
  // sales_channels (library, no state machine)
  // -------------------------------------------------------------------------
  {
    method: 'GET', path: '/sales-channels',
    handler: async ({ req, url }) => {
      const caller = requireCaller(req);
      const isActive = url.searchParams.get('is_active');
      const kind = url.searchParams.get('kind');
      let q = admin()
        .from('sales_channels').select('*')
        .eq('org_id', caller.orgId).is('deleted_at', null)
        .order('created_at', { ascending: false }).limit(200);
      if (isActive === 'true') q = q.eq('is_active', true);
      if (isActive === 'false') q = q.eq('is_active', false);
      if (kind) q = q.eq('kind', kind);
      const { data, error } = await q;
      if (error) throw internalError('copack-api', error);
      return ok((data ?? []).map((r) => SalesChannelSchema.parse(r)));
    },
  },
  {
    method: 'POST', path: '/sales-channels',
    handler: async ({ req }) => {
      const caller = requireCaller(req);
      requireCap(caller, 'copack.channel.write');
      const body = await parseBody(req, SalesChannelCreateSchema);
      return respondWithIdempotency(req, caller, BUNDLE, '/sales-channels', body, async () => {
        const insert = {
          org_id: caller.orgId,
          name: body.name,
          kind: body.kind,
          is_active: body.is_active ?? true,
          created_by: caller.userId,
          updated_by: caller.userId,
        };
        const { data, error } = await admin().from('sales_channels')
          .insert(insert).select('*').single();
        if (error) throw internalError('copack-api', error);
        return created(SalesChannelSchema.parse(data));
      });
    },
  },
  {
    method: 'PATCH', path: '/sales-channels/:id',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      requireCap(caller, 'copack.channel.write');
      parseUuidParam(params.id);
      const body = await parseBody(req, SalesChannelPatchSchema);
      return respondWithIdempotency(req, caller, BUNDLE, '/sales-channels/:id', body, async () => {
        const patch: Record<string, unknown> = {
          updated_by: caller.userId,
          updated_at: nowIso(),
        };
        if (body.name !== undefined) patch.name = body.name;
        if (body.kind !== undefined) patch.kind = body.kind;
        if (body.is_active !== undefined) patch.is_active = body.is_active;
        const { data, error } = await admin().from('sales_channels')
          .update(patch)
          .eq('org_id', caller.orgId).eq('id', params.id).is('deleted_at', null)
          .select('*').maybeSingle();
        if (error) throw internalError('copack-api', error);
        if (!data) throw new ApiError('NOT_FOUND', 404);
        return ok(SalesChannelSchema.parse(data));
      });
    },
  },

  // -------------------------------------------------------------------------
  // sales_orders (parent)
  // -------------------------------------------------------------------------
  {
    method: 'GET', path: '/sales-orders',
    handler: async ({ req, url }) => {
      const caller = requireCaller(req);
      const status = url.searchParams.get('status');
      const channelId = url.searchParams.get('channel_id');
      const customerId = url.searchParams.get('customer_id');
      const projectId = url.searchParams.get('project_id');
      let q = admin()
        .from('sales_orders').select('*')
        .eq('org_id', caller.orgId).is('deleted_at', null)
        .order('created_at', { ascending: false }).limit(200);
      if (status) q = q.eq('status', status);
      if (channelId) q = q.eq('channel_id', channelId);
      if (customerId) q = q.eq('customer_id', customerId);
      if (projectId) q = q.eq('project_id', projectId);
      const { data, error } = await q;
      if (error) throw internalError('copack-api', error);
      return ok((data ?? []).map((r) => SalesOrderSchema.parse(r)));
    },
  },
  {
    method: 'POST', path: '/sales-orders',
    handler: async ({ req }) => {
      const caller = requireCaller(req);
      requireCap(caller, 'copack.order.create');
      const body = await parseBody(req, SalesOrderCreateSchema);
      return respondWithIdempotency(req, caller, BUNDLE, '/sales-orders', body, async () => {
        // Operator may pass an `order_number` to override; otherwise the
        // org-scoped numbering chassis allocates the next SO- string (seeded
        // by migration 0077).
        const orderNumber = body.order_number?.trim()
          ? body.order_number.trim()
          : await nextDocNumber(caller.orgId, 'sales_order');
        const insert: Record<string, unknown> = {
          org_id: caller.orgId,
          status: 'draft',
          order_number: orderNumber,
          channel_id: body.channel_id ?? null,
          customer_id: body.customer_id ?? null,
          project_id: body.project_id ?? null,
          currency_code: body.currency_code ?? null,
          ordered_at: body.ordered_at ?? null,
          notes: body.notes ?? null,
          payload: body.payload ?? {},
          created_by: caller.userId,
          updated_by: caller.userId,
        };
        const { data, error } = await admin().from('sales_orders')
          .insert(insert).select('*').single();
        if (error) throw internalError('copack-api', error);
        return created(SalesOrderSchema.parse(data));
      });
    },
  },
  {
    method: 'GET', path: '/sales-orders/:id',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      parseUuidParam(params.id);
      const row = await loadOrder(caller, params.id);
      return ok(row);
    },
  },
  {
    method: 'PATCH', path: '/sales-orders/:id',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      requireCap(caller, 'copack.order.update');
      parseUuidParam(params.id);
      const body = await parseBody(req, SalesOrderPatchSchema);
      return respondWithIdempotency(req, caller, BUNDLE, '/sales-orders/:id', body, async () => {
        const cur = await loadOrder(caller, params.id);
        // Only draft orders are editable. Once confirmed, status transitions
        // are the only legal mutation surface.
        if (cur.status !== 'draft') {
          throw new ApiError(
            'STATE_CONFLICT', 409,
            `sales_order cannot be edited from status=${cur.status}`,
          );
        }
        const patch: Record<string, unknown> = {
          updated_by: caller.userId,
          updated_at: nowIso(),
        };
        if (body.order_number !== undefined) patch.order_number = body.order_number;
        if (body.channel_id !== undefined) patch.channel_id = body.channel_id;
        if (body.customer_id !== undefined) patch.customer_id = body.customer_id;
        if (body.project_id !== undefined) patch.project_id = body.project_id;
        if (body.currency_code !== undefined) patch.currency_code = body.currency_code;
        if (body.ordered_at !== undefined) patch.ordered_at = body.ordered_at;
        if (body.notes !== undefined) patch.notes = body.notes;
        if (body.payload !== undefined) patch.payload = body.payload;
        const { data, error } = await admin().from('sales_orders')
          .update(patch)
          .eq('org_id', caller.orgId).eq('id', params.id).is('deleted_at', null)
          .select('*').maybeSingle();
        if (error) throw internalError('copack-api', error);
        if (!data) throw new ApiError('NOT_FOUND', 404);
        return ok(SalesOrderSchema.parse(data));
      });
    },
  },
  {
    method: 'DELETE', path: '/sales-orders/:id',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      // No dedicated copack.order.delete cap; reuse copack.order.update (same
      // role gate the dedicated cap would have granted).
      requireCap(caller, 'copack.order.update');
      parseUuidParam(params.id);
      return respondWithIdempotency(req, caller, BUNDLE, '/sales-orders/:id-delete', null, async () => {
        const cur = await loadOrder(caller, params.id);
        // A shipped order is terminal and may have fulfillments bound to it;
        // soft-deleting it would orphan that history. Refuse with 409.
        if (cur.status === 'shipped') {
          throw new ApiError(
            'STATE_CONFLICT', 409,
            'sales_order cannot be deleted after it has shipped',
          );
        }
        const { data, error } = await admin().from('sales_orders')
          .update({
            deleted_at: nowIso(),
            updated_by: caller.userId,
            updated_at: nowIso(),
          })
          .eq('org_id', caller.orgId).eq('id', params.id).is('deleted_at', null)
          .select('id').maybeSingle();
        if (error) throw internalError('copack-api', error);
        if (!data) throw new ApiError('NOT_FOUND', 404);
        return ok({ id: params.id, deleted: true });
      });
    },
  },
  {
    method: 'POST', path: '/sales-orders/:id/confirm',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      requireCap(caller, 'copack.order.confirm');
      parseUuidParam(params.id);
      return respondWithIdempotency(req, caller, BUNDLE, '/sales-orders/:id/confirm', null, async () => {
        const cur = await loadOrder(caller, params.id);
        assertOrderTransition(cur.status, 'confirmed');
        const ts = nowIso();
        const { data, error } = await admin().from('sales_orders')
          .update({
            status: 'confirmed',
            confirmed_at: ts,
            updated_by: caller.userId,
            updated_at: ts,
          })
          .eq('org_id', caller.orgId).eq('id', params.id).is('deleted_at', null)
          .select('*').maybeSingle();
        if (error) throw internalError('copack-api', error);
        if (!data) throw new ApiError('NOT_FOUND', 404);
        return ok(SalesOrderSchema.parse(data));
      });
    },
  },
  {
    method: 'POST', path: '/sales-orders/:id/cancel',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      requireCap(caller, 'copack.order.cancel');
      parseUuidParam(params.id);
      return respondWithIdempotency(req, caller, BUNDLE, '/sales-orders/:id/cancel', null, async () => {
        const cur = await loadOrder(caller, params.id);
        assertOrderTransition(cur.status, 'cancelled');
        const ts = nowIso();
        const { data, error } = await admin().from('sales_orders')
          .update({
            status: 'cancelled',
            cancelled_at: ts,
            updated_by: caller.userId,
            updated_at: ts,
          })
          .eq('org_id', caller.orgId).eq('id', params.id).is('deleted_at', null)
          .select('*').maybeSingle();
        if (error) throw internalError('copack-api', error);
        if (!data) throw new ApiError('NOT_FOUND', 404);
        return ok(SalesOrderSchema.parse(data));
      });
    },
  },

  // -------------------------------------------------------------------------
  // sales_order_line_items (item_id REQUIRED per migration 0073)
  // -------------------------------------------------------------------------
  {
    method: 'GET', path: '/sales-orders/:id/lines',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      parseUuidParam(params.id);
      await assertOrderParent(caller, params.id);
      const { data, error } = await admin()
        .from('sales_order_line_items').select('*')
        .eq('org_id', caller.orgId)
        .eq('sales_order_id', params.id)
        .order('position', { ascending: true });
      if (error) throw internalError('copack-api', error);
      return ok((data ?? []).map((r) => SalesOrderLineItemSchema.parse(r)));
    },
  },
  {
    method: 'POST', path: '/sales-orders/:id/lines',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      requireCap(caller, 'copack.order.line_item.create');
      parseUuidParam(params.id);
      const body = await parseBody(req, SalesOrderLineItemCreateSchema);
      return respondWithIdempotency(
        req, caller, BUNDLE, '/sales-orders/:id/lines', body,
        async () => {
          await assertOrderParent(caller, params.id);
          const position = body.position ?? await nextOrderLinePosition(caller, params.id);
          const insert = {
            org_id: caller.orgId,
            sales_order_id: params.id,
            item_id: body.item_id,
            quantity: body.quantity,
            unit_price_cents: body.unit_price_cents ?? null,
            uom: body.uom ?? null,
            reference: body.reference ?? null,
            position,
            created_by: caller.userId,
            updated_by: caller.userId,
          };
          const { data, error } = await admin()
            .from('sales_order_line_items').insert(insert)
            .select('*').single();
          if (error) throw internalError('copack-api', error);
          return created(SalesOrderLineItemSchema.parse(data));
        },
      );
    },
  },
  {
    method: 'PATCH', path: '/sales-orders/:id/lines/:lineId',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      requireCap(caller, 'copack.order.line_item.update');
      parseUuidParam(params.id);
      parseUuidParam(params.lineId, 'lineId');
      const body = await parseBody(req, SalesOrderLineItemUpdateSchema);
      return respondWithIdempotency(
        req, caller, BUNDLE, '/sales-orders/:id/lines/:lineId', body,
        async () => {
          await assertOrderParent(caller, params.id);
          const patch: Record<string, unknown> = { updated_by: caller.userId };
          if (body.item_id !== undefined) patch.item_id = body.item_id;
          if (body.quantity !== undefined) patch.quantity = body.quantity;
          if (body.unit_price_cents !== undefined) patch.unit_price_cents = body.unit_price_cents;
          if (body.uom !== undefined) patch.uom = body.uom;
          if (body.reference !== undefined) patch.reference = body.reference;
          if (body.position !== undefined) patch.position = body.position;
          const { data, error } = await admin()
            .from('sales_order_line_items')
            .update(patch)
            .eq('org_id', caller.orgId)
            .eq('sales_order_id', params.id)
            .eq('id', params.lineId)
            .select('*').maybeSingle();
          if (error) throw internalError('copack-api', error);
          if (!data) throw new ApiError('NOT_FOUND', 404);
          return ok(SalesOrderLineItemSchema.parse(data));
        },
      );
    },
  },
  {
    method: 'DELETE', path: '/sales-orders/:id/lines/:lineId',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      requireCap(caller, 'copack.order.line_item.delete');
      parseUuidParam(params.id);
      parseUuidParam(params.lineId, 'lineId');
      return respondWithIdempotency(
        req, caller, BUNDLE, '/sales-orders/:id/lines/:lineId-delete', null,
        async () => {
          await assertOrderParent(caller, params.id);
          const { data, error } = await admin()
            .from('sales_order_line_items').delete()
            .eq('org_id', caller.orgId)
            .eq('sales_order_id', params.id)
            .eq('id', params.lineId)
            .select('id').maybeSingle();
          if (error) throw internalError('copack-api', error);
          if (!data) throw new ApiError('NOT_FOUND', 404);
          return ok({ id: params.lineId, deleted: true });
        },
      );
    },
  },

  // -------------------------------------------------------------------------
  // warehouses (read-only, Co-Pack scoped). F-Wave10-CKSMOKE-04.
  //
  // Warehouses are a shared inventory primitive: every org gets a default
  // warehouse at provisioning, and kitting / fulfillment both reference one.
  // The inventory-api bundle is gated on plugins.three_pl, so a Co-Pack-only
  // org cannot read warehouses there to populate the picker (the picker came
  // back empty and kitting completion then recorded no stock movements). This
  // read-only, org-scoped list lives inside the copack_ecom bundle so Co-Pack
  // operators can select a warehouse and resolve its name without enabling 3PL.
  // Warehouse CRUD stays in inventory-api; this is read-only.
  // -------------------------------------------------------------------------
  {
    method: 'GET', path: '/warehouses',
    handler: async ({ req }) => {
      const caller = requireCaller(req);
      const { data, error } = await admin()
        .from('warehouses').select('*')
        .eq('org_id', caller.orgId).is('deleted_at', null)
        .order('code', { ascending: true }).limit(500);
      if (error) throw internalError('copack-api', error);
      return ok(data ?? []);
    },
  },

  // -------------------------------------------------------------------------
  // kitting_jobs (parent)
  // -------------------------------------------------------------------------
  {
    method: 'GET', path: '/kitting-jobs',
    handler: async ({ req, url }) => {
      const caller = requireCaller(req);
      const status = url.searchParams.get('status');
      const warehouseId = url.searchParams.get('warehouse_id');
      const salesOrderId = url.searchParams.get('sales_order_id');
      let q = admin()
        .from('kitting_jobs').select('*')
        .eq('org_id', caller.orgId).is('deleted_at', null)
        .order('created_at', { ascending: false }).limit(200);
      if (status) q = q.eq('status', status);
      if (warehouseId) q = q.eq('warehouse_id', warehouseId);
      if (salesOrderId) q = q.eq('sales_order_id', salesOrderId);
      const { data, error } = await q;
      if (error) throw internalError('copack-api', error);
      return ok((data ?? []).map((r) => KittingJobSchema.parse(r)));
    },
  },
  {
    method: 'POST', path: '/kitting-jobs',
    handler: async ({ req }) => {
      const caller = requireCaller(req);
      requireCap(caller, 'copack.kitting_job.create');
      const body = await parseBody(req, KittingJobCreateSchema);
      return respondWithIdempotency(req, caller, BUNDLE, '/kitting-jobs', body, async () => {
        // Operator may pass a `job_number` to override; otherwise the
        // org-scoped numbering chassis allocates the next KIT- string (seeded
        // by migration 0077).
        const jobNumber = body.job_number?.trim()
          ? body.job_number.trim()
          : await nextDocNumber(caller.orgId, 'kitting_job');
        const insert: Record<string, unknown> = {
          org_id: caller.orgId,
          status: 'draft',
          job_number: jobNumber,
          sales_order_id: body.sales_order_id ?? null,
          warehouse_id: body.warehouse_id ?? null,
          planned_start_at: body.planned_start_at ?? null,
          planned_complete_at: body.planned_complete_at ?? null,
          notes: body.notes ?? null,
          payload: body.payload ?? {},
          created_by: caller.userId,
          updated_by: caller.userId,
        };
        const { data, error } = await admin().from('kitting_jobs')
          .insert(insert).select('*').single();
        if (error) throw internalError('copack-api', error);
        return created(KittingJobSchema.parse(data));
      });
    },
  },
  {
    method: 'GET', path: '/kitting-jobs/:id',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      parseUuidParam(params.id);
      const row = await loadKittingJob(caller, params.id);
      return ok(row);
    },
  },
  {
    method: 'PATCH', path: '/kitting-jobs/:id',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      requireCap(caller, 'copack.kitting_job.update');
      parseUuidParam(params.id);
      const body = await parseBody(req, KittingJobPatchSchema);
      return respondWithIdempotency(req, caller, BUNDLE, '/kitting-jobs/:id', body, async () => {
        const cur = await loadKittingJob(caller, params.id);
        if (cur.status !== 'draft') {
          throw new ApiError(
            'STATE_CONFLICT', 409,
            `kitting_job cannot be edited from status=${cur.status}`,
          );
        }
        const patch: Record<string, unknown> = {
          updated_by: caller.userId,
          updated_at: nowIso(),
        };
        if (body.job_number !== undefined) patch.job_number = body.job_number;
        if (body.sales_order_id !== undefined) patch.sales_order_id = body.sales_order_id;
        if (body.warehouse_id !== undefined) patch.warehouse_id = body.warehouse_id;
        if (body.planned_start_at !== undefined) patch.planned_start_at = body.planned_start_at;
        if (body.planned_complete_at !== undefined) patch.planned_complete_at = body.planned_complete_at;
        if (body.notes !== undefined) patch.notes = body.notes;
        if (body.payload !== undefined) patch.payload = body.payload;
        const { data, error } = await admin().from('kitting_jobs')
          .update(patch)
          .eq('org_id', caller.orgId).eq('id', params.id).is('deleted_at', null)
          .select('*').maybeSingle();
        if (error) throw internalError('copack-api', error);
        if (!data) throw new ApiError('NOT_FOUND', 404);
        return ok(KittingJobSchema.parse(data));
      });
    },
  },
  {
    method: 'DELETE', path: '/kitting-jobs/:id',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      requireCap(caller, 'copack.kitting_job.delete');
      parseUuidParam(params.id);
      return respondWithIdempotency(req, caller, BUNDLE, '/kitting-jobs/:id-delete', null, async () => {
        const cur = await loadKittingJob(caller, params.id);
        // Completed jobs have emitted stock_movements via the kitting
        // emit_movements trigger (migration 0075). Soft-deleting them would
        // orphan those movements. Refuse with 409.
        if (cur.status === 'completed') {
          throw new ApiError(
            'STATE_CONFLICT', 409,
            'kitting_job cannot be deleted after completion',
          );
        }
        const { data, error } = await admin().from('kitting_jobs')
          .update({
            deleted_at: nowIso(),
            updated_by: caller.userId,
            updated_at: nowIso(),
          })
          .eq('org_id', caller.orgId).eq('id', params.id).is('deleted_at', null)
          .select('id').maybeSingle();
        if (error) throw internalError('copack-api', error);
        if (!data) throw new ApiError('NOT_FOUND', 404);
        return ok({ id: params.id, deleted: true });
      });
    },
  },
  {
    method: 'POST', path: '/kitting-jobs/:id/start',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      requireCap(caller, 'copack.kitting_job.start');
      parseUuidParam(params.id);
      return respondWithIdempotency(req, caller, BUNDLE, '/kitting-jobs/:id/start', null, async () => {
        const cur = await loadKittingJob(caller, params.id);
        assertKittingTransition(cur.status, 'started');
        const ts = nowIso();
        const { data, error } = await admin().from('kitting_jobs')
          .update({
            status: 'started',
            started_at: ts,
            updated_by: caller.userId,
            updated_at: ts,
          })
          .eq('org_id', caller.orgId).eq('id', params.id).is('deleted_at', null)
          .select('*').maybeSingle();
        if (error) throw internalError('copack-api', error);
        if (!data) throw new ApiError('NOT_FOUND', 404);
        return ok(KittingJobSchema.parse(data));
      });
    },
  },
  {
    method: 'POST', path: '/kitting-jobs/:id/complete',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      requireCap(caller, 'copack.kitting_job.complete');
      parseUuidParam(params.id);
      return respondWithIdempotency(req, caller, BUNDLE, '/kitting-jobs/:id/complete', null, async () => {
        const cur = await loadKittingJob(caller, params.id);
        assertKittingTransition(cur.status, 'completed');
        // Stock movements are emitted by the migration-0075 trigger only when
        // warehouse_id is set. Completing without one silently records no
        // inventory effect, so refuse it and tell the operator (F-Wave10-CKSMOKE-04).
        if (!cur.warehouse_id) {
          throw new ApiError(
            'VALIDATION_ERROR', 422,
            'Assign a warehouse to this kitting job before completing it, so the consumed and produced stock movements can be recorded.',
          );
        }
        const ts = nowIso();
        // DB trigger (migration 0075) fires AFTER UPDATE OF status and writes
        // stock_movements when warehouse_id is non-null.
        const { data, error } = await admin().from('kitting_jobs')
          .update({
            status: 'completed',
            completed_at: ts,
            updated_by: caller.userId,
            updated_at: ts,
          })
          .eq('org_id', caller.orgId).eq('id', params.id).is('deleted_at', null)
          .select('*').maybeSingle();
        if (error) throw internalError('copack-api', error);
        if (!data) throw new ApiError('NOT_FOUND', 404);
        return ok(KittingJobSchema.parse(data));
      });
    },
  },
  {
    method: 'POST', path: '/kitting-jobs/:id/cancel',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      requireCap(caller, 'copack.kitting_job.cancel');
      parseUuidParam(params.id);
      return respondWithIdempotency(req, caller, BUNDLE, '/kitting-jobs/:id/cancel', null, async () => {
        const cur = await loadKittingJob(caller, params.id);
        assertKittingTransition(cur.status, 'cancelled');
        const ts = nowIso();
        const { data, error } = await admin().from('kitting_jobs')
          .update({
            status: 'cancelled',
            cancelled_at: ts,
            updated_by: caller.userId,
            updated_at: ts,
          })
          .eq('org_id', caller.orgId).eq('id', params.id).is('deleted_at', null)
          .select('*').maybeSingle();
        if (error) throw internalError('copack-api', error);
        if (!data) throw new ApiError('NOT_FOUND', 404);
        return ok(KittingJobSchema.parse(data));
      });
    },
  },

  // -------------------------------------------------------------------------
  // kitting_job_consumed_line_items (item_id REQUIRED per migration 0074)
  // -------------------------------------------------------------------------
  {
    method: 'GET', path: '/kitting-jobs/:id/consumed',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      parseUuidParam(params.id);
      await assertKittingJobParent(caller, params.id);
      const { data, error } = await admin()
        .from('kitting_job_consumed_line_items').select('*')
        .eq('org_id', caller.orgId)
        .eq('kitting_job_id', params.id)
        .order('position', { ascending: true });
      if (error) throw internalError('copack-api', error);
      return ok((data ?? []).map((r) => KittingJobConsumedLineItemSchema.parse(r)));
    },
  },
  {
    method: 'POST', path: '/kitting-jobs/:id/consumed',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      requireCap(caller, 'copack.kitting_job.line_item.create');
      parseUuidParam(params.id);
      const body = await parseBody(req, KittingJobConsumedLineItemCreateSchema);
      return respondWithIdempotency(
        req, caller, BUNDLE, '/kitting-jobs/:id/consumed', body,
        async () => {
          await assertKittingJobParent(caller, params.id);
          const position = body.position ?? await nextKittingLinePosition(
            'kitting_job_consumed_line_items', caller, params.id,
          );
          const insert = {
            org_id: caller.orgId,
            kitting_job_id: params.id,
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
            .from('kitting_job_consumed_line_items').insert(insert)
            .select('*').single();
          if (error) throw internalError('copack-api', error);
          return created(KittingJobConsumedLineItemSchema.parse(data));
        },
      );
    },
  },
  {
    method: 'PATCH', path: '/kitting-jobs/:id/consumed/:lineId',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      requireCap(caller, 'copack.kitting_job.line_item.update');
      parseUuidParam(params.id);
      parseUuidParam(params.lineId, 'lineId');
      const body = await parseBody(req, KittingJobConsumedLineItemUpdateSchema);
      return respondWithIdempotency(
        req, caller, BUNDLE, '/kitting-jobs/:id/consumed/:lineId', body,
        async () => {
          await assertKittingJobParent(caller, params.id);
          const patch: Record<string, unknown> = { updated_by: caller.userId };
          if (body.item_id !== undefined) patch.item_id = body.item_id;
          if (body.quantity !== undefined) patch.quantity = body.quantity;
          if (body.unit_cost_cents !== undefined) patch.unit_cost_cents = body.unit_cost_cents;
          if (body.uom !== undefined) patch.uom = body.uom;
          if (body.reference !== undefined) patch.reference = body.reference;
          if (body.position !== undefined) patch.position = body.position;
          const { data, error } = await admin()
            .from('kitting_job_consumed_line_items')
            .update(patch)
            .eq('org_id', caller.orgId)
            .eq('kitting_job_id', params.id)
            .eq('id', params.lineId)
            .select('*').maybeSingle();
          if (error) throw internalError('copack-api', error);
          if (!data) throw new ApiError('NOT_FOUND', 404);
          return ok(KittingJobConsumedLineItemSchema.parse(data));
        },
      );
    },
  },
  {
    method: 'DELETE', path: '/kitting-jobs/:id/consumed/:lineId',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      requireCap(caller, 'copack.kitting_job.line_item.delete');
      parseUuidParam(params.id);
      parseUuidParam(params.lineId, 'lineId');
      return respondWithIdempotency(
        req, caller, BUNDLE, '/kitting-jobs/:id/consumed/:lineId-delete', null,
        async () => {
          await assertKittingJobParent(caller, params.id);
          const { data, error } = await admin()
            .from('kitting_job_consumed_line_items').delete()
            .eq('org_id', caller.orgId)
            .eq('kitting_job_id', params.id)
            .eq('id', params.lineId)
            .select('id').maybeSingle();
          if (error) throw internalError('copack-api', error);
          if (!data) throw new ApiError('NOT_FOUND', 404);
          return ok({ id: params.lineId, deleted: true });
        },
      );
    },
  },

  // -------------------------------------------------------------------------
  // kitting_job_produced_line_items (item_id NULLABLE per migration 0074)
  // -------------------------------------------------------------------------
  {
    method: 'GET', path: '/kitting-jobs/:id/produced',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      parseUuidParam(params.id);
      await assertKittingJobParent(caller, params.id);
      const { data, error } = await admin()
        .from('kitting_job_produced_line_items').select('*')
        .eq('org_id', caller.orgId)
        .eq('kitting_job_id', params.id)
        .order('position', { ascending: true });
      if (error) throw internalError('copack-api', error);
      return ok((data ?? []).map((r) => KittingJobProducedLineItemSchema.parse(r)));
    },
  },
  {
    method: 'POST', path: '/kitting-jobs/:id/produced',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      requireCap(caller, 'copack.kitting_job.line_item.create');
      parseUuidParam(params.id);
      const body = await parseBody(req, KittingJobProducedLineItemCreateSchema);
      return respondWithIdempotency(
        req, caller, BUNDLE, '/kitting-jobs/:id/produced', body,
        async () => {
          await assertKittingJobParent(caller, params.id);
          const position = body.position ?? await nextKittingLinePosition(
            'kitting_job_produced_line_items', caller, params.id,
          );
          const insert = {
            org_id: caller.orgId,
            kitting_job_id: params.id,
            item_id: body.item_id ?? null,
            quantity: body.quantity,
            unit_cost_cents: body.unit_cost_cents ?? null,
            uom: body.uom ?? null,
            reference: body.reference ?? null,
            position,
            created_by: caller.userId,
            updated_by: caller.userId,
          };
          const { data, error } = await admin()
            .from('kitting_job_produced_line_items').insert(insert)
            .select('*').single();
          if (error) throw internalError('copack-api', error);
          return created(KittingJobProducedLineItemSchema.parse(data));
        },
      );
    },
  },
  {
    method: 'PATCH', path: '/kitting-jobs/:id/produced/:lineId',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      requireCap(caller, 'copack.kitting_job.line_item.update');
      parseUuidParam(params.id);
      parseUuidParam(params.lineId, 'lineId');
      const body = await parseBody(req, KittingJobProducedLineItemUpdateSchema);
      return respondWithIdempotency(
        req, caller, BUNDLE, '/kitting-jobs/:id/produced/:lineId', body,
        async () => {
          await assertKittingJobParent(caller, params.id);
          const patch: Record<string, unknown> = { updated_by: caller.userId };
          if (body.item_id !== undefined) patch.item_id = body.item_id;
          if (body.quantity !== undefined) patch.quantity = body.quantity;
          if (body.unit_cost_cents !== undefined) patch.unit_cost_cents = body.unit_cost_cents;
          if (body.uom !== undefined) patch.uom = body.uom;
          if (body.reference !== undefined) patch.reference = body.reference;
          if (body.position !== undefined) patch.position = body.position;
          const { data, error } = await admin()
            .from('kitting_job_produced_line_items')
            .update(patch)
            .eq('org_id', caller.orgId)
            .eq('kitting_job_id', params.id)
            .eq('id', params.lineId)
            .select('*').maybeSingle();
          if (error) throw internalError('copack-api', error);
          if (!data) throw new ApiError('NOT_FOUND', 404);
          return ok(KittingJobProducedLineItemSchema.parse(data));
        },
      );
    },
  },
  {
    method: 'DELETE', path: '/kitting-jobs/:id/produced/:lineId',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      requireCap(caller, 'copack.kitting_job.line_item.delete');
      parseUuidParam(params.id);
      parseUuidParam(params.lineId, 'lineId');
      return respondWithIdempotency(
        req, caller, BUNDLE, '/kitting-jobs/:id/produced/:lineId-delete', null,
        async () => {
          await assertKittingJobParent(caller, params.id);
          const { data, error } = await admin()
            .from('kitting_job_produced_line_items').delete()
            .eq('org_id', caller.orgId)
            .eq('kitting_job_id', params.id)
            .eq('id', params.lineId)
            .select('id').maybeSingle();
          if (error) throw internalError('copack-api', error);
          if (!data) throw new ApiError('NOT_FOUND', 404);
          return ok({ id: params.lineId, deleted: true });
        },
      );
    },
  },

  // -------------------------------------------------------------------------
  // fulfillments (parent). No PATCH/DELETE surface; the pick/pack/ship
  // lifecycle is the only mutation path after create.
  // -------------------------------------------------------------------------
  {
    method: 'GET', path: '/fulfillments',
    handler: async ({ req, url }) => {
      const caller = requireCaller(req);
      const status = url.searchParams.get('status');
      const salesOrderId = url.searchParams.get('sales_order_id');
      const warehouseId = url.searchParams.get('warehouse_id');
      let q = admin()
        .from('fulfillments').select('*')
        .eq('org_id', caller.orgId).is('deleted_at', null)
        .order('created_at', { ascending: false }).limit(200);
      if (status) q = q.eq('status', status);
      if (salesOrderId) q = q.eq('sales_order_id', salesOrderId);
      if (warehouseId) q = q.eq('warehouse_id', warehouseId);
      const { data, error } = await q;
      if (error) throw internalError('copack-api', error);
      return ok((data ?? []).map((r) => FulfillmentSchema.parse(r)));
    },
  },
  {
    method: 'POST', path: '/fulfillments',
    handler: async ({ req }) => {
      const caller = requireCaller(req);
      // No dedicated copack.fulfillment.create cap; reuse copack.fulfillment.pick
      // (owner / admin / ops already hold the full pick / pack / ship set).
      requireCap(caller, 'copack.fulfillment.pick');
      const body = await parseBody(req, FulfillmentCreateSchema);
      return respondWithIdempotency(req, caller, BUNDLE, '/fulfillments', body, async () => {
        // The parent sales_order must exist in-org and not be soft-deleted;
        // a cross-tenant or missing parent resolves to NOT_FOUND 404.
        await assertOrderParent(caller, body.sales_order_id);
        const fulfillmentNumber = body.fulfillment_number?.trim()
          ? body.fulfillment_number.trim()
          : await nextDocNumber(caller.orgId, 'fulfillment');
        const insert: Record<string, unknown> = {
          org_id: caller.orgId,
          status: 'pending',
          fulfillment_number: fulfillmentNumber,
          sales_order_id: body.sales_order_id,
          warehouse_id: body.warehouse_id ?? null,
          shipment_id: body.shipment_id ?? null,
          notes: body.notes ?? null,
          payload: body.payload ?? {},
          created_by: caller.userId,
          updated_by: caller.userId,
        };
        const { data, error } = await admin().from('fulfillments')
          .insert(insert).select('*').single();
        if (error) throw internalError('copack-api', error);
        return created(FulfillmentSchema.parse(data));
      });
    },
  },
  {
    method: 'GET', path: '/fulfillments/:id',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      parseUuidParam(params.id);
      const row = await loadFulfillment(caller, params.id);
      return ok(row);
    },
  },
  {
    method: 'POST', path: '/fulfillments/:id/pick',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      requireCap(caller, 'copack.fulfillment.pick');
      parseUuidParam(params.id);
      return respondWithIdempotency(req, caller, BUNDLE, '/fulfillments/:id/pick', null, async () => {
        const cur = await loadFulfillment(caller, params.id);
        assertFulfillmentTransition(cur.status, 'picking');
        const ts = nowIso();
        const { data, error } = await admin().from('fulfillments')
          .update({
            status: 'picking',
            picked_at: ts,
            updated_by: caller.userId,
            updated_at: ts,
          })
          .eq('org_id', caller.orgId).eq('id', params.id).is('deleted_at', null)
          .select('*').maybeSingle();
        if (error) throw internalError('copack-api', error);
        if (!data) throw new ApiError('NOT_FOUND', 404);
        return ok(FulfillmentSchema.parse(data));
      });
    },
  },
  {
    method: 'POST', path: '/fulfillments/:id/pack',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      requireCap(caller, 'copack.fulfillment.pack');
      parseUuidParam(params.id);
      return respondWithIdempotency(req, caller, BUNDLE, '/fulfillments/:id/pack', null, async () => {
        const cur = await loadFulfillment(caller, params.id);
        assertFulfillmentTransition(cur.status, 'packed');
        const ts = nowIso();
        const { data, error } = await admin().from('fulfillments')
          .update({
            status: 'packed',
            packed_at: ts,
            updated_by: caller.userId,
            updated_at: ts,
          })
          .eq('org_id', caller.orgId).eq('id', params.id).is('deleted_at', null)
          .select('*').maybeSingle();
        if (error) throw internalError('copack-api', error);
        if (!data) throw new ApiError('NOT_FOUND', 404);
        return ok(FulfillmentSchema.parse(data));
      });
    },
  },
  {
    method: 'POST', path: '/fulfillments/:id/ship',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      requireCap(caller, 'copack.fulfillment.ship');
      parseUuidParam(params.id);
      return respondWithIdempotency(req, caller, BUNDLE, '/fulfillments/:id/ship', null, async () => {
        const cur = await loadFulfillment(caller, params.id);
        assertFulfillmentTransition(cur.status, 'shipped');
        const ts = nowIso();
        // The DB trigger tg_fulfillments_advance_order (migration 0076) fires
        // AFTER this UPDATE and advances the parent sales_order to shipped when
        // it is in an active non-terminal state. The handler only sets the
        // fulfillment status; the cross-entity advance is deterministic.
        const { data, error } = await admin().from('fulfillments')
          .update({
            status: 'shipped',
            shipped_at: ts,
            updated_by: caller.userId,
            updated_at: ts,
          })
          .eq('org_id', caller.orgId).eq('id', params.id).is('deleted_at', null)
          .select('*').maybeSingle();
        if (error) throw internalError('copack-api', error);
        if (!data) throw new ApiError('NOT_FOUND', 404);
        return ok(FulfillmentSchema.parse(data));
      });
    },
  },
  {
    method: 'POST', path: '/fulfillments/:id/cancel',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      // No dedicated copack.fulfillment.cancel cap; reuse copack.fulfillment.pick.
      requireCap(caller, 'copack.fulfillment.pick');
      parseUuidParam(params.id);
      return respondWithIdempotency(req, caller, BUNDLE, '/fulfillments/:id/cancel', null, async () => {
        const cur = await loadFulfillment(caller, params.id);
        assertFulfillmentTransition(cur.status, 'cancelled');
        const ts = nowIso();
        const { data, error } = await admin().from('fulfillments')
          .update({
            status: 'cancelled',
            cancelled_at: ts,
            updated_by: caller.userId,
            updated_at: ts,
          })
          .eq('org_id', caller.orgId).eq('id', params.id).is('deleted_at', null)
          .select('*').maybeSingle();
        if (error) throw internalError('copack-api', error);
        if (!data) throw new ApiError('NOT_FOUND', 404);
        return ok(FulfillmentSchema.parse(data));
      });
    },
  },
];

// ---------------------------------------------------------------------------
// Bundle-level dispatcher: gate on plugins.copack_ecom before any route runs.
// Shared with manufacturing-api, ops-api, etc. via _shared/bundleGate.ts.
// ---------------------------------------------------------------------------

serveBundleWithGate({
  flagKey: FEATURE_FLAGS.PLUGINS_COPACK_ECOM,
  routes: TABLE,
  bundle: BUNDLE,
});
