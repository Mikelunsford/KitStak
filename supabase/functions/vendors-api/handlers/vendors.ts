// vendors-api: vendors handlers.

import { z } from 'zod';
import type { Route } from '../../_shared/route.ts';
import {
  ApiError, ok, admin, parseBody, parseLimit, parseUuidParam, respondWithIdempotency, created, internalError,
  requireCaller, requireCap, getByIdOrgScoped,
} from '../shared.ts';
import {
  parseSearch, parseSort, decodeSortCursor, buildSearchOr, buildKeysetOr,
  paginateSorted, type SortSpec,
} from '../../_shared/list-query.ts';
import {
  VendorSchema,
  type Vendor,
} from '../../_shared/types/vendors_inventory_ops.ts';

// Workstream C (UI scan): server list toolbar allowlists for vendors. The
// keyset cursor is keyed on the active sort column, so SORT_COLS are NOT NULL
// columns only (created_at, display_name); a null cursor value can never
// occur. vendor_number is nullable (unique only where present), so it is a
// SEARCH target alongside display_name, never a sort. DEFAULT_SORT preserves
// the legacy created_at desc ordering.
const VENDOR_SEARCH_COLS = ['display_name', 'vendor_number'] as const;
const VENDOR_SORT_COLS = ['created_at', 'display_name'] as const;
const VENDOR_DEFAULT_SORT: SortSpec = { column: 'created_at', dir: 'desc' };

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
        requireCap(caller, 'vendors.vendor.read');
        const limit = parseLimit(url);
        const sort = parseSort(url, VENDOR_SORT_COLS, VENDOR_DEFAULT_SORT);
        const search = parseSearch(url);
        const cursor = decodeSortCursor(url.searchParams.get('cursor'));

        let query = admin()
          .from('vendors').select('*')
          .eq('org_id', caller.orgId)
          .is('deleted_at', null);
        if (search) query = query.or(buildSearchOr(VENDOR_SEARCH_COLS, search));
        query = query
          .order(sort.column, { ascending: sort.dir === 'asc' })
          .order('id', { ascending: sort.dir === 'asc' })
          .limit(limit + 1);
        if (cursor) query = query.or(buildKeysetOr(sort, cursor));

        const { data, error } = await query;
        if (error) throw internalError('vendors-api/vendors', error);
        const page = paginateSorted(
          (data ?? []) as Array<Record<string, unknown> & { id: string }>,
          limit,
          sort.column,
        );
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
        requireCap(caller, 'vendors.vendor.create');
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
            if (error) throw internalError('vendors-api/vendors', error);
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
        requireCap(caller, 'vendors.vendor.read');
        parseUuidParam(params.id);
        const row = await getByIdOrgScoped<Vendor>('vendors', caller, params.id);
        return ok(VendorSchema.parse(row));
      },
    },
    {
      method: 'PATCH',
      path: '/vendors/:id',
      handler: async ({ req, params }) => {
        const caller = requireCaller(req);
        requireCap(caller, 'vendors.vendor.update');
        parseUuidParam(params.id);
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
            if (error) throw internalError('vendors-api/vendors', error);
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
        requireCap(caller, 'vendors.vendor.delete');
        parseUuidParam(params.id);
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
            if (error) throw internalError('vendors-api/vendors', error);
            return ok({ id: params.id, deleted: true });
          },
        );
      },
    },
  ];
}
