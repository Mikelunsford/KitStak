// vendors-api: expenses handlers.

import { z } from 'zod';
import type { Route } from '../../_shared/route.ts';
import {
  ApiError, ok, admin, parseBody, parseLimit, parseUuidParam, respondWithIdempotency, created, internalError,
  requireCaller, requireCap, getByIdOrgScoped, assertRefInOrg,
  assertTransition,
} from '../shared.ts';
import {
  parseSearch, parseSort, decodeSortCursor, buildSearchOr, buildKeysetOr,
  paginateSorted, type SortSpec,
} from '../../_shared/list-query.ts';
import {
  ExpenseSchema, ExpenseStatusSchema,
  type Expense,
} from '../../_shared/types/vendors_inventory_ops.ts';
import { EXPENSE_FSM } from '../../_shared/workflow/vendors_inventory_ops.ts';

// Workstream C (UI scan): server list toolbar allowlists for expenses.
// SORT_COLS are NOT NULL columns only (created_at, status, expense_date) so
// the keyset cursor never straddles a null. expense_number is nullable (unique
// only where present), so it is a SEARCH target only, never a sort. status,
// vendor_id, and project_id stay facet filters (.eq). DEFAULT_SORT preserves
// the legacy created_at desc ordering.
const EXPENSE_SEARCH_COLS = ['expense_number'] as const;
const EXPENSE_SORT_COLS = ['created_at', 'status', 'expense_date'] as const;
const EXPENSE_DEFAULT_SORT: SortSpec = { column: 'created_at', dir: 'desc' };

const ExpCreate = z.object({
  expense_category_id: z.string().uuid().optional().nullable(),
  vendor_id: z.string().uuid().optional().nullable(),
  project_id: z.string().uuid().optional().nullable(),
  expense_number: z.string().optional().nullable(),
  expense_date: z.string().optional(),
  description: z.string().optional().nullable(),
  amount_cents: z.union([z.number().int(), z.string()]).default(0),
  tax_cents: z.union([z.number().int(), z.string()]).default(0),
  total_cents: z.union([z.number().int(), z.string()]).default(0),
  currency_code: z.string().length(3).default('USD'),
  reimbursable: z.boolean().default(false),
  receipt_url: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});
const ExpUpdate = ExpCreate.partial();
const ExpTransition = z.object({ to: ExpenseStatusSchema });

// Cap maps for transitions per action.
const TRANSITION_CAPS: Record<string, 'expenses.expense.submit' | 'expenses.expense.approve' | 'expenses.expense.pay' | 'expenses.expense.reject'> = {
  submitted: 'expenses.expense.submit',
  approved: 'expenses.expense.approve',
  paid: 'expenses.expense.pay',
  reimbursed: 'expenses.expense.pay',
  rejected: 'expenses.expense.reject',
  draft: 'expenses.expense.submit',
};

