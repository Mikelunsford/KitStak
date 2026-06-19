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
import { ApiError, ok, noContent } from '../../_shared/responses.ts';
import {
  admin,
  created,
  parseBody,
  parseLimit,
  parseUuidParam,
  respondWithIdempotency,
} from '../../_shared/handler-helpers.ts';
import {
  parseSearch, parseSort, decodeSortCursor, buildSearchOr, buildKeysetOr,
  paginateSorted, type SortSpec,
} from '../../_shared/list-query.ts';
import { requireCaller } from '../../_shared/tenant.ts';
import { assertRefInOrg } from '../../_shared/crud.ts';
import {
  PaymentSchema,
  PaymentAllocationSchema,
  type Payment,
  type PaymentAllocation,
} from '../../_shared/types/finance.ts';
import { BUNDLE } from '../_helpers.ts';
import { requireCap } from '../../_shared/handler-helpers.ts';
import { nextDocNumber } from '../../_shared/numbering.ts';

const PAYMENT_COLS =
  'id, org_id, payment_number, customer_id, amount_cents, currency_code, ' +
  'payment_method, reference_number, received_at, notes, unapplied_cents, ' +
  'created_at, updated_at';

const ALLOC_COLS = 'id, payment_id, invoice_id, amount_cents, created_at';

// B8 completion (v2 smoke 2026-05-22): payment_number is optional. When
// absent or whitespace-only the handler allocates the next PMT-YYYY-NNNNN
// via the numbering chassis (next_doc_number RPC). Operator-supplied values
// still win. Migration 0038 seeded the 'payment' doc_type with prefix
// PMT-. Payment is the last of the five chassis-eligible doc types still
// requiring manual entry; PR-B (#117) wired the same change for the
// standalone invoice POST.
const PaymentCreateSchema = z.object({
  payment_number: z.string().min(1).optional(),
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

// Workstream C (UI scan): the payment list toolbar searches the payment number,
// sorts an allowlist of NOT NULL columns, and pages by keyset on the active
// sort column. created_at desc is the legacy primary order and stays the default
// sort; received_at and amount_cents are added as NOT NULL sortable headers. The
// existing customer_id and invoice_id filters are preserved. All params are
// optional and additive.
const PAYMENT_SEARCH_COLS = ['payment_number'] as const;
const PAYMENT_SORT_COLS = ['created_at', 'received_at', 'amount_cents', 'payment_number'] as const;
const PAYMENT_DEFAULT_SORT: SortSpec = { column: 'created_at', dir: 'desc' };

export async function listPayments({ req, url }: RouteCtx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'payments.read');

  const limit = parseLimit(url);
  const sort = parseSort(url, PAYMENT_SORT_COLS, PAYMENT_DEFAULT_SORT);
  const search = parseSearch(url);
  const cursor = decodeSortCursor(url.searchParams.get('cursor'));
  const customerId = url.searchParams.get('customer_id');
  // BNEW-12: invoice_id filter resolves payments via payment_allocations.
  // The 2026-05-22 re-smoke surfaced that InvoiceDetailPage's PAYMENTS
  // section was rendering customer-scoped payments (any payment from
  // this customer) instead of invoice-scoped (only payments allocated
  // against this invoice). A brand-new DRAFT invoice for Smoke V2 Co.
  // with $0 balance and zero allocations was showing yesterday's
  // payments under "unapplied $0.00". The fix narrows the section to
  // payments that have at least one allocation against THIS invoice.
  // RLS Pattern B on payment_allocations gates the inner read by org;
  // a cross-tenant invoice_id reads the empty set and 200 + [].
  const invoiceId = url.searchParams.get('invoice_id');

  if (invoiceId) {
    const { data: allocRows, error: allocErr } = await admin()
      .from('payment_allocations')
      .select('payment_id')
      .eq('invoice_id', invoiceId);
    if (allocErr) {
      throw new ApiError('INTERNAL_ERROR', 500, 'payment list failed', {
        detail: allocErr.message,
      });
    }
    const paymentIds = Array.from(
      new Set(
        (allocRows ?? [])
          .map((r) => (r as { payment_id: string }).payment_id)
          .filter((id): id is string => Boolean(id)),
      ),
    );
    if (paymentIds.length === 0) {
      return ok([] as Payment[]);
    }
    let query = admin()
      .from('payments')
      .select(PAYMENT_COLS)
      .eq('org_id', caller.orgId)
      .is('deleted_at', null)
      .in('id', paymentIds);
    if (customerId) query = query.eq('customer_id', customerId);
    if (search) query = query.or(buildSearchOr(PAYMENT_SEARCH_COLS, search));
    query = query
      .order(sort.column, { ascending: sort.dir === 'asc' })
      .order('id', { ascending: sort.dir === 'asc' })
      .limit(limit + 1);
    if (cursor) query = query.or(buildKeysetOr(sort, cursor));
    const { data, error } = await query;
    if (error) {
      throw new ApiError('INTERNAL_ERROR', 500, 'payment list failed', {
        detail: error.message,
      });
    }
    const rows = (data ?? []) as unknown as Array<Record<string, unknown> & { id: string }>;
    const { items, next_cursor } = paginateSorted(rows, limit, sort.column);
    return ok(items.map(rowToPayment), next_cursor ? { next_cursor } : undefined);
  }

  let query = admin()
    .from('payments')
    .select(PAYMENT_COLS)
    .eq('org_id', caller.orgId)
    .is('deleted_at', null);

  if (customerId) query = query.eq('customer_id', customerId);
  if (search) query = query.or(buildSearchOr(PAYMENT_SEARCH_COLS, search));

  query = query
    .order(sort.column, { ascending: sort.dir === 'asc' })
    .order('id', { ascending: sort.dir === 'asc' })
    .limit(limit + 1);
  if (cursor) query = query.or(buildKeysetOr(sort, cursor));

  const { data, error } = await query;
  if (error) {
    throw new ApiError('INTERNAL_ERROR', 500, 'payment list failed', {
      detail: error.message,
    });
  }
  const rows = (data ?? []) as unknown as Array<Record<string, unknown> & { id: string }>;
  const { items, next_cursor } = paginateSorted(rows, limit, sort.column);
  return ok(items.map(rowToPayment), next_cursor ? { next_cursor } : undefined);
}

export async function getPayment({ req, params }: RouteCtx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'payments.read');
  const id = parseUuidParam(params.id!);
  return ok(rowToPayment(await fetchPayment(caller.orgId, id)));
}

