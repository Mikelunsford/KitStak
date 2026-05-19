// invoicing-api payments handlers.
//   GET    /payments
//   POST   /payments
//   GET    /payments/:id
//   PATCH  /payments/:id
//   DELETE /payments/:id
//   POST   /payments/:id/apply
//
// Pattern A on payments. Allocations are written via the apply endpoint,
// which inserts allocation rows; recompute triggers on payment_allocations
// keep payments.unapplied_cents and invoices.paid_cents in sync.

import { z } from 'zod';

import type { RouteCtx } from '../../_shared/route.ts';
import { ApiError, ok, created, noContent } from '../../_shared/responses.ts';
import {
  admin,
  decodeCursor,
  paginate,
  parseBody,
  parseLimit,
  parseUuidParam,
  respondWithIdempotency,
} from '../../_shared/handler-helpers.ts';
import { requireCaller } from '../../_shared/tenant.ts';
import {
  PaymentSchema,
  PaymentAllocationSchema,
  type Payment,
  type PaymentAllocation,
} from '../../_shared/types/finance.ts';
import { requireFinanceCap, BUNDLE } from '../_helpers.ts';

const PAYMENT_COLS =
  'id, org_id, payment_number, customer_id, amount_cents, currency_code, ' +
  'payment_method, reference_number, received_at, notes, unapplied_cents, ' +
  'created_at, updated_at';

const ALLOC_COLS = 'id, payment_id, invoice_id, amount_cents, created_at';

const PaymentCreateSchema = z.object({
  payment_number: z.string().min(1),
  customer_id: z.string().uuid().optional(),
  amount_cents: z.union([z.number().int(), z.string().regex(/^-?\d+$/)]),
  currency_code: z.string().min(3).max(3).default('USD'),
  payment_method: z.string().optional(),
  reference_number: z.string().optional(),
  received_at: z.string().optional(),
  notes: z.string().optional(),
});

const PaymentPatchSchema = PaymentCreateSchema.partial();

const PaymentApplySchema = z.object({
  allocations: z
    .array(
      z.object({
        invoice_id: z.string().uuid(),
        amount_cents: z.union([z.number().int(), z.string().regex(/^-?\d+$/)]),
      }),
    )
    .min(1),
});

function rowToPayment(row: unknown): Payment {
  return PaymentSchema.parse(row);
}

function rowToAlloc(row: unknown): PaymentAllocation {
  return PaymentAllocationSchema.parse(row);
}

async function fetchPayment(orgId: string, id: string) {
  const { data, error } = await admin()
    .from('payments')
    .select(PAYMENT_COLS)
    .eq('id', id)
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) {
    throw new ApiError('INTERNAL_ERROR', 500, 'payment lookup failed', {
      detail: error.message,
    });
  }
  if (!data) throw new ApiError('NOT_FOUND', 404, 'payment not found');
  return data;
}

export async function listPayments({ req, url }: RouteCtx): Promise<Response> {
  const caller = requireCaller(req);
  requireFinanceCap(caller, 'payments.read');

  const limit = parseLimit(url);
  const cursor = decodeCursor(url.searchParams.get('cursor'));
  const customerId = url.searchParams.get('customer_id');

  let query = admin()
    .from('payments')
    .select(PAYMENT_COLS)
    .eq('org_id', caller.orgId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1);

  if (customerId) query = query.eq('customer_id', customerId);
  if (cursor) {
    query = query.or(
      `created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`,
    );
  }
  const { data, error } = await query;
  if (error) {
    throw new ApiError('INTERNAL_ERROR', 500, 'payment list failed', {
      detail: error.message,
    });
  }
  const rows = (data ?? []) as Array<{ id: string; created_at: string }>;
  const { items, next_cursor } = paginate(rows, limit);
  return ok(items.map(rowToPayment), next_cursor ? { next_cursor } : undefined);
}

export async function getPayment({ req, params }: RouteCtx): Promise<Response> {
  const caller = requireCaller(req);
  requireFinanceCap(caller, 'payments.read');
  const id = parseUuidParam(params.id!);
  return ok(rowToPayment(await fetchPayment(caller.orgId, id)));
}

