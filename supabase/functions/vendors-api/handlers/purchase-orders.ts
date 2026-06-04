// vendors-api: purchase_orders + po_line_items handlers.

import { z } from 'zod';
import type { Route } from '../../_shared/route.ts';
import {
  ApiError, ok, admin, parseBody, parseUuidParam, respondWithIdempotency, created, internalError,
  requireCaller, requireCap, listOrgScoped, getByIdOrgScoped, assertRefInOrg,
  assertTransition,
} from '../shared.ts';
import {
  PurchaseOrderSchema, PurchaseOrderStatusSchema, PoLineItemSchema,
  type PurchaseOrder, type PoLineItem,
} from '../../_shared/types/vendors_inventory_ops.ts';
import { PURCHASE_ORDER_FSM } from '../../_shared/workflow/vendors_inventory_ops.ts';
import { roundHalfEven } from '../../_shared/money.ts';

const PoCreateInput = z.object({
  vendor_id: z.string().uuid(),
  warehouse_id: z.string().uuid().optional().nullable(),
  po_number: z.string().optional().nullable(),
  currency_code: z.string().length(3).default('USD'),
  order_date: z.string().optional(),
  expected_date: z.string().optional().nullable(),
  shipping_cents: z.union([z.number().int(), z.string()]).optional(),
  notes: z.string().optional().nullable(),
  reference: z.string().optional().nullable(),
});

const PoUpdateInput = PoCreateInput.partial();

const PoTransitionInput = z.object({
  to: PurchaseOrderStatusSchema,
});

const PoLineInput = z.object({
  item_id: z.string().uuid().optional().nullable(),
  description: z.string().min(1),
  quantity_ordered: z.union([z.number(), z.string()]).default(0),
  unit_price_cents: z.union([z.number().int(), z.string()]).default(0),
  tax_rate_bps: z.number().int().default(0),
  sort_order: z.number().int().default(0),
});

const PoLineUpdateInput = PoLineInput.partial().extend({
  quantity_received: z.union([z.number(), z.string()]).optional(),
});

export function lineComputed(line: {
  quantity_ordered: number | string;
  unit_price_cents: number | string;
  tax_rate_bps: number;
}): { line_subtotal_cents: number; line_tax_cents: number; line_total_cents: number } {
  // A2 (WS-A MONEY INTEGRITY): banker's rounding on money, never Math.round.
  // A6 (doc): currency is snapshotted at the document-header grain
  // (purchase_orders.currency_code); PO lines carry no per-line currency by
  // design (single-currency-per-document domain).
  const qty = Number(line.quantity_ordered);
  const unit = Number(line.unit_price_cents);
  const sub = roundHalfEven(qty * unit);
  const tax = roundHalfEven((sub * line.tax_rate_bps) / 10000);
  return { line_subtotal_cents: sub, line_tax_cents: tax, line_total_cents: sub + tax };
}

