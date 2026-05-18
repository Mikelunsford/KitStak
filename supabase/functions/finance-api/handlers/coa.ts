// finance-api chart_of_accounts handlers.
//   GET    /coa
//   POST   /coa
//   GET    /coa/:id
//   PATCH  /coa/:id
//   DELETE /coa/:id

import { z } from 'https://esm.sh/zod@3.23.8';

import type { RouteCtx } from '../../_shared/route.ts';
import { ApiError, ok, created, noContent } from '../../_shared/responses.ts';
import {
  admin,
  parseBody,
  respondWithIdempotency,
} from '../../_shared/handler-helpers.ts';
import { requireCaller } from '../../_shared/tenant.ts';
import {
  AccountTypeSchema,
  ChartOfAccountSchema,
  type ChartOfAccount,
} from '../../_shared/types/finance.ts';
import { requireFinanceCap, BUNDLE } from '../_helpers.ts';

const COA_COLS =
  'id, org_id, code, name, account_type, parent_account_id, is_active, ' +
  'is_system, description, created_at, updated_at';

const CoaCreateSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  account_type: AccountTypeSchema,
  parent_account_id: z.string().uuid().optional(),
  is_active: z.boolean().default(true),
  description: z.string().optional(),
});

const CoaPatchSchema = CoaCreateSchema.partial();

function rowToCoa(row: unknown): ChartOfAccount {
  return ChartOfAccountSchema.parse(row);
}

async function fetchCoa(orgId: string, id: string) {
  const { data, error } = await admin()
    .from('chart_of_accounts')
    .select(COA_COLS)
    .eq('id', id)
    .eq('org_id', orgId)
    .maybeSingle();
  if (error) {
    throw new ApiError('INTERNAL_ERROR', 500, 'coa lookup failed', {
      detail: error.message,
    });
  }
  if (!data) throw new ApiError('NOT_FOUND', 404, 'account not found');
  return data;
}

export async function listCoa({ req }: RouteCtx): Promise<Response> {
  const caller = requireCaller(req);
  requireFinanceCap(caller, 'coa.read');
  const { data, error } = await admin()
    .from('chart_of_accounts')
    .select(COA_COLS)
    .eq('org_id', caller.orgId)
    .order('code', { ascending: true });
  if (error) {
    throw new ApiError('INTERNAL_ERROR', 500, 'coa list failed', {
      detail: error.message,
    });
  }
  return ok((data ?? []).map(rowToCoa));
}

export async function getCoa({ req, params }: RouteCtx): Promise<Response> {
  const caller = requireCaller(req);
  requireFinanceCap(caller, 'coa.read');
  return ok(rowToCoa(await fetchCoa(caller.orgId, params.id!)));
}

export async function createCoa(ctx: RouteCtx): Promise<Response> {
  const caller = requireCaller(ctx.req);
  requireFinanceCap(caller, 'coa.write');
  const body = await parseBody(ctx.req, CoaCreateSchema);
  return respondWithIdempotency(
    ctx.req,
    caller,
    BUNDLE,
    `${ctx.req.method} /coa`,
    body,
    async () => {
      const insert = {
        org_id: caller.orgId,
        code: body.code,
        name: body.name,
        account_type: body.account_type,
        parent_account_id: body.parent_account_id ?? null,
        is_active: body.is_active,
        description: body.description ?? null,
        created_by: caller.userId,
        updated_by: caller.userId,
      };
      const { data, error } = await admin()
        .from('chart_of_accounts')
        .insert(insert)
        .select(COA_COLS)
        .single();
      if (error) {
        throw new ApiError('INTERNAL_ERROR', 500, 'coa insert failed', {
          detail: error.message,
        });
      }
      return created(rowToCoa(data));
    },
  );
}

export async function patchCoa(ctx: RouteCtx): Promise<Response> {
  const caller = requireCaller(ctx.req);
  requireFinanceCap(caller, 'coa.write');
  const id = ctx.params.id!;
  const body = await parseBody(ctx.req, CoaPatchSchema);
  return respondWithIdempotency(
    ctx.req,
    caller,
    BUNDLE,
    `${ctx.req.method} /coa/:id`,
    body,
    async () => {
      await fetchCoa(caller.orgId, id);
      const patch: Record<string, unknown> = { updated_by: caller.userId };
      for (const [k, v] of Object.entries(body)) {
        if (v !== undefined) patch[k] = v;
      }
      const { data, error } = await admin()
        .from('chart_of_accounts')
        .update(patch)
        .eq('id', id)
        .eq('org_id', caller.orgId)
        .select(COA_COLS)
        .single();
      if (error) {
        throw new ApiError('INTERNAL_ERROR', 500, 'coa update failed', {
          detail: error.message,
        });
      }
      return ok(rowToCoa(data));
    },
  );
}

export async function deleteCoa(ctx: RouteCtx): Promise<Response> {
  const caller = requireCaller(ctx.req);
  requireFinanceCap(caller, 'coa.delete');
  const id = ctx.params.id!;
  return respondWithIdempotency(
    ctx.req,
    caller,
    BUNDLE,
    `${ctx.req.method} /coa/:id`,
    null,
    async () => {
      const row = await fetchCoa(caller.orgId, id) as { is_system?: boolean };
      if (row.is_system) {
        throw new ApiError(
          'STATE_CONFLICT',
          409,
          'system accounts cannot be deleted',
        );
      }
      const { error } = await admin()
        .from('chart_of_accounts')
        .delete()
        .eq('id', id)
        .eq('org_id', caller.orgId);
      if (error) {
        throw new ApiError('INTERNAL_ERROR', 500, 'coa delete failed', {
          detail: error.message,
        });
      }
      return noContent();
    },
  );
}
