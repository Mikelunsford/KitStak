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
import { ApiError, ok, noContent, internalError } from '../../_shared/responses.ts';
import {
  admin,
  created,
  decodeCursor,
  paginate,
  parseBody,
  parseLimit,
  parseUuidParam,
  respondWithIdempotency,
} from '../../_shared/handler-helpers.ts';
import { requireCaller, type Caller } from '../../_shared/tenant.ts';
import { assertRefInOrg } from '../../_shared/crud.ts';
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
import { BUNDLE } from '../_helpers.ts';
import { requireCap } from '../../_shared/handler-helpers.ts';
import { nextDocNumber } from '../../_shared/numbering.ts';

const INVOICE_COLS =
  'id, org_id, invoice_number, customer_id, project_id, quote_id, status, ' +
  'state_changed_at, currency_code, issue_date, due_date, subtotal_cents, ' +
  'tax_total_cents, total_cents, paid_cents, credit_allocated_cents, ' +
  'balance_cents, notes, pdf_url, sent_at, sent_to, paid_at, cancelled_at, ' +
  'created_at, updated_at';

// BNEW-4 (v2 smoke 2026-05-22): invoice_number is optional. When absent or
// whitespace-only the handler allocates the next INV-YYYY-NNNNN via the
// numbering chassis (next_doc_number RPC). Operator-supplied values still
// win. Migration 0060 wired the same behaviour into convert_project_to_invoice;
// this standalone POST /invoices handler was missed at PR #105 close.
const InvoiceCreateSchema = z.object({
  invoice_number: z.string().min(1).optional(),
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
  return data as unknown as InvoiceRow;
}

export async function listInvoices({ req, url }: RouteCtx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'invoices.read');

  const limit = parseLimit(url);
  const cursor = decodeCursor(url.searchParams.get('cursor'));
  const status = url.searchParams.get('status');
  const customerId = url.searchParams.get('customer_id');
  // F-Wave7-LISTFILTER-01: project_id FK filter lifted from client-side
  // .filter(...) on detail pages. RLS Pattern A wraps the org gate so a
  // cross-tenant project_id still resolves to 200 + [].
  const projectId = url.searchParams.get('project_id');

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
  if (projectId) query = query.eq('project_id', projectId);
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
  const rows = (data ?? []) as unknown as InvoiceRow[];
  const { items, next_cursor } = paginate(rows, limit);
  return ok(items.map(rowToInvoice), next_cursor ? { next_cursor } : undefined);
}

export async function getInvoice({ req, params }: RouteCtx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'invoices.read');
  const id = parseUuidParam(params.id!);
  const row = await fetchInvoiceRow(caller, id);
  return ok(rowToInvoice(row));
}