export function handlePurchaseOrders(): Route[] {
  return [
    {
      method: 'GET', path: '/purchase-orders',
      handler: async ({ req, url }) => {
        const caller = requireCaller(req);
        requireCap(caller, 'purchase_orders.purchase_order.read');
        // F-Wave7-LISTFILTER-01: vendor_id FK filter lifts VendorDetailPage
        // client-side .filter(...) into a SQL where-clause. RLS Pattern A
        // wraps the org gate so a cross-tenant vendor_id still 200 + [].
        const vendorId = url.searchParams.get('vendor_id');
        const filters: Array<[string, string, string]> = [];
        if (vendorId) filters.push(['vendor_id', 'eq', vendorId]);
        const page = await listOrgScoped<PurchaseOrder>('purchase_orders', caller, url, { filters });
        return ok(page.items.map((v) => PurchaseOrderSchema.parse(v)), {
          next_cursor: page.next_cursor,
        });
      },
    },
    {
      method: 'POST', path: '/purchase-orders',
      handler: async ({ req }) => {
        const caller = requireCaller(req);
        requireCap(caller, 'purchase_orders.purchase_order.create');
        const body = await parseBody(req, PoCreateInput);
        return respondWithIdempotency(req, caller, 'vendors-api', '/purchase-orders', body, async () => {
          if (body.vendor_id) { await assertRefInOrg('vendors', caller, body.vendor_id); }
          const { data, error } = await admin()
            .from('purchase_orders')
            .insert({
              ...body,
              status: 'draft',
              org_id: caller.orgId,
              created_by: caller.userId,
              updated_by: caller.userId,
            })
            .select('*')
            .single();
          if (error) throw internalError('vendors-api/purchase-orders', error);
          return created(PurchaseOrderSchema.parse(data));
        });
      },
    },
    {
      method: 'GET', path: '/purchase-orders/:id',
      handler: async ({ req, params }) => {
        const caller = requireCaller(req);
        requireCap(caller, 'purchase_orders.purchase_order.read');
        parseUuidParam(params.id);
        const row = await getByIdOrgScoped<PurchaseOrder>('purchase_orders', caller, params.id);
        return ok(PurchaseOrderSchema.parse(row));
      },
    },
    {
      method: 'PATCH', path: '/purchase-orders/:id',
      handler: async ({ req, params }) => {
        const caller = requireCaller(req);
        requireCap(caller, 'purchase_orders.purchase_order.update');
        parseUuidParam(params.id);
        const body = await parseBody(req, PoUpdateInput);
        return respondWithIdempotency(req, caller, 'vendors-api', '/purchase-orders/:id', body, async () => {
          if (body.vendor_id) { await assertRefInOrg('vendors', caller, body.vendor_id); }
          const { data, error } = await admin()
            .from('purchase_orders')
            .update({ ...body, updated_by: caller.userId, updated_at: new Date().toISOString() })
            .eq('org_id', caller.orgId).eq('id', params.id).is('deleted_at', null)
            .select('*').maybeSingle();
          if (error) throw internalError('vendors-api/purchase-orders', error);
          if (!data) throw new ApiError('NOT_FOUND', 404);
          return ok(PurchaseOrderSchema.parse(data));
        });
      },
    },
    {
      method: 'POST', path: '/purchase-orders/:id/transition',
      handler: async ({ req, params }) => {
        const caller = requireCaller(req);
        requireCap(caller, 'purchase_orders.purchase_order.transition');
        parseUuidParam(params.id);
        const body = await parseBody(req, PoTransitionInput);
        return respondWithIdempotency(req, caller, 'vendors-api', '/purchase-orders/:id/transition', body, async () => {
          const current = await getByIdOrgScoped<PurchaseOrder>('purchase_orders', caller, params.id);
          assertTransition(PURCHASE_ORDER_FSM, current.status, body.to);
          const { data, error } = await admin()
            .from('purchase_orders')
            .update({ status: body.to, updated_by: caller.userId, updated_at: new Date().toISOString() })
            .eq('org_id', caller.orgId).eq('id', params.id)
            .select('*').single();
          if (error) throw internalError('vendors-api/purchase-orders', error);
          return ok(PurchaseOrderSchema.parse(data));
        });
      },
    },
    {
      method: 'GET', path: '/purchase-orders/:id/line-items',
      handler: async ({ req, params }) => {
        const caller = requireCaller(req);
        requireCap(caller, 'purchase_orders.purchase_order.read');
        parseUuidParam(params.id);
        await getByIdOrgScoped<PurchaseOrder>('purchase_orders', caller, params.id);
        const { data, error } = await admin()
          .from('po_line_items')
          .select('*')
          .eq('purchase_order_id', params.id)
          .order('sort_order', { ascending: true });
        if (error) throw internalError('vendors-api/purchase-orders', error);
        return ok((data ?? []).map((r) => PoLineItemSchema.parse(r)));
      },
    },
    {
      method: 'POST', path: '/purchase-orders/:id/line-items',
      handler: async ({ req, params }) => {
        const caller = requireCaller(req);
        requireCap(caller, 'purchase_orders.line_item.write');
        parseUuidParam(params.id);
        const body = await parseBody(req, PoLineInput);
        return respondWithIdempotency(req, caller, 'vendors-api', '/purchase-orders/:id/line-items', body, async () => {
          await getByIdOrgScoped<PurchaseOrder>('purchase_orders', caller, params.id);
          if (body.item_id) { await assertRefInOrg('items', caller, body.item_id); }
          const computed = lineComputed(body);
          const { data, error } = await admin()
            .from('po_line_items')
            .insert({
              ...body, ...computed,
              purchase_order_id: params.id,
              quantity_received: 0,
            })
            .select('*').single();
          if (error) throw internalError('vendors-api/purchase-orders', error);
          return created(PoLineItemSchema.parse(data));
        });
      },
    },
    {
      method: 'PATCH', path: '/purchase-orders/:id/line-items/:lid',
      handler: async ({ req, params }) => {
        const caller = requireCaller(req);
        requireCap(caller, 'purchase_orders.line_item.write');
        parseUuidParam(params.id);
        parseUuidParam(params.lid, 'lid');
        const body = await parseBody(req, PoLineUpdateInput);
        return respondWithIdempotency(req, caller, 'vendors-api', '/purchase-orders/:id/line-items/:lid', body, async () => {
          await getByIdOrgScoped<PurchaseOrder>('purchase_orders', caller, params.id);
          if (body.item_id) { await assertRefInOrg('items', caller, body.item_id); }
          const existing = await admin().from('po_line_items').select('*')
            .eq('id', params.lid).eq('purchase_order_id', params.id).maybeSingle();
          if (existing.error) throw internalError('vendors-api/purchase-orders', existing.error);
          if (!existing.data) throw new ApiError('NOT_FOUND', 404);

          const merged = { ...existing.data, ...body } as Record<string, unknown>;
          const computed = lineComputed({
            quantity_ordered: (merged.quantity_ordered as number | string) ?? 0,
            unit_price_cents: (merged.unit_price_cents as number | string) ?? 0,
            tax_rate_bps: Number(merged.tax_rate_bps ?? 0),
          });
          const { data, error } = await admin()
            .from('po_line_items')
            .update({ ...body, ...computed, updated_at: new Date().toISOString() })
            .eq('id', params.lid).eq('purchase_order_id', params.id)
            .select('*').single();
          if (error) throw internalError('vendors-api/purchase-orders', error);
          return ok(PoLineItemSchema.parse(data));
        });
      },
    },
    {
      method: 'DELETE', path: '/purchase-orders/:id/line-items/:lid',
      handler: async ({ req, params }) => {
        const caller = requireCaller(req);
        requireCap(caller, 'purchase_orders.line_item.write');
        parseUuidParam(params.id);
        parseUuidParam(params.lid, 'lid');
        return respondWithIdempotency(req, caller, 'vendors-api', '/purchase-orders/:id/line-items/:lid', null, async () => {
          await getByIdOrgScoped<PurchaseOrder>('purchase_orders', caller, params.id);
          const { error } = await admin()
            .from('po_line_items').delete()
            .eq('id', params.lid).eq('purchase_order_id', params.id);
          if (error) throw internalError('vendors-api/purchase-orders', error);
          return ok({ id: params.lid, deleted: true });
        });
      },
    },
  ];
}