export async function createPayment(ctx: RouteCtx): Promise<Response> {
  const caller = requireCaller(ctx.req);
  requireFinanceCap(caller, 'payments.write');
  const body = await parseBody(ctx.req, PaymentCreateSchema);

  return respondWithIdempotency(
    ctx.req,
    caller,
    BUNDLE,
    `${ctx.req.method} /payments`,
    body,
    async () => {
      const amount = typeof body.amount_cents === 'string'
        ? body.amount_cents
        : body.amount_cents;
      const insert = {
        org_id: caller.orgId,
        payment_number: body.payment_number,
        customer_id: body.customer_id ?? null,
        amount_cents: amount,
        currency_code: body.currency_code,
        payment_method: body.payment_method ?? null,
        reference_number: body.reference_number ?? null,
        received_at: body.received_at ?? new Date().toISOString(),
        notes: body.notes ?? null,
        unapplied_cents: amount,
        created_by: caller.userId,
        updated_by: caller.userId,
      };
      const { data, error } = await admin()
        .from('payments')
        .insert(insert)
        .select(PAYMENT_COLS)
        .single();
      if (error) {
        throw new ApiError('INTERNAL_ERROR', 500, 'payment insert failed', {
          detail: error.message,
        });
      }
      return created(rowToPayment(data));
    },
  );
}

export async function patchPayment(ctx: RouteCtx): Promise<Response> {
  const caller = requireCaller(ctx.req);
  requireFinanceCap(caller, 'payments.write');
  const id = parseUuidParam(ctx.params.id!);
  const body = await parseBody(ctx.req, PaymentPatchSchema);

  return respondWithIdempotency(
    ctx.req,
    caller,
    BUNDLE,
    `${ctx.req.method} /payments/:id`,
    body,
    async () => {
      await fetchPayment(caller.orgId, id);
      const patch: Record<string, unknown> = { updated_by: caller.userId };
      for (const [k, v] of Object.entries(body)) {
        if (v !== undefined) patch[k] = v;
      }
      const { data, error } = await admin()
        .from('payments')
        .update(patch)
        .eq('id', id)
        .eq('org_id', caller.orgId)
        .select(PAYMENT_COLS)
        .single();
      if (error) {
        throw new ApiError('INTERNAL_ERROR', 500, 'payment update failed', {
          detail: error.message,
        });
      }
      return ok(rowToPayment(data));
    },
  );
}

export async function deletePayment(ctx: RouteCtx): Promise<Response> {
  const caller = requireCaller(ctx.req);
  requireFinanceCap(caller, 'payments.delete');
  const id = parseUuidParam(ctx.params.id!);
  return respondWithIdempotency(
    ctx.req,
    caller,
    BUNDLE,
    `${ctx.req.method} /payments/:id`,
    null,
    async () => {
      await fetchPayment(caller.orgId, id);
      const { error } = await admin()
        .from('payments')
        .update({ deleted_at: new Date().toISOString(), updated_by: caller.userId })
        .eq('id', id)
        .eq('org_id', caller.orgId);
      if (error) {
        throw new ApiError('INTERNAL_ERROR', 500, 'payment delete failed', {
          detail: error.message,
        });
      }
      return noContent();
    },
  );
}

export async function applyPayment(ctx: RouteCtx): Promise<Response> {
  const caller = requireCaller(ctx.req);
  requireFinanceCap(caller, 'payments.apply');
  const id = parseUuidParam(ctx.params.id!);
  const body = await parseBody(ctx.req, PaymentApplySchema);

  return respondWithIdempotency(
    ctx.req,
    caller,
    BUNDLE,
    `${ctx.req.method} /payments/:id/apply`,
    body,
    async () => {
      await fetchPayment(caller.orgId, id);
      const rows = body.allocations.map((a) => ({
        payment_id: id,
        invoice_id: a.invoice_id,
        amount_cents: a.amount_cents,
        created_by: caller.userId,
      }));
      const { data, error } = await admin()
        .from('payment_allocations')
        .insert(rows)
        .select(ALLOC_COLS);
      if (error) {
        throw new ApiError('INTERNAL_ERROR', 500, 'payment apply failed', {
          detail: error.message,
        });
      }
      return ok((data ?? []).map(rowToAlloc));
    },
  );
}
