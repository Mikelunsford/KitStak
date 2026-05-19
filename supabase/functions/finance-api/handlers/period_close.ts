// finance-api period_close handlers.
//   GET    /period-close
//   POST   /period-close/close    body { period_year, period_month }
//   POST   /period-close/reopen   body { period_year, period_month }

import { z } from 'zod';

import type { RouteCtx } from '../../_shared/route.ts';
import { ApiError, ok } from '../../_shared/responses.ts';
import {
  admin,
  parseBody,
  respondWithIdempotency,
} from '../../_shared/handler-helpers.ts';
import { requireCaller } from '../../_shared/tenant.ts';
import {
  PeriodCloseSchema,
  type PeriodClose,
} from '../../_shared/types/finance.ts';
import { requireFinanceCap, BUNDLE } from '../_helpers.ts';

const PC_COLS =
  'id, org_id, period_year, period_month, status, state_changed_at, ' +
  'closed_at, closed_by, reopened_at, reopened_by, notes, created_at, updated_at';

const PeriodInputSchema = z.object({
  period_year: z.number().int(),
  period_month: z.number().int().min(1).max(12),
});

function rowToPc(row: unknown): PeriodClose {
  return PeriodCloseSchema.parse(row);
}

export async function listPeriodClose({ req, url }: RouteCtx): Promise<Response> {
  const caller = requireCaller(req);
  requireFinanceCap(caller, 'period_close.read');
  const year = url.searchParams.get('year');
  let query = admin()
    .from('period_close')
    .select(PC_COLS)
    .eq('org_id', caller.orgId)
    .order('period_year', { ascending: false })
    .order('period_month', { ascending: false });
  if (year) query = query.eq('period_year', Number.parseInt(year, 10));
  const { data, error } = await query;
  if (error) {
    throw new ApiError('INTERNAL_ERROR', 500, 'period_close list failed', {
      detail: error.message,
    });
  }
  return ok((data ?? []).map(rowToPc));
}

export async function closePeriod(ctx: RouteCtx): Promise<Response> {
  const caller = requireCaller(ctx.req);
  requireFinanceCap(caller, 'period_close.close');
  const body = await parseBody(ctx.req, PeriodInputSchema);
  return respondWithIdempotency(
    ctx.req,
    caller,
    BUNDLE,
    `${ctx.req.method} /period-close/close`,
    body,
    async () => {
      const { data: pcId, error } = await admin().rpc('close_period', {
        p_org_id: caller.orgId,
        p_year: body.period_year,
        p_month: body.period_month,
      });
      if (error) {
        if (error.message?.startsWith('VALIDATION_ERROR')) {
          throw new ApiError('VALIDATION_ERROR', 422, error.message);
        }
        throw new ApiError('INTERNAL_ERROR', 500, 'close_period failed', {
          detail: error.message,
        });
      }
      const { data, error: fetchErr } = await admin()
        .from('period_close')
        .select(PC_COLS)
        .eq('id', pcId as string)
        .single();
      if (fetchErr) {
        throw new ApiError('INTERNAL_ERROR', 500, 'period_close fetch failed', {
          detail: fetchErr.message,
        });
      }
      return ok(rowToPc(data));
    },
  );
}

export async function reopenPeriod(ctx: RouteCtx): Promise<Response> {
  const caller = requireCaller(ctx.req);
  requireFinanceCap(caller, 'period_close.reopen');
  const body = await parseBody(ctx.req, PeriodInputSchema);
  return respondWithIdempotency(
    ctx.req,
    caller,
    BUNDLE,
    `${ctx.req.method} /period-close/reopen`,
    body,
    async () => {
      const { data: pcId, error } = await admin().rpc('reopen_period', {
        p_org_id: caller.orgId,
        p_year: body.period_year,
        p_month: body.period_month,
      });
      if (error) {
        if (error.message?.startsWith('NOT_FOUND')) {
          throw new ApiError('NOT_FOUND', 404, error.message);
        }
        throw new ApiError('INTERNAL_ERROR', 500, 'reopen_period failed', {
          detail: error.message,
        });
      }
      const { data, error: fetchErr } = await admin()
        .from('period_close')
        .select(PC_COLS)
        .eq('id', pcId as string)
        .single();
      if (fetchErr) {
        throw new ApiError('INTERNAL_ERROR', 500, 'period_close fetch failed', {
          detail: fetchErr.message,
        });
      }
      return ok(rowToPc(data));
    },
  );
}
