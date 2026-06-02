// vendors-api: vendor_bills + vendor_bill_payments handlers.

import { z } from 'zod';
import type { Route } from '../../_shared/route.ts';
import {
  ApiError, ok, admin, parseBody, parseUuidParam, respondWithIdempotency, created, internalError,
  requireCaller, requireCap, listOrgScoped, getByIdOrgScoped,
  assertTransition,
} from '../shared.ts';
import {
  VendorBillSchema, VendorBillStatusSchema, VendorBillPaymentSchema,
  type VendorBill,
} from '../../_shared/types/vendors_inventory_ops.ts';
import { VENDOR_BILL_FSM } from '../../_shared/workflow/vendors_inventory_ops.ts';

const BillCreateInput = z.object({
  vendor_id: z.string().uuid(),
  purchase_order_id: z.string().uuid().optional().nullable(),
  bill_number: z.string().optional().nullable(),
  bill_date: z.string().optional(),
  due_date: z.string().optional().nullable(),
  currency_code: z.string().length(3).default('USD'),
  subtotal_cents: z.union([z.number().int(), z.string()]).default(0),
  tax_cents: z.union([z.number().int(), z.string()]).default(0),
  total_cents: z.union([z.number().int(), z.string()]).default(0),
  notes: z.string().optional().nullable(),
  reference: z.string().optional().nullable(),
});
const BillUpdateInput = BillCreateInput.partial();
const BillTransitionInput = z.object({ to: VendorBillStatusSchema });
const PaymentInput = z.object({
  payment_date: z.string().optional(),
  amount_cents: z.union([z.number().int(), z.string()]),
  currency_code: z.string().length(3).default('USD'),
  method: z.string().optional().nullable(),
  reference: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

export function handleVendorBills(): Route[] {
  return [
    {
      method: 'GET', path: '/vendor-bills',
      handler: async ({ req, url }) => {
        const caller = requireCaller(req);
        requireCap(caller, 'vendor_bills.vendor_bill.read');
        // F-Wave7-LISTFILTER-01: vendor_id FK filter lifts VendorDetailPage
        // client-side .filter(...) into a SQL where-clause. RLS Pattern A
        // wraps the org gate so a cross-tenant vendor_id still 200 + [].
        const vendorId = url.searchParams.get('vendor_id');
        const filters: Array<[string, string, string]> = [];
        if (vendorId) filters.push(['vendor_id', 'eq', vendorId]);
        const page = await listOrgScoped<VendorBill>('vendor_bills', caller, url, { filters });
        return ok(page.items.map((v) => VendorBillSchema.parse(v)), {
          next_cursor: page.next_cursor,
        });
      },
    },
    {
      method: 'POST', path: '/vendor-bills',
      handler: async ({ req }) => {
        const caller = requireCaller(req);
        requireCap(caller, 'vendor_bills.vendor_bill.create');
        const body = await parseBody(req, BillCreateInput);
        return respondWithIdempotency(req, caller, 'vendors-api', '/vendor-bills', body, async () => {
          const { data, error } = await admin()
            .from('vendor_bills')
            .insert({
              ...body, status: 'draft', org_id: caller.orgId,
              created_by: caller.userId, updated_by: caller.userId,
            })
            .select('*').single();
          if (error) throw internalError('vendors-api/vendor-bills', error);
          return created(VendorBillSchema.parse(data));
        });
      },
    },
    {
      method: 'GET', path: '/vendor-bills/:id',
      handler: async ({ req, params }) => {
        const caller = requireCaller(req);
        requireCap(caller, 'vendor_bills.vendor_bill.read');
        parseUuidParam(params.id);
        const row = await getByIdOrgScoped<VendorBill>('vendor_bills', caller, params.id);
        return ok(VendorBillSchema.parse(row));
      },
    },
    {
      method: 'PATCH', path: '/vendor-bills/:id',
      handler: async ({ req, params }) => {
        const caller = requireCaller(req);
        requireCap(caller, 'vendor_bills.vendor_bill.update');
        parseUuidParam(params.id);
        const body = await parseBody(req, BillUpdateInput);
        return respondWithIdempotency(req, caller, 'vendors-api', '/vendor-bills/:id', body, async () => {
          const { data, error } = await admin()
            .from('vendor_bills')
            .update({ ...body, updated_by: caller.userId, updated_at: new Date().toISOString() })
            .eq('org_id', caller.orgId).eq('id', params.id).is('deleted_at', null)
            .select('*').maybeSingle();
          if (error) throw internalError('vendors-api/vendor-bills', error);
          if (!data) throw new ApiError('NOT_FOUND', 404);
          return ok(VendorBillSchema.parse(data));
        });
      },
    },
    {
      method: 'POST', path: '/vendor-bills/:id/transition',
      handler: async ({ req, params }) => {
        const caller = requireCaller(req);
        requireCap(caller, 'vendor_bills.vendor_bill.transition');
        parseUuidParam(params.id);
        const body = await parseBody(req, BillTransitionInput);
        return respondWithIdempotency(req, caller, 'vendors-api', '/vendor-bills/:id/transition', body, async () => {
          const current = await getByIdOrgScoped<VendorBill>('vendor_bills', caller, params.id);
          assertTransition(VENDOR_BILL_FSM, current.status, body.to);
          const { data, error } = await admin()
            .from('vendor_bills')
            .update({ status: body.to, updated_by: caller.userId, updated_at: new Date().toISOString() })
            .eq('org_id', caller.orgId).eq('id', params.id)
            .select('*').single();
          if (error) throw internalError('vendors-api/vendor-bills', error);
          return ok(VendorBillSchema.parse(data));
        });
      },
    },
    {
      method: 'GET', path: '/vendor-bills/:id/payments',
      handler: async ({ req, params }) => {
        const caller = requireCaller(req);
        requireCap(caller, 'vendor_bills.vendor_bill.read');
        parseUuidParam(params.id);
        await getByIdOrgScoped<VendorBill>('vendor_bills', caller, params.id);
        const { data, error } = await admin()
          .from('vendor_bill_payments')
          .select('*')
          .eq('vendor_bill_id', params.id)
          .order('payment_date', { ascending: false });
        if (error) throw internalError('vendors-api/vendor-bills', error);
        return ok((data ?? []).map((r) => VendorBillPaymentSchema.parse(r)));
      },
    },
    {
      method: 'POST', path: '/vendor-bills/:id/payments',
      handler: async ({ req, params }) => {
        const caller = requireCaller(req);
        requireCap(caller, 'vendor_bills.payment.write');
        parseUuidParam(params.id);
        const body = await parseBody(req, PaymentInput);
        return respondWithIdempotency(req, caller, 'vendors-api', '/vendor-bills/:id/payments', body, async () => {
          await getByIdOrgScoped<VendorBill>('vendor_bills', caller, params.id);
          const { data, error } = await admin()
            .from('vendor_bill_payments')
            .insert({
              ...body, vendor_bill_id: params.id,
              created_by: caller.userId, updated_by: caller.userId,
            })
            .select('*').single();
          if (error) throw internalError('vendors-api/vendor-bills', error);
          return created(VendorBillPaymentSchema.parse(data));
        });
      },
    },
  ];
}