export async function createInvoice(ctx: RouteCtx): Promise<Response> {
  const caller = requireCaller(ctx.req);
  requireCap(caller, 'invoices.write');
  const body = await parseBody(ctx.req, InvoiceCreateSchema);

  return respondWithIdempotency(
    ctx.req,
    caller,
    BUNDLE,
    `${ctx.req.method} /invoices`,
    body,
    async () => {
      if (body.customer_id) {
        await assertRefInOrg('customers', caller, body.customer_id);
      }
      if (body.project_id) {
        await assertRefInOrg('projects', caller, body.project_id);
      }
      if (body.quote_id) {
        await assertRefInOrg('quotes', caller, body.quote_id);
      }
      // BNEW-4 (v2 smoke 2026-05-22): operator may pass an invoice_number to
      // override; otherwise the org-scoped numbering chassis allocates the
      // next INV-YYYY-NNNNN string via next_doc_number. Empty / whitespace-
      // only strings are treated as absent so the SPA can drop the field
      // entirely. Mirrors the manufacturing-api + quotes-api / ops-api
      // pattern landed at PR #105 (B8) and the convert RPC in 0060.
      const supplied = body.invoice_number?.trim();
      const invoiceNumber = supplied
        ? supplied
        : await nextDocNumber(caller.orgId, 'invoice');
      const insert = {
        org_id: caller.orgId,
        invoice_number: invoiceNumber,
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
      return created(rowToInvoice(data as unknown as InvoiceRow));
    },
  );
}

export async function patchInvoice(ctx: RouteCtx): Promise<Response> {
  const caller = requireCaller(ctx.req);
  requireCap(caller, 'invoices.write');
  const id = parseUuidParam(ctx.params.id!);
  const body = await parseBody(ctx.req, InvoicePatchSchema);

  return respondWithIdempotency(
    ctx.req,
    caller,
    BUNDLE,
    `${ctx.req.method} /invoices/:id`,
    body,
    async () => {
      await fetchInvoiceRow(caller, id);
      if (body.customer_id) {
        await assertRefInOrg('customers', caller, body.customer_id);
      }
      if (body.project_id) {
        await assertRefInOrg('projects', caller, body.project_id);
      }
      if (body.quote_id) {
        await assertRefInOrg('quotes', caller, body.quote_id);
      }
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
      return ok(rowToInvoice(data as unknown as InvoiceRow));
    },
  );
}

export async function deleteInvoice(ctx: RouteCtx): Promise<Response> {
  const caller = requireCaller(ctx.req);
  requireCap(caller, 'invoices.delete');
  const id = parseUuidParam(ctx.params.id!);

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

  // R-W13-FIN-01: status-equals-from guard. The status was read above (the
  // SELECT in fetchInvoiceRow), then the UPDATE below applies a transition
  // off that read. Without `.eq('status', from)` two concurrent transitions
  // from the same status both win their UPDATE and the second silently
  // double-applies. Carrying the read status into the WHERE clause makes the
  // UPDATE a compare-and-set: a concurrent transition that already advanced
  // the row leaves 0 rows matched, which we surface as STATE_CONFLICT 409
  // (the same envelope the atomic-RPC transitions in three-pl / wms / finance
  // emit). maybeSingle() is required so a 0-row result is `data === null`
  // rather than the PGRST116 error that `.single()` would raise.
  const { data, error } = await admin()
    .from('invoices')
    .update(patch)
    .eq('id', id)
    .eq('org_id', caller.orgId)
    .eq('status', from)
    .select(INVOICE_COLS)
    .maybeSingle();
  if (error) {
    // Map period-closed trigger SQLSTATE P0001 to 422 per security canon.
    if (error.message && error.message.startsWith('period_closed:')) {
      throw new ApiError('VALIDATION_ERROR', 422, error.message);
    }
    throw new ApiError('INTERNAL_ERROR', 500, 'invoice transition failed', {
      detail: error.message,
    });
  }
  if (!data) {
    // The row exists in this org (fetchInvoiceRow already 404s on a missing /
    // cross-tenant id), so a 0-row UPDATE can only mean the status moved off
    // `from` between the read and the write. Treat as a lost compare-and-set.
    throw new ApiError(
      'STATE_CONFLICT',
      409,
      `invoice transition ${from} -> ${to} not allowed`,
    );
  }
  return rowToInvoice(data as unknown as InvoiceRow);
}

// SendInvoice resolves the customer's email (override > customer.primary_email),
// fails 422 if neither is available, transitions the invoice to 'sent', stamps
// invoice.sent_to with the resolved address, and queues an email notification.
// The notifications-worker drains it on the next cycle and the Resend sender
// posts the message. Mirrors the quote send pattern in quotes-api/index.ts.
const SendInvoiceBodySchema = z.object({
  recipient_email: z.string().email().optional(),
});

export async function sendInvoice(ctx: RouteCtx): Promise<Response> {
  const caller = requireCaller(ctx.req);
  requireCap(caller, 'invoices.send');
  const id = parseUuidParam(ctx.params.id!);
  const body = await parseBody(ctx.req, SendInvoiceBodySchema);
  return respondWithIdempotency(
    ctx.req,
    caller,
    BUNDLE,
    `${ctx.req.method} /invoices/:id/send`,
    body,
    async () => {
      const client = admin();

      // Resolve the invoice and its customer's email up-front so a missing
      // recipient surfaces as 422 before the state transition is attempted.
      const { data: invoiceRow, error: invErr } = await client
        .from('invoices')
        .select('id, invoice_number, customer_id, total_cents, currency_code, status')
        .eq('id', id)
        .eq('org_id', caller.orgId)
        .is('deleted_at', null)
        .maybeSingle();
      if (invErr) throw internalError('invoicing-api/invoices', invErr);
      if (!invoiceRow) throw new ApiError('NOT_FOUND', 404);

      let customerEmail: string | null = null;
      let customerName: string | null = null;
      if (invoiceRow.customer_id) {
        const { data: cust, error: custErr } = await client
          .from('customers')
          .select('primary_email, display_name')
          .eq('id', invoiceRow.customer_id)
          .eq('org_id', caller.orgId)
          .maybeSingle();
        if (custErr) throw internalError('invoicing-api/invoices', custErr);
        customerEmail = cust?.primary_email ?? null;
        customerName = cust?.display_name ?? null;
      }
      const recipient = body.recipient_email ?? customerEmail;
      if (!recipient) {
        throw new ApiError(
          'VALIDATION_ERROR',
          422,
          'No recipient email available. Provide recipient_email in the request body or add a primary_email to the customer record.',
        );
      }

      // Transition to 'sent' (the existing helper stamps sent_at + status).
      // Then stamp sent_to in a follow-up update; the helper is shared with
      // cancel/transition so we keep sent_to threading out of it.
      const updated = await transitionInvoiceTo(caller, id, 'sent');
      const { error: sentToErr } = await client
        .from('invoices')
        .update({ sent_to: recipient })
        .eq('id', id)
        .eq('org_id', caller.orgId);
      if (sentToErr) {
        console.error('invoicing-api: failed to stamp invoices.sent_to', {
          invoice_id: id,
          org_id: caller.orgId,
          message: sentToErr.message,
        });
      }

      // Queue the email notification.
      const greeting = customerName ? `Hi ${customerName},` : 'Hello,';
      const subject = `Invoice ${invoiceRow.invoice_number}`;
      const emailBody =
        `${greeting}\n\n` +
        `Invoice ${invoiceRow.invoice_number} is ready for review. ` +
        `Reply to this email with any questions about payment.\n\n` +
        `Thanks.`;
      const { error: notifErr } = await client.from('notifications').insert({
        org_id: caller.orgId,
        recipient_user_id: caller.userId,
        entity_type: 'invoice',
        entity_id: id,
        channel: 'email',
        subject,
        body: emailBody,
        payload: { to: recipient, invoice_number: invoiceRow.invoice_number },
      });
      if (notifErr) {
        console.error('invoicing-api: failed to queue email notification', {
          invoice_id: id,
          org_id: caller.orgId,
          message: notifErr.message,
        });
      }

      return ok(updated);
    },
  );
}

export async function cancelInvoice(ctx: RouteCtx): Promise<Response> {
  const caller = requireCaller(ctx.req);
  requireCap(caller, 'invoices.cancel');
  const id = parseUuidParam(ctx.params.id!);
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
  requireCap(caller, 'invoices.transition');
  const id = parseUuidParam(ctx.params.id!);
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
  requireCap(caller, 'invoices.read');
  // pdf-worker integration arrives in Wave 3+. Until then this endpoint
  // returns a 501-shaped error so the SPA can branch on the code.
  const _id = parseUuidParam(params.id!);
  throw new ApiError(
    'INTERNAL_ERROR',
    501,
    'invoice pdf generation not implemented',
  );
}
