// quotes-api: CRUD for quotes + quote_line_items, state transitions, version
// snapshots, conversion to project, and the (stub) PDF endpoint.
//
// Routing: flat `Route[]` dispatched via `_shared/route.ts`. Every non-GET
// goes through `respondWithIdempotency` + `requireCap` + the workflow check.

import { z } from 'https://esm.sh/zod@3.23.8';

import { route, type Route, type RouteCtx } from '../_shared/route.ts';
import {
  admin, parseBody, parseLimit, paginate, respondWithIdempotency, created,
} from '../_shared/handler-helpers.ts';
import { requireSalesCap as requireCap } from './_helpers.ts';
import { ok, ApiError } from '../_shared/responses.ts';
import { requireCaller } from '../_shared/tenant.ts';
import {
  CreateQuoteRequestSchema, UpdateQuoteRequestSchema,
  CreateQuoteLineRequestSchema, ConvertQuoteToProjectRequestSchema,
  QuoteStateSchema,
} from '../_shared/types/sales.ts';
import { QUOTE_FSM, canTransition, type QuoteState } from '../_shared/workflow/sales.ts';

const BUNDLE = 'quotes-api';

// --- list / get ---

const listQuotes = async (ctx: RouteCtx) => {
  const caller = requireCaller(ctx.req);
  requireCap(caller, 'quotes.quote.read');
  const limit = parseLimit(ctx.url);
  const state = ctx.url.searchParams.get('state');
  const client = admin();
  let q = client
    .from('quotes').select('*')
    .eq('org_id', caller.orgId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(limit + 1);
  if (state) q = q.eq('state', state);
  const { data, error } = await q;
  if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
  const rows = data ?? [];
  return ok(paginate(rows as Array<{ id: string; created_at: string }>, limit));
};

const getQuote = async (ctx: RouteCtx) => {
  const caller = requireCaller(ctx.req);
  requireCap(caller, 'quotes.quote.read');
  const client = admin();
  const { data: quote, error: qErr } = await client
    .from('quotes').select('*')
    .eq('id', ctx.params.id).eq('org_id', caller.orgId)
    .maybeSingle();
  if (qErr) throw new ApiError('INTERNAL_ERROR', 500, qErr.message);
  if (!quote) throw new ApiError('NOT_FOUND', 404);
  const { data: lines, error: lErr } = await client
    .from('quote_line_items').select('*')
    .eq('quote_id', ctx.params.id)
    .order('position', { ascending: true });
  if (lErr) throw new ApiError('INTERNAL_ERROR', 500, lErr.message);
  return ok({ quote, line_items: lines ?? [] });
};

// --- create / update / delete ---

const createQuote = async (ctx: RouteCtx) => {
  const caller = requireCaller(ctx.req);
  requireCap(caller, 'quotes.quote.write');
  const body = await parseBody(ctx.req, CreateQuoteRequestSchema);
  return respondWithIdempotency(
    ctx.req, caller, BUNDLE, '/quotes', body,
    async () => {
      const client = admin();
      const { data, error } = await client
        .from('quotes')
        .insert({
          ...body,
          org_id: caller.orgId,
          state: 'draft',
          created_by: caller.userId,
          updated_by: caller.userId,
        })
        .select('*').maybeSingle();
      if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
      return created(data);
    },
  );
};

const updateQuote = async (ctx: RouteCtx) => {
  const caller = requireCaller(ctx.req);
  requireCap(caller, 'quotes.quote.write');
  const body = await parseBody(ctx.req, UpdateQuoteRequestSchema);
  return respondWithIdempotency(
    ctx.req, caller, BUNDLE, '/quotes/:id', body,
    async () => {
      const client = admin();
      const { data, error } = await client
        .from('quotes')
        .update({ ...body, updated_by: caller.userId, updated_at: new Date().toISOString() })
        .eq('id', ctx.params.id).eq('org_id', caller.orgId)
        .select('*').maybeSingle();
      if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
      if (!data) throw new ApiError('NOT_FOUND', 404);
      return ok(data);
    },
  );
};

const deleteQuote = async (ctx: RouteCtx) => {
  const caller = requireCaller(ctx.req);
  requireCap(caller, 'quotes.quote.delete');
  return respondWithIdempotency(
    ctx.req, caller, BUNDLE, '/quotes/:id-delete', null,
    async () => {
      const client = admin();
      const { data, error } = await client
        .from('quotes')
        .update({ deleted_at: new Date().toISOString(), updated_by: caller.userId })
        .eq('id', ctx.params.id).eq('org_id', caller.orgId)
        .select('id').maybeSingle();
      if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
      if (!data) throw new ApiError('NOT_FOUND', 404);
      return ok({ id: data.id, deleted: true });
    },
  );
};

// --- line items ---

const computeLineMath = (line: {
  quantity_e3: number | string;
  unit_price_cents: number | string;
  discount_bps: number;
  tax_rate_snapshot: number;
  is_taxable: boolean;
}) => {
  const qtyE3 = BigInt(String(line.quantity_e3));
  const unit = BigInt(String(line.unit_price_cents));
  // qty * unit is scaled by 1e3 from qtyE3; divide back out (truncating).
  const gross = (qtyE3 * unit) / 1000n;
  const discount = (gross * BigInt(line.discount_bps)) / 10_000n;
  const net = gross - discount;
  const tax = line.is_taxable
    ? (net * BigInt(line.tax_rate_snapshot)) / 10_000n
    : 0n;
  const total = net + tax;
  return {
    line_subtotal_cents: gross.toString(),
    line_discount_cents: discount.toString(),
    line_tax_cents: tax.toString(),
    line_total_cents: total.toString(),
  };
};

const addLineItem = async (ctx: RouteCtx) => {
  const caller = requireCaller(ctx.req);
  requireCap(caller, 'quotes.quote.write');
  const body = await parseBody(ctx.req, CreateQuoteLineRequestSchema);
  return respondWithIdempotency(
    ctx.req, caller, BUNDLE, '/quotes/:id/line-items', body,
    async () => {
      const client = admin();
      // Confirm parent quote is in this org and editable.
      const { data: parent, error: pErr } = await client
        .from('quotes').select('id, org_id, state')
        .eq('id', ctx.params.id).eq('org_id', caller.orgId).maybeSingle();
      if (pErr) throw new ApiError('INTERNAL_ERROR', 500, pErr.message);
      if (!parent) throw new ApiError('NOT_FOUND', 404);
      if (!['draft', 'revise_requested'].includes(parent.state as string)) {
        throw new ApiError('STATE_CONFLICT', 409, 'quote is not editable in current state');
      }

      // Snapshot the tax rate now if tax_id is provided; the DB trigger
      // also enforces this, but we precompute math here.
      let taxRate = 0;
      if (body.tax_id) {
        const { data: tax } = await client
          .from('taxes').select('rate_bps').eq('id', body.tax_id).maybeSingle();
        if (tax) taxRate = Number((tax as { rate_bps: number }).rate_bps ?? 0);
      }

      const math = computeLineMath({
        quantity_e3: body.quantity_e3,
        unit_price_cents: body.unit_price_cents,
        discount_bps: body.discount_bps,
        tax_rate_snapshot: taxRate,
        is_taxable: body.is_taxable,
      });

      const insert = {
        quote_id: ctx.params.id,
        position: body.position ?? 0,
        item_id: body.item_id ?? null,
        vas_id: body.vas_id ?? null,
        sku: body.sku ?? null,
        name: body.name,
        description: body.description ?? null,
        kind: body.kind,
        quantity_e3: body.quantity_e3,
        unit_price_cents: body.unit_price_cents,
        discount_bps: body.discount_bps,
        tax_id: body.tax_id ?? null,
        tax_rate_snapshot: taxRate,
        is_taxable: body.is_taxable,
        ...math,
        created_by: caller.userId,
        updated_by: caller.userId,
      };

      const { data, error } = await client
        .from('quote_line_items').insert(insert).select('*').maybeSingle();
      if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);

      await client.rpc('recompute_quote_totals', { p_quote_id: ctx.params.id });
      return created(data);
    },
  );
};