export async function createPayment(ctx: RouteCtx): Promise<Response> {
  const caller = requireCaller(ctx.req);
  requireCap(caller, 'payments.write');
  const body = await parseBody(ctx.req, PaymentCreateSchema);

  return respondWithIdempotency(
    ctx.req,
    caller,
    BUNDLE,
    `${ctx.req.method} /payments`,
    body,
    async () => {
      if (body.customer_id) {
        await assertRefInOrg('customers', caller, body.customer_id);
      }
      // B8 completion (v2 smoke 2026-05-22): operator may pass a
      // payment_number to override; otherwise the org-scoped numbering
      // chassis allocates the next PMT-YYYY-NNNNN string via
      // next_doc_number. Empty / whitespace-only strings are treated as
      // absent so the SPA can drop the field entirely. Mirrors the
      // standalone invoice POST landed at PR-B (#117). Payment is the
      // last chassis-eligible doc type still requiring manual entry.
      const suppliedNumber = body.payment_number?.trim();
      const paymentNumber = suppliedNumber
        ? suppliedNumber
        : await nextDocNumber(caller.orgId, 'payment');
      const amount = typeof body.amount_cents === 'string'
        ? body.amount_cents
        : body.amount_cents;
      const insert = {
        org_id: caller.orgId,
        payment_number: paymentNumber,
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
  requireCap(caller, 'payments.write');
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
      if (body.customer_id) {
        await assertRefInOrg('customers', caller, body.customer_id);
      }
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
  requireCap(caller, 'payments.delete');
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
  requireCap(caller, 'payments.apply');
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
      for (const a of body.allocations) {
        await assertRefInOrg('invoices', caller, a.invoice_id);
      }
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
