// invoicing-api invoices handlers.
//   GET    /invoices
//   POST   /invoices
//   GET    /invoices/:id
//   PATCH  /invoices/:id
//   DELETE /invoices/:id   (soft delete via deleted_at)
//   POST   /invoices/:id/send
//   POST   /invoices/:id/cancel
//   POST   /invoices/:id/transition
//   GET    /invoices/:id/pdf  (501 stub when pdf-worker is wired downstream)

import { z } from 'zod';

import type { RouteCtx } from '../../_shared/route.ts';
import { ApiError, ok, created, noContent } from '../../_shared/responses.ts';
import {
  admin,
  decodeCursor,
  paginate,
  parseBody,
  parseLimit,
  respondWithIdempotency,
} from '../../_shared/handler-helpers.ts';
import { requireCaller, type Caller } from '../../_shared/tenant.ts';
import {
  InvoiceSchema,
  InvoiceStatusSchema,
  type Invoice,
} from '../../_shared/types/finance.ts';
import {
  invoiceStateMachine,
  canFinanceTransition,
  type InvoiceState,
} from '../../_shared/workflow/finance.ts';
import { requireFinanceCap, BUNDLE } from '../_helpers.ts';

const INVOICE_COLS =
  'id, org_id, invoice_number, customer_id, project_id, quote_id, status, ' +
  'state_changed_at, currency_code, issue_date, due_date, subtotal_cents, ' +
  'tax_total_cents, total_cents, paid_cents, credit_allocated_cents, ' +
  'balance_cents, notes, pdf_url, sent_at, sent_to, paid_at, cancelled_at, ' +
  'created_at, updated_at';

const InvoiceCreateSchema = z.object({
  invoice_number: z.string().min(1),
  customer_id: z.string().uuid().optional(),
  project_id: z.string().uuid().optional(),
  quote_id: z.string().uuid().optional(),
  currency_code: z.string().min(3).max(3).default('USD'),
  issue_date: z.string().optional(),
  due_date: z.string().optional(),
  notes: z.string().optional(),
});

const InvoicePatchSchema = InvoiceCreateSchema.partial();

const InvoiceTransitionSchema = z.object({
  to: InvoiceStatusSchema,
});

interface InvoiceRow {
  id: string;
  org_id: string;
  invoice_number: string;
  customer_id: string | null;
  project_id: string | null;
  quote_id: string | null;
  status: string;
  state_changed_at: string;
  currency_code: string;
  issue_date: string | null;
  due_date: string | null;
  subtotal_cents: number | string;
  tax_total_cents: number | string;
  total_cents: number | string;
  paid_cents: number | string;
  credit_allocated_cents: number | string;
  balance_cents: number | string;
  notes: string | null;
  pdf_url: string | null;
  sent_at: string | null;
  sent_to: string | null;
  paid_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
}

function rowToInvoice(row: InvoiceRow): Invoice {
  return InvoiceSchema.parse(row);
}

async function fetchInvoiceRow(caller: Caller, id: string): Promise<InvoiceRow> {
  const { data, error } = await admin()
    .from('invoices')
    .select(INVOICE_COLS)
    .eq('id', id)
    .eq('org_id', caller.orgId)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) {
    throw new ApiError('INTERNAL_ERROR', 500, 'invoice lookup failed', {
      detail: error.message,
    });
  }
  if (!data) throw new ApiError('NOT_FOUND', 404, 'invoice not found');
  return data as InvoiceRow;
}

export async function listInvoices({ req, url }: RouteCtx): Promise<Response> {
  const caller = requireCaller(req);
  requireFinanceCap(caller, 'invoices.read');

  const limit = parseLimit(url);
  const cursor = decodeCursor(url.searchParams.get('cursor'));
  const status = url.searchParams.get('status');
  const customerId = url.searchParams.get('customer_id');

  let query = admin()
    .from('invoices')
    .select(INVOICE_COLS)
    .eq('org_id', caller.orgId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1);

  if (status) query = query.eq('status', status);
  if (customerId) query = query.eq('customer_id', customerId);
  if (cursor) {
    query = query.or(
      `created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`,
    );
  }
  const { data, error } = await query;
  if (error) {
    throw new ApiError('INTERNAL_ERROR', 500, 'invoice list failed', {
      detail: error.message,
    });
  }
  const rows = (data ?? []) as InvoiceRow[];
  const { items, next_cursor } = paginate(rows, limit);
  return ok(items.map(rowToInvoice), next_cursor ? { next_cursor } : undefined);
}

export async function getInvoice({ req, params }: RouteCtx): Promise<Response> {
  const caller = requireCaller(req);
  requireFinanceCap(caller, 'invoices.read');
  const id = params.id!;
  const row = await fetchInvoiceRow(caller, id);
  return ok(rowToInvoice(row));
}

export async function createInvoice(ctx: RouteCtx): Promise<Response> {
  const caller = requireCaller(ctx.req);
  requireFinanceCap(caller, 'invoices.write');
  const body = await parseBody(ctx.req, InvoiceCreateSchema);

  return respondWithIdempotency(
    ctx.req,
    caller,
    BUNDLE,
    `${ctx.req.method} /invoices`,
    body,
    async () => {
      const insert = {
        org_id: caller.orgId,
        invoice_number: body.invoice_number,
        customer_id: body.customer_id ?? null,
        project_id: body.project_id ?? null,
        quote_id: body.quote_id ?? null,
        currency_code: body.currency_code,
        issue_date: body.issue_date ?? null,
        due_date: body.due_date ?? null,
        notes: body.notes ?? null,
        status: 'draft',
        created_by: caller.userId,
        updated_by: caller.userId,
      };
      const { data, error } = await admin()
        .from('invoices')
        .insert(insert)
        .select(INVOICE_COLS)
        .single();
      if (error) {
        throw new ApiError('INTERNAL_ERROR', 500, 'invoice insert failed', {
          detail: error.message,
        });
      }
      return created(rowToInvoice(data as InvoiceRow));
    },
  );
}

