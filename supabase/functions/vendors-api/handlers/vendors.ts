// vendors-api: vendors handlers.

import { z } from 'https://esm.sh/zod@3.23.8';
import type { Route } from '../../_shared/route.ts';
import {
  ApiError, ok, admin, parseBody, respondWithIdempotency, created,
  requireCaller, requireVioCap, listOrgScoped, getByIdOrgScoped,
} from '../shared.ts';
import {
  VendorSchema,
  type Vendor,
} from '../../_shared/types/vendors_inventory_ops.ts';

const VendorCreateInput = z.object({
  display_name: z.string().min(1),
  vendor_number: z.string().optional().nullable(),
  legal_name: z.string().optional().nullable(),
  email: z.string().email().optional().nullable(),
  phone: z.string().optional().nullable(),
  website: z.string().optional().nullable(),
  tax_id: z.string().optional().nullable(),
  default_currency_code: z.string().length(3).default('USD'),
  default_payment_terms_days: z.number().int().min(0).default(30),
  notes: z.string().optional().nullable(),
  address_line1: z.string().optional().nullable(),
  address_line2: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  region: z.string().optional().nullable(),
  postal_code: z.string().optional().nullable(),
  country_code: z.string().optional().nullable(),
});

const VendorUpdateInput = VendorCreateInput.partial();

export function handleVendors(): Route[] {
  return [
    {
      method: 'GET',
      path: '/vendors',
      handler: async ({ req, url }) => {
        const caller = requireCaller(req);
        requireVioCap(caller, 'vendors.vendor.read');
        const page = await listOrgScoped<Vendor>('vendors', caller, url);
        return ok(page.items.map((v) => VendorSchema.parse(v)), {
          next_cursor: page.next_cursor,
        });
      },
    },
    {
      method: 'POST',
      path: '/vendors',
      handler: async ({ req }) => {
        const caller = requireCaller(req);
        requireVioCap(caller, 'vendors.vendor.create');
        const body = await parseBody(req, VendorCreateInput);
        return respondWithIdempotency(
          req, caller, 'vendors-api', '/vendors', body,
          async () => {
            const { data, error } = await admin()
              .from('vendors')
              .insert({
                ...body,
                org_id: caller.orgId,
                created_by: caller.userId,
                updated_by: caller.userId,
              })
              .select('*')
              .single();
            if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
            return created(VendorSchema.parse(data));
          },
        );
      },
    },
    {
      method: 'GET',
      path: '/vendors/:id',
      handler: async ({ req, params }) => {
        const caller = requireCaller(req);
        requireVioCap(caller, 'vendors.vendor.read');
        const row = await getByIdOrgScoped<Vendor>('vendors', caller, params.id);
        return ok(VendorSchema.parse(row));
      },
    },
    {
      method: 'PATCH',
      path: '/vendors/:id',
      handler: async ({ req, params }) => {
        const caller = requireCaller(req);
        requireVioCap(caller, 'vendors.vendor.update');
        const body = await parseBody(req, VendorUpdateInput);
        return respondWithIdempotency(
          req, caller, 'vendors-api', '/vendors/:id', body,
          async () => {
            const { data, error } = await admin()
              .from('vendors')
              .update({ ...body, updated_by: caller.userId, updated_at: new Date().toISOString() })
              .eq('org_id', caller.orgId)
              .eq('id', params.id)
              .is('deleted_at', null)
              .select('*')
              .maybeSingle();
            if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
            if (!data) throw new ApiError('NOT_FOUND', 404);
            return ok(VendorSchema.parse(data));
          },
        );
      },
    },
    {
      method: 'DELETE',
      path: '/vendors/:id',
      handler: async ({ req, params }) => {
        const caller = requireCaller(req);
        requireVioCap(caller, 'vendors.vendor.delete');
        return respondWithIdempotency(
          req, caller, 'vendors-api', '/vendors/:id', null,
          async () => {
            const { error } = await admin()
              .from('vendors')
              .update({
                deleted_at: new Date().toISOString(),
                updated_by: caller.userId,
              })
              .eq('org_id', caller.orgId)
              .eq('id', params.id);
            if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
            return ok({ id: params.id, deleted: true });
          },
        );
      },
    },
  ];
}
