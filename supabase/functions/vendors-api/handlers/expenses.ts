// vendors-api: expenses handlers.

import { z } from 'https://esm.sh/zod@3.23.8';
import type { Route } from '../../_shared/route.ts';
import {
  ApiError, ok, admin, parseBody, respondWithIdempotency, created,
  requireCaller, requireVioCap, listOrgScoped, getByIdOrgScoped,
  assertTransition,
} from '../shared.ts';
import {
  ExpenseSchema, ExpenseStatusSchema,
  type Expense,
} from '../../_shared/types/vendors_inventory_ops.ts';
import { EXPENSE_FSM } from '../../_shared/workflow/vendors_inventory_ops.ts';

const ExpCreate = z.object({
  expense_category_id: z.string().uuid().optional().nullable(),
  vendor_id: z.string().uuid().optional().nullable(),
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
        requireVioCap(caller, 'expenses.expense.read');
        const page = await listOrgScoped<Expense>('expenses', caller, url);
        return ok(page.items.map((v) => ExpenseSchema.parse(v)), {
          next_cursor: page.next_cursor,
        });
      },
    },
    {
      method: 'POST', path: '/expenses',
      handler: async ({ req }) => {
        const caller = requireCaller(req);
        requireVioCap(caller, 'expenses.expense.create');
        const body = await parseBody(req, ExpCreate);
        return respondWithIdempotency(req, caller, 'vendors-api', '/expenses', body, async () => {
          const { data, error } = await admin()
            .from('expenses')
            .insert({
              ...body, status: 'draft', org_id: caller.orgId,
              submitter_user_id: caller.userId,
              created_by: caller.userId, updated_by: caller.userId,
            })
            .select('*').single();
          if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
          return created(ExpenseSchema.parse(data));
        });
      },
    },
    {
      method: 'GET', path: '/expenses/:id',
      handler: async ({ req, params }) => {
        const caller = requireCaller(req);
        requireVioCap(caller, 'expenses.expense.read');
        const row = await getByIdOrgScoped<Expense>('expenses', caller, params.id);
        return ok(ExpenseSchema.parse(row));
      },
    },
    {
      method: 'PATCH', path: '/expenses/:id',
      handler: async ({ req, params }) => {
        const caller = requireCaller(req);
        requireVioCap(caller, 'expenses.expense.update');
        const body = await parseBody(req, ExpUpdate);
        return respondWithIdempotency(req, caller, 'vendors-api', '/expenses/:id', body, async () => {
          const { data, error } = await admin()
            .from('expenses')
            .update({ ...body, updated_by: caller.userId, updated_at: new Date().toISOString() })
            .eq('org_id', caller.orgId).eq('id', params.id).is('deleted_at', null)
            .select('*').maybeSingle();
          if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
          if (!data) throw new ApiError('NOT_FOUND', 404);
          return ok(ExpenseSchema.parse(data));
        });
      },
    },
    {
      method: 'POST', path: '/expenses/:id/transition',
      handler: async ({ req, params }) => {
        const caller = requireCaller(req);
        const body = await parseBody(req, ExpTransition);
        const cap = TRANSITION_CAPS[body.to];
        if (cap) requireVioCap(caller, cap);
        return respondWithIdempotency(req, caller, 'vendors-api', '/expenses/:id/transition', body, async () => {
          const current = await getByIdOrgScoped<Expense>('expenses', caller, params.id);
          assertTransition(EXPENSE_FSM, current.status, body.to);
          const { data, error } = await admin()
            .from('expenses')
            .update({ status: body.to, updated_by: caller.userId, updated_at: new Date().toISOString() })
            .eq('org_id', caller.orgId).eq('id', params.id)
            .select('*').single();
          if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
          return ok(ExpenseSchema.parse(data));
        });
      },
    },
  ];
}