const removeLineItem = async (ctx: RouteCtx) => {
  const caller = requireCaller(ctx.req);
  requireCap(caller, 'quotes.quote.write');
  return respondWithIdempotency(
    ctx.req, caller, BUNDLE, '/quotes/:id/line-items/:lineId', null,
    async () => {
      const client = admin();
      const { data: parent } = await client
        .from('quotes').select('id, org_id')
        .eq('id', ctx.params.id).eq('org_id', caller.orgId).maybeSingle();
      if (!parent) throw new ApiError('NOT_FOUND', 404);
      const { error } = await client
        .from('quote_line_items').delete()
        .eq('id', ctx.params.lineId).eq('quote_id', ctx.params.id);
      if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
      await client.rpc('recompute_quote_totals', { p_quote_id: ctx.params.id });
      return ok({ id: ctx.params.lineId, deleted: true });
    },
  );
};

// --- transitions ---

async function transitionTo(
  ctx: RouteCtx,
  to: QuoteState,
  cap: 'quotes.quote.submit' | 'quotes.quote.approve' | 'quotes.quote.revise' | 'quotes.quote.cancel',
  routeKey: string,
) {
  const caller = requireCaller(ctx.req);
  requireCap(caller, cap);
  return respondWithIdempotency(
    ctx.req, caller, BUNDLE, routeKey, { to },
    async () => {
      const client = admin();
      const { data: quote, error: qErr } = await client
        .from('quotes').select('id, org_id, state')
        .eq('id', ctx.params.id).eq('org_id', caller.orgId).maybeSingle();
      if (qErr) throw new ApiError('INTERNAL_ERROR', 500, qErr.message);
      if (!quote) throw new ApiError('NOT_FOUND', 404);
      const from = quote.state as QuoteState;
      if (!canTransition(QUOTE_FSM, from, to)) {
        throw new ApiError('STATE_CONFLICT', 409,
          `illegal transition ${from} -> ${to}`);
      }
      const { data, error } = await client
        .from('quotes')
        .update({ state: to, updated_by: caller.userId })
        .eq('id', ctx.params.id).eq('org_id', caller.orgId)
        .select('*').maybeSingle();
      if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
      return ok(data);
    },
  );
}

