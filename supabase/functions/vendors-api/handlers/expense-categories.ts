// vendors-api: expense_categories handlers.

import { z } from 'zod';
import type { Route } from '../../_shared/route.ts';
import {
  ApiError, ok, admin, parseBody, parseUuidParam, respondWithIdempotency, created, internalError,
  requireCaller, requireCap,
} from '../shared.ts';
import {
  ExpenseCategorySchema,
} from '../../_shared/types/vendors_inventory_ops.ts';

const Input = z.object({
  code: z.string().min(1),
  display_name: z.string().min(1),
  description: z.string().optional().nullable(),
  is_active: z.boolean().default(true),
});
const UpdateInput = Input.partial();

export function handleExpenseCategories(): Route[] {
  return [
    {
      method: 'GET', path: '/expense-categories',
      handler: async ({ req }) => {
        const caller = requireCaller(req);
        requireCap(caller, 'expenses.expense.read');
        const { data, error } = await admin()
          .from('expense_categories')
          .select('*')
          .eq('org_id', caller.orgId)
          .order('code', { ascending: true });
        if (error) throw internalError('vendors-api/expense-categories', error);
        return ok((data ?? []).map((r) => ExpenseCategorySchema.parse(r)));
      },
    },
    {
      method: 'POST', path: '/expense-categories',
      handler: async ({ req }) => {
        const caller = requireCaller(req);
        requireCap(caller, 'expenses.category.write');
        const body = await parseBody(req, Input);
        return respondWithIdempotency(req, caller, 'vendors-api', '/expense-categories', body, async () => {
          const { data, error } = await admin()
            .from('expense_categories')
            .insert({
              ...body, org_id: caller.orgId,
              created_by: caller.userId, updated_by: caller.userId,
            })
            .select('*').single();
          if (error) throw internalError('vendors-api/expense-categories', error);
          return created(ExpenseCategorySchema.parse(data));
        });
      },
    },
    {
      method: 'PATCH', path: '/expense-categories/:id',
      handler: async ({ req, params }) => {
        const caller = requireCaller(req);
        requireCap(caller, 'expenses.category.write');
        parseUuidParam(params.id);
        const body = await parseBody(req, UpdateInput);
        return respondWithIdempotency(req, caller, 'vendors-api', '/expense-categories/:id', body, async () => {
          const { data, error } = await admin()
            .from('expense_categories')
            .update({ ...body, updated_by: caller.userId, updated_at: new Date().toISOString() })
            .eq('org_id', caller.orgId).eq('id', params.id)
            .select('*').maybeSingle();
          if (error) throw internalError('vendors-api/expense-categories', error);
          if (!data) throw new ApiError('NOT_FOUND', 404);
          return ok(ExpenseCategorySchema.parse(data));
        });
      },
    },
  ];
}