export function handleExpenses(): Route[] {
  return [
    {
      method: 'GET', path: '/expenses',
      handler: async ({ req, url }) => {
        const caller = requireCaller(req);
        requireCap(caller, 'expenses.expense.read');
        const limit = parseLimit(url);
        const sort = parseSort(url, EXPENSE_SORT_COLS, EXPENSE_DEFAULT_SORT);
        const search = parseSearch(url);
        const cursor = decodeSortCursor(url.searchParams.get('cursor'));

        let query = admin()
          .from('expenses').select('*')
          .eq('org_id', caller.orgId)
          .is('deleted_at', null);
        // F-Wave7-LISTFILTER-01: vendor_id and project_id FK filters lift
        // VendorDetailPage / project-related client-side .filter(...) into
        // a SQL where-clause. RLS Pattern A wraps the org gate so a
        // cross-tenant id still resolves to 200 + [].
        const vendorId = url.searchParams.get('vendor_id');
        if (vendorId) query = query.eq('vendor_id', vendorId);
        const projectId = url.searchParams.get('project_id');
        if (projectId) query = query.eq('project_id', projectId);
        const status = url.searchParams.get('status');
        if (status) query = query.eq('status', status);
        if (search) query = query.or(buildSearchOr(EXPENSE_SEARCH_COLS, search));
        query = query
          .order(sort.column, { ascending: sort.dir === 'asc' })
          .order('id', { ascending: sort.dir === 'asc' })
          .limit(limit + 1);
        if (cursor) query = query.or(buildKeysetOr(sort, cursor));

        const { data, error } = await query;
        if (error) throw internalError('vendors-api/expenses', error);
        const page = paginateSorted(
          (data ?? []) as Array<Record<string, unknown> & { id: string }>,
          limit,
          sort.column,
        );
        return ok(page.items.map((v) => ExpenseSchema.parse(v)), {
          next_cursor: page.next_cursor,
        });
      },
    },
    {
      method: 'POST', path: '/expenses',
      handler: async ({ req }) => {
        const caller = requireCaller(req);
        requireCap(caller, 'expenses.expense.create');
        const body = await parseBody(req, ExpCreate);
        return respondWithIdempotency(req, caller, 'vendors-api', '/expenses', body, async () => {
          if (body.expense_category_id) { await assertRefInOrg('expense_categories', caller, body.expense_category_id, { softDelete: false }); }
          if (body.vendor_id) { await assertRefInOrg('vendors', caller, body.vendor_id); }
          if (body.project_id) { await assertRefInOrg('projects', caller, body.project_id); }
          const { data, error } = await admin()
            .from('expenses')
            .insert({
              ...body, status: 'draft', org_id: caller.orgId,
              submitter_user_id: caller.userId,
              created_by: caller.userId, updated_by: caller.userId,
            })
            .select('*').single();
          if (error) throw internalError('vendors-api/expenses', error);
          return created(ExpenseSchema.parse(data));
        });
      },
    },
    {
      method: 'GET', path: '/expenses/:id',
      handler: async ({ req, params }) => {
        const caller = requireCaller(req);
        requireCap(caller, 'expenses.expense.read');
        parseUuidParam(params.id);
        const row = await getByIdOrgScoped<Expense>('expenses', caller, params.id);
        return ok(ExpenseSchema.parse(row));
      },
    },
    {
      method: 'PATCH', path: '/expenses/:id',
      handler: async ({ req, params }) => {
        const caller = requireCaller(req);
        requireCap(caller, 'expenses.expense.update');
        parseUuidParam(params.id);
        const body = await parseBody(req, ExpUpdate);
        return respondWithIdempotency(req, caller, 'vendors-api', '/expenses/:id', body, async () => {
          if (body.expense_category_id) { await assertRefInOrg('expense_categories', caller, body.expense_category_id, { softDelete: false }); }
          if (body.vendor_id) { await assertRefInOrg('vendors', caller, body.vendor_id); }
          if (body.project_id) { await assertRefInOrg('projects', caller, body.project_id); }
          const { data, error } = await admin()
            .from('expenses')
            .update({ ...body, updated_by: caller.userId, updated_at: new Date().toISOString() })
            .eq('org_id', caller.orgId).eq('id', params.id).is('deleted_at', null)
            .select('*').maybeSingle();
          if (error) throw internalError('vendors-api/expenses', error);
          if (!data) throw new ApiError('NOT_FOUND', 404);
          return ok(ExpenseSchema.parse(data));
        });
      },
    },
    {
      method: 'POST', path: '/expenses/:id/transition',
      handler: async ({ req, params }) => {
        const caller = requireCaller(req);
        parseUuidParam(params.id);
        const body = await parseBody(req, ExpTransition);
        const cap = TRANSITION_CAPS[body.to];
        if (cap) requireCap(caller, cap);
        return respondWithIdempotency(req, caller, 'vendors-api', '/expenses/:id/transition', body, async () => {
          const current = await getByIdOrgScoped<Expense>('expenses', caller, params.id);
          assertTransition(EXPENSE_FSM, current.status, body.to);
          const { data, error } = await admin()
            .from('expenses')
            .update({ status: body.to, updated_by: caller.userId, updated_at: new Date().toISOString() })
            .eq('org_id', caller.orgId).eq('id', params.id)
            .select('*').single();
          if (error) throw internalError('vendors-api/expenses', error);
          return ok(ExpenseSchema.parse(data));
        });
      },
    },
  ];
}