const submitQuote   = (c: RouteCtx) => transitionTo(c, 'submitted',        'quotes.quote.submit',  '/quotes/:id/submit');
const approveQuote  = (c: RouteCtx) => transitionTo(c, 'approved',         'quotes.quote.approve', '/quotes/:id/approve');
const reviseQuote   = (c: RouteCtx) => transitionTo(c, 'revise_requested', 'quotes.quote.revise',  '/quotes/:id/revise');
const cancelQuote   = (c: RouteCtx) => transitionTo(c, 'cancelled',        'quotes.quote.cancel',  '/quotes/:id/cancel');

// --- send (no transition, marks sent_at) ---

const SendBodySchema = z.object({ recipient_email: z.string().email().optional() });

const sendQuote = async (ctx: RouteCtx) => {
  const caller = requireCaller(ctx.req);
  requireCap(caller, 'quotes.send');
  const body = await parseBody(ctx.req, SendBodySchema);
  return respondWithIdempotency(
    ctx.req, caller, BUNDLE, '/quotes/:id/send', body,
    async () => {
      const client = admin();
      const { data, error } = await client
        .from('quotes')
        .update({ sent_at: new Date().toISOString(), updated_by: caller.userId })
        .eq('id', ctx.params.id).eq('org_id', caller.orgId)
        .select('*').maybeSingle();
      if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
      if (!data) throw new ApiError('NOT_FOUND', 404);
      // PDF email wiring lands when Agent F's pdf-worker is online.
      return ok(data);
    },
  );
};

// --- convert to project ---

const convertToProject = async (ctx: RouteCtx) => {
  const caller = requireCaller(ctx.req);
  requireCap(caller, 'quotes.convert_to_project');
  const body = await parseBody(ctx.req, ConvertQuoteToProjectRequestSchema);
  return respondWithIdempotency(
    ctx.req, caller, BUNDLE, '/quotes/:id/convert-to-project', body,
    async () => {
      const client = admin();
      // p_caller_org_id closes the cross-tenant gate at the RPC boundary.
      // The 0016 RPC relied on public.current_org_id() which returns NULL
      // under the service-role client; migration 0041 takes the org id as
      // an explicit param and surfaces a missing-or-cross-tenant quote as
      // NOT_FOUND (constitutional 404, never 403).
      const { data, error } = await client.rpc('convert_quote_to_project', {
        p_quote_id: ctx.params.id,
        p_actor: caller.userId,
        p_caller_org_id: caller.orgId,
        p_project_number: body.project_number ?? null,
      });
      if (error) {
        if (/NOT_FOUND/.test(error.message)) throw new ApiError('NOT_FOUND', 404);
        if (/STATE_CONFLICT/.test(error.message)) {
          throw new ApiError('STATE_CONFLICT', 409, error.message);
        }
        throw new ApiError('INTERNAL_ERROR', 500, error.message);
      }
      return created({ project_id: data });
    },
  );
};

// --- versions ---

const listVersions = async (ctx: RouteCtx) => {
  const caller = requireCaller(ctx.req);
  requireCap(caller, 'quotes.version.read');
  const client = admin();
  // Confirm quote belongs to caller's org.
  const { data: q } = await client
    .from('quotes').select('id').eq('id', ctx.params.id)
    .eq('org_id', caller.orgId).maybeSingle();
  if (!q) throw new ApiError('NOT_FOUND', 404);
  const { data, error } = await client
    .from('quote_versions').select('*')
    .eq('quote_id', ctx.params.id)
    .order('version_number', { ascending: false });
  if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
  return ok({ items: data ?? [] });
};

