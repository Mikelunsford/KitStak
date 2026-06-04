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
import { ApiError, ok, noContent } from '../../_shared/responses.ts';
import {
  admin,
  created,
  parseBody,
  parseUuidParam,
  respondWithIdempotency,
} from '../../_shared/handler-helpers.ts';
import { requireCaller } from '../../_shared/tenant.ts';
import { assertRefInOrg } from '../../_shared/crud.ts';
import {
  InvoiceLineItemSchema,
  type InvoiceLineItem,
} from '../../_shared/types/finance.ts';
import { BUNDLE } from '../_helpers.ts';
import { requireCap } from '../../_shared/handler-helpers.ts';
import { roundHalfEven } from '../../_shared/money.ts';

const LINE_COLS =
  'id, invoice_id, item_id, description, quantity, unit_price_cents, ' +
  'tax_rate_snapshot, tax_amount_cents, discount_cents, line_total_cents, ' +
  'sort_order';

// A1 (WS-A MONEY INTEGRITY): line totals are SERVER-AUTHORITATIVE. The
// client may send tax_amount_cents / line_total_cents in the body, but we
// IGNORE those fields and persist server-recomputed values so a forged
// total can never reach the invoice header sum (recompute_invoice_totals in
// migration 0018 sums line_total_cents and tax_amount_cents directly).
//
// Invoice line formula (mirrors quotes-api computeLineMath shape; the only
// divergence is tax_rate_snapshot grain — invoice tax_rate_snapshot is a
// DECIMAL FRACTION numeric(7,4), e.g. 0.0825 = 8.25%, not integer bps as on
// quotes). gross/net/tax are integer cents:
//
//   gross           = roundHalfEven(quantity * unit_price_cents)
//   net             = gross - discount_cents        (flat per-line cents)
//   tax_amount_cents= roundHalfEven(net * tax_rate_snapshot)
//   line_total_cents= net + tax_amount_cents
//
// A6 (doc): currency is snapshotted at the document-header grain by design.
// Kitstak is single-currency-per-document, so invoice lines do not carry a
// per-line currency_code; the header invoices.currency_code is the snapshot.
// Same convention holds on quote lines and purchase-order lines.
//
// Every cents product is computed in pure BigInt. The fractional inputs
// (quantity numeric(18,4), tax_rate_snapshot numeric(7,4)) are scaled to
// integers before the multiply, so the monetary product never passes through
// float space; unscaleHalfEven then applies banker's rounding back to integer
// cents at each boundary. unit_price_cents and discount_cents are already
// integer cents. Float touches only the scaling of the non-monetary factors
// (quantity, rate), and roundHalfEven cleans the representation dust there.
interface InvoiceLineInputs {
  quantity: number | string;
  unit_price_cents: number | string;
  tax_rate_snapshot: number | string;
  discount_cents: number | string;
}

interface InvoiceLineMath {
  tax_amount_cents: string;
  line_total_cents: string;
}

// 4 decimal places captures both numeric(18,4) quantity and numeric(7,4) rate.
const LINE_MATH_SCALE = 10_000n;

// Banker's rounding (half to even) of a LINE_MATH_SCALE-scaled BigInt back to
// integer cents, sign aware.
function unscaleHalfEven(scaled: bigint): bigint {
  const sign = scaled < 0n ? -1n : 1n;
  const abs = scaled < 0n ? -scaled : scaled;
  let whole = abs / LINE_MATH_SCALE;
  const rem = abs % LINE_MATH_SCALE;
  const half = LINE_MATH_SCALE / 2n;
  if (rem > half || (rem === half && whole % 2n === 1n)) whole += 1n;
  return sign * whole;
}

