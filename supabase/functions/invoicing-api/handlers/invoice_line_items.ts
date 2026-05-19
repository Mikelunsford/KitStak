// invoicing-api invoice line items handlers.
//   GET    /invoices/:id/line-items
//   POST   /invoices/:id/line-items
//   PATCH  /invoice-line-items/:line_id
//   DELETE /invoice-line-items/:line_id
//
// Pattern B RLS through parent invoice. Each mutation triggers a
// recompute_invoice_totals RPC call so the header totals stay in sync.

import { z } from 'zod';

import type { RouteCtx } from '../../_shared/route.ts';
import { ApiError, ok, created, noContent } from '../../_shared/responses.ts';
import {
  admin,
  parseBody,
  respondWithIdempotency,
} from '../../_shared/handler-helpers.ts';
import { requireCaller } from '../../_shared/tenant.ts';
import {
  InvoiceLineItemSchema,
  type InvoiceLineItem,
} from '../../_shared/types/finance.ts';
import { requireFinanceCap, BUNDLE } from '../_helpers.ts';

const LINE_COLS =
  'id, invoice_id, item_id, description, quantity, unit_price_cents, ' +
  'tax_rate_snapshot, tax_amount_cents, discount_cents, line_total_cents, ' +
  'sort_order';

const LineCreateSchema = z.object({
  description: z.string().min(1),
  quantity: z.union([z.number(), z.string()]).default(1),
  unit_price_cents: z.union([z.number().int(), z.string().regex(/^-?\d+$/)]),
  tax_rate_snapshot: z.union([z.number(), z.string()]).default(0),
  tax_amount_cents: z.union([z.number().int(), z.string().regex(/^-?\d+$/)]).default(0),
  discount_cents: z.union([z.number().int(), z.string().regex(/^-?\d+$/)]).default(0),
  line_total_cents: z.union([z.number().int(), z.string().regex(/^-?\d+$/)]),
  item_id: z.string().uuid().optional(),
  sort_order: z.number().int().default(0),
});

const LinePatchSchema = LineCreateSchema.partial();

function rowToLine(row: unknown): InvoiceLineItem {
  return InvoiceLineItemSchema.parse(row);
}

async function ensureInvoiceForCaller(orgId: string, invoiceId: string) {
  const { data, error } = await admin()
    .from('invoices')
    .select('id')
    .eq('id', invoiceId)
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) {
    throw new ApiError('INTERNAL_ERROR', 500, 'parent invoice lookup failed', {
      detail: error.message,
    });
  }
  if (!data) throw new ApiError('NOT_FOUND', 404, 'invoice not found');
}

async function ensureInvoiceForLine(orgId: string, lineId: string): Promise<string> {
  const { data, error } = await admin()
    .from('invoice_line_items')
    .select('invoice_id')
    .eq('id', lineId)
    .maybeSingle();
  if (error) {
    throw new ApiError('INTERNAL_ERROR', 500, 'line lookup failed', {
      detail: error.message,
    });
  }
  if (!data) throw new ApiError('NOT_FOUND', 404, 'line not found');
  await ensureInvoiceForCaller(orgId, (data as { invoice_id: string }).invoice_id);
  return (data as { invoice_id: string }).invoice_id;
}

export async function listLineItems(ctx: RouteCtx): Promise<Response> {
  const caller = requireCaller(ctx.req);
  requireFinanceCap(caller, 'invoices.read');
  const invoiceId = ctx.params.id!;
  await ensureInvoiceForCaller(caller.orgId, invoiceId);

  const { data, error } = await admin()
    .from('invoice_line_items')
    .select(LINE_COLS)
    .eq('invoice_id', invoiceId)
    .order('sort_order', { ascending: true });
  if (error) {
    throw new ApiError('INTERNAL_ERROR', 500, 'line list failed', {
      detail: error.message,
    });
  }
  return ok((data ?? []).map(rowToLine));
}

export async function createLineItem(ctx: RouteCtx): Promise<Response> {
  const caller = requireCaller(ctx.req);
  requireFinanceCap(caller, 'invoices.write');
  const invoiceId = ctx.params.id!;
  const body = await parseBody(ctx.req, LineCreateSchema);

  return respondWithIdempotency(
    ctx.req,
    caller,
    BUNDLE,
    `${ctx.req.method} /invoices/:id/line-items`,
    body,
    async () => {
      await ensureInvoiceForCaller(caller.orgId, invoiceId);
      const insert = {
        invoice_id: invoiceId,
        item_id: body.item_id ?? null,
        description: body.description,
        quantity: body.quantity,
        unit_price_cents: body.unit_price_cents,
        tax_rate_snapshot: body.tax_rate_snapshot,
        tax_amount_cents: body.tax_amount_cents,
        discount_cents: body.discount_cents,
        line_total_cents: body.line_total_cents,
        sort_order: body.sort_order,
        created_by: caller.userId,
        updated_by: caller.userId,
      };
      const { data, error } = await admin()
        .from('invoice_line_items')
        .insert(insert)
        .select(LINE_COLS)
        .single();
      if (error) {
        throw new ApiError('INTERNAL_ERROR', 500, 'line insert failed', {
          detail: error.message,
        });
      }
      await admin().rpc('recompute_invoice_totals', { p_invoice_id: invoiceId });
      return created(rowToLine(data));
    },
  );
}

export async function patchLineItem(ctx: RouteCtx): Promise<Response> {
  const caller = requireCaller(ctx.req);
  requireFinanceCap(caller, 'invoices.write');
  const lineId = ctx.params.line_id!;
  const body = await parseBody(ctx.req, LinePatchSchema);

  return respondWithIdempotency(
    ctx.req,
    caller,
    BUNDLE,
    `${ctx.req.method} /invoice-line-items/:line_id`,
    body,
    async () => {
      const invoiceId = await ensureInvoiceForLine(caller.orgId, lineId);
      const patch: Record<string, unknown> = { updated_by: caller.userId };
      for (const [k, v] of Object.entries(body)) {
        if (v !== undefined) patch[k] = v;
      }
      const { data, error } = await admin()
        .from('invoice_line_items')
        .update(patch)
        .eq('id', lineId)
        .select(LINE_COLS)
        .single();
      if (error) {
        throw new ApiError('INTERNAL_ERROR', 500, 'line update failed', {
          detail: error.message,
        });
      }
      await admin().rpc('recompute_invoice_totals', { p_invoice_id: invoiceId });
      return ok(rowToLine(data));
    },
  );
}

export async function deleteLineItem(ctx: RouteCtx): Promise<Response> {
  const caller = requireCaller(ctx.req);
  requireFinanceCap(caller, 'invoices.write');
  const lineId = ctx.params.line_id!;
  return respondWithIdempotency(
    ctx.req,
    caller,
    BUNDLE,
    `${ctx.req.method} /invoice-line-items/:line_id`,
    null,
    async () => {
      const invoiceId = await ensureInvoiceForLine(caller.orgId, lineId);
      const { error } = await admin()
        .from('invoice_line_items')
        .delete()
        .eq('id', lineId);
      if (error) {
        throw new ApiError('INTERNAL_ERROR', 500, 'line delete failed', {
          detail: error.message,
        });
      }
      await admin().rpc('recompute_invoice_totals', { p_invoice_id: invoiceId });
      return noContent();
    },
  );
}