// --- PDF (stub; Agent F's pdf-worker not yet online) ---

const getPdf = async (ctx: RouteCtx) => {
  const caller = requireCaller(ctx.req);
  requireCap(caller, 'quotes.pdf.read');
  // Confirm quote exists in this org so an unauthorized peeker still 404s.
  const client = admin();
  const { data: q } = await client
    .from('quotes').select('id').eq('id', ctx.params.id)
    .eq('org_id', caller.orgId).maybeSingle();
  if (!q) throw new ApiError('NOT_FOUND', 404);
  throw new ApiError('PDF_NOT_YET_AVAILABLE', 501,
    'PDF rendering is not yet available. Track Wave 2 Agent F follow-up.');
};

// --- approvals ---

const ApprovalDecisionSchema = z.object({
  decision: z.enum(['approved', 'rejected', 'cancelled']),
  reason: z.string().nullable().optional(),
});

const requestApproval = async (ctx: RouteCtx) => {
  const caller = requireCaller(ctx.req);
  requireCap(caller, 'quotes.approval.write');
  return respondWithIdempotency(
    ctx.req, caller, BUNDLE, '/quotes/:id/approvals', {},
    async () => {
      const client = admin();
      const { data: q } = await client
        .from('quotes').select('id, org_id').eq('id', ctx.params.id)
        .eq('org_id', caller.orgId).maybeSingle();
      if (!q) throw new ApiError('NOT_FOUND', 404);
      const { data, error } = await client
        .from('quote_approvals')
        .insert({ quote_id: ctx.params.id, requested_by: caller.userId })
        .select('*').maybeSingle();
      if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
      return created(data);
    },
  );
};

const decideApproval = async (ctx: RouteCtx) => {
  const caller = requireCaller(ctx.req);
  requireCap(caller, 'quotes.approval.write');
  const body = await parseBody(ctx.req, ApprovalDecisionSchema);
  return respondWithIdempotency(
    ctx.req, caller, BUNDLE, '/quotes/:id/approvals/:approvalId', body,
    async () => {
      const client = admin();
      const { data, error } = await client
        .from('quote_approvals')
        .update({
          decision: body.decision,
          reason: body.reason ?? null,
          approver_id: caller.userId,
          decided_at: new Date().toISOString(),
        })
        .eq('id', ctx.params.approvalId)
        .eq('quote_id', ctx.params.id)
        .select('*').maybeSingle();
      if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
      if (!data) throw new ApiError('NOT_FOUND', 404);
      return ok(data);
    },
  );
};

// silence unused
void QuoteStateSchema;

const ROUTES: Route[] = [
  { method: 'GET',    path: '/quotes',                              handler: listQuotes },
  { method: 'GET',    path: '/quotes/:id',                          handler: getQuote },
  { method: 'POST',   path: '/quotes',                              handler: createQuote },
  { method: 'PATCH',  path: '/quotes/:id',                          handler: updateQuote },
  { method: 'DELETE', path: '/quotes/:id',                          handler: deleteQuote },

  { method: 'POST',   path: '/quotes/:id/line-items',               handler: addLineItem },
  { method: 'DELETE', path: '/quotes/:id/line-items/:lineId',       handler: removeLineItem },

  { method: 'POST',   path: '/quotes/:id/submit',                   handler: submitQuote },
  { method: 'POST',   path: '/quotes/:id/approve',                  handler: approveQuote },
  { method: 'POST',   path: '/quotes/:id/revise',                   handler: reviseQuote },
  { method: 'POST',   path: '/quotes/:id/cancel',                   handler: cancelQuote },
  { method: 'POST',   path: '/quotes/:id/send',                     handler: sendQuote },
  { method: 'POST',   path: '/quotes/:id/convert-to-project',       handler: convertToProject },

  { method: 'GET',    path: '/quotes/:id/versions',                 handler: listVersions },
  { method: 'GET',    path: '/quotes/:id/pdf',                      handler: getPdf },

  { method: 'POST',   path: '/quotes/:id/approvals',                handler: requestApproval },
  { method: 'PATCH',  path: '/quotes/:id/approvals/:approvalId',    handler: decideApproval },
];

Deno.serve((req: Request) => route(req, ROUTES, { bundle: BUNDLE }));