export async function patchInvoice(ctx: RouteCtx): Promise<Response> {
  const caller = requireCaller(ctx.req);
  requireFinanceCap(caller, 'invoices.write');
  const id = ctx.params.id!;
  const body = await parseBody(ctx.req, InvoicePatchSchema);

  return respondWithIdempotency(
    ctx.req,
    caller,
    BUNDLE,
    `${ctx.req.method} /invoices/:id`,
    body,
    async () => {
      await fetchInvoiceRow(caller, id);
      const patch: Record<string, unknown> = { updated_by: caller.userId };
      for (const [k, v] of Object.entries(body)) {
        if (v !== undefined) patch[k] = v;
      }
      const { data, error } = await admin()
        .from('invoices')
        .update(patch)
        .eq('id', id)
        .eq('org_id', caller.orgId)
        .select(INVOICE_COLS)
        .single();
      if (error) {
        throw new ApiError('INTERNAL_ERROR', 500, 'invoice update failed', {
          detail: error.message,
        });
      }
      return ok(rowToInvoice(data as InvoiceRow));
    },
  );
}

export async function deleteInvoice(ctx: RouteCtx): Promise<Response> {
  const caller = requireCaller(ctx.req);
  requireFinanceCap(caller, 'invoices.delete');
  const id = ctx.params.id!;

  return respondWithIdempotency(
    ctx.req,
    caller,
    BUNDLE,
    `${ctx.req.method} /invoices/:id`,
    null,
    async () => {
      await fetchInvoiceRow(caller, id);
      const { error } = await admin()
        .from('invoices')
        .update({ deleted_at: new Date().toISOString(), updated_by: caller.userId })
        .eq('id', id)
        .eq('org_id', caller.orgId);
      if (error) {
        throw new ApiError('INTERNAL_ERROR', 500, 'invoice delete failed', {
          detail: error.message,
        });
      }
      return noContent();
    },
  );
}

async function transitionInvoiceTo(
  caller: Caller,
  id: string,
  to: InvoiceState,
): Promise<Invoice> {
  const row = await fetchInvoiceRow(caller, id);
  const from = row.status as InvoiceState;
  if (!canFinanceTransition(invoiceStateMachine, from, to)) {
    throw new ApiError(
      'STATE_CONFLICT',
      409,
      `invoice transition ${from} -> ${to} not allowed`,
    );
  }
  const patch: Record<string, unknown> = {
    status: to,
    updated_by: caller.userId,
  };
  if (to === 'sent') patch.sent_at = new Date().toISOString();
  if (to === 'paid') patch.paid_at = new Date().toISOString();
  if (to === 'cancelled') patch.cancelled_at = new Date().toISOString();

  const { data, error } = await admin()
    .from('invoices')
    .update(patch)
    .eq('id', id)
    .eq('org_id', caller.orgId)
    .select(INVOICE_COLS)
    .single();
  if (error) {
    // Map period-closed trigger SQLSTATE P0001 to 422 per security canon.
    if (error.message && error.message.startsWith('period_closed:')) {
      throw new ApiError('VALIDATION_ERROR', 422, error.message);
    }
    throw new ApiError('INTERNAL_ERROR', 500, 'invoice transition failed', {
      detail: error.message,
    });
  }
  return rowToInvoice(data as InvoiceRow);
}

export async function sendInvoice(ctx: RouteCtx): Promise<Response> {
  const caller = requireCaller(ctx.req);
  requireFinanceCap(caller, 'invoices.send');
  const id = ctx.params.id!;
  return respondWithIdempotency(
    ctx.req,
    caller,
    BUNDLE,
    `${ctx.req.method} /invoices/:id/send`,
    null,
    async () => ok(await transitionInvoiceTo(caller, id, 'sent')),
  );
}

export async function cancelInvoice(ctx: RouteCtx): Promise<Response> {
  const caller = requireCaller(ctx.req);
  requireFinanceCap(caller, 'invoices.cancel');
  const id = ctx.params.id!;
  return respondWithIdempotency(
    ctx.req,
    caller,
    BUNDLE,
    `${ctx.req.method} /invoices/:id/cancel`,
    null,
    async () => ok(await transitionInvoiceTo(caller, id, 'cancelled')),
  );
}

export async function transitionInvoice(ctx: RouteCtx): Promise<Response> {
  const caller = requireCaller(ctx.req);
  requireFinanceCap(caller, 'invoices.transition');
  const id = ctx.params.id!;
  const body = await parseBody(ctx.req, InvoiceTransitionSchema);
  return respondWithIdempotency(
    ctx.req,
    caller,
    BUNDLE,
    `${ctx.req.method} /invoices/:id/transition`,
    body,
    async () => ok(await transitionInvoiceTo(caller, id, body.to as InvoiceState)),
  );
}

export async function getInvoicePdf({ req, params }: RouteCtx): Promise<Response> {
  const caller = requireCaller(req);
  requireFinanceCap(caller, 'invoices.read');
  // pdf-worker integration arrives in Wave 3+. Until then this endpoint
  // returns a 501-shaped error so the SPA can branch on the code.
  const _id = params.id!;
  throw new ApiError(
    'INTERNAL_ERROR',
    501,
    'invoice pdf generation not implemented',
  );
}