export function invoiceLineMath(inputs: InvoiceLineInputs): InvoiceLineMath {
  const qtyScaled = BigInt(
    roundHalfEven(Number(inputs.quantity) * Number(LINE_MATH_SCALE)),
  );
  const rateScaled = BigInt(
    roundHalfEven(Number(inputs.tax_rate_snapshot) * Number(LINE_MATH_SCALE)),
  );
  const unit = BigInt(String(inputs.unit_price_cents));
  const discount = BigInt(String(inputs.discount_cents));

  // qtyScaled is quantity * SCALE, so qtyScaled * unit is gross cents * SCALE.
  const gross = unscaleHalfEven(qtyScaled * unit);
  const net = gross - discount;
  // rateScaled is rate * SCALE, so net * rateScaled is tax cents * SCALE.
  const taxAmount = unscaleHalfEven(net * rateScaled);
  const lineTotal = net + taxAmount;

  return {
    tax_amount_cents: taxAmount.toString(),
    line_total_cents: lineTotal.toString(),
  };
}

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
  requireCap(caller, 'invoices.read');
  const invoiceId = parseUuidParam(ctx.params.id!);
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
  requireCap(caller, 'invoices.write');
  const invoiceId = parseUuidParam(ctx.params.id!);
  const body = await parseBody(ctx.req, LineCreateSchema);

  return respondWithIdempotency(
    ctx.req,
    caller,
    BUNDLE,
    `${ctx.req.method} /invoices/:id/line-items`,
    body,
    async () => {
      await ensureInvoiceForCaller(caller.orgId, invoiceId);
      if (body.item_id) {
        await assertRefInOrg('items', caller, body.item_id);
      }
      // A1: ignore client-supplied tax_amount_cents / line_total_cents and
      // persist the server-recomputed values from the trusted inputs.
      const computed = invoiceLineMath({
        quantity: body.quantity,
        unit_price_cents: body.unit_price_cents,
        tax_rate_snapshot: body.tax_rate_snapshot,
        discount_cents: body.discount_cents,
      });
      const insert = {
        invoice_id: invoiceId,
        item_id: body.item_id ?? null,
        description: body.description,
        quantity: body.quantity,
        unit_price_cents: body.unit_price_cents,
        tax_rate_snapshot: body.tax_rate_snapshot,
        tax_amount_cents: computed.tax_amount_cents,
        discount_cents: body.discount_cents,
        line_total_cents: computed.line_total_cents,
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
  requireCap(caller, 'invoices.write');
  const lineId = parseUuidParam(ctx.params.line_id!, 'line_id');
  const body = await parseBody(ctx.req, LinePatchSchema);

  return respondWithIdempotency(
    ctx.req,
    caller,
    BUNDLE,
    `${ctx.req.method} /invoice-line-items/:line_id`,
    body,
    async () => {
      const invoiceId = await ensureInvoiceForLine(caller.orgId, lineId);
      if (body.item_id) {
        await assertRefInOrg('items', caller, body.item_id);
      }

      // A1: PATCH is partial, so load the current row, overlay the supplied
      // input fields, then server-recompute. Any client-supplied
      // tax_amount_cents / line_total_cents in the body is dropped below.
      const { data: existing, error: loadError } = await admin()
        .from('invoice_line_items')
        .select(LINE_COLS)
        .eq('id', lineId)
        .single();
      if (loadError) {
        throw new ApiError('INTERNAL_ERROR', 500, 'line load failed', {
          detail: loadError.message,
        });
      }
      const current = existing as Record<string, unknown>;

      const patch: Record<string, unknown> = { updated_by: caller.userId };
      // Persist only the trusted input fields the caller actually sent.
      for (const k of [
        'description',
        'quantity',
        'unit_price_cents',
        'tax_rate_snapshot',
        'discount_cents',
        'item_id',
        'sort_order',
      ] as const) {
        if (body[k] !== undefined) patch[k] = body[k];
      }

      const computed = invoiceLineMath({
        quantity: (patch.quantity ?? current.quantity) as number | string,
        unit_price_cents: (patch.unit_price_cents ??
          current.unit_price_cents) as number | string,
        tax_rate_snapshot: (patch.tax_rate_snapshot ??
          current.tax_rate_snapshot) as number | string,
        discount_cents: (patch.discount_cents ??
          current.discount_cents) as number | string,
      });
      patch.tax_amount_cents = computed.tax_amount_cents;
      patch.line_total_cents = computed.line_total_cents;

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
  requireCap(caller, 'invoices.write');
  const lineId = parseUuidParam(ctx.params.line_id!, 'line_id');
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
