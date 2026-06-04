// quotes-api: CRUD for quotes + quote_line_items, state transitions, version
// snapshots, conversion to project, and the (stub) PDF endpoint.
//
// BUNDLE GATE: plugins.three_pl. The entire bundle returns 404 NOT_FOUND
// when the pillar plugin flag is off for the caller's org. Implementation
// lives in _shared/bundleGate.ts; quotes-api, projects-api, inventory-api,
// and ops-api all share the same gate. Per constitutional rule (CLAUDE.md):
// plugin bundle gates return 404, per-route feature flags return 403.
//
// Routing: flat `Route[]` dispatched via `_shared/route.ts`. Every non-GET
// goes through `respondWithIdempotency` + `requireCap` + the workflow check.
// Cap-gate runs inside each handler (after the bundle gate) so the caller
// must hold the cap BEFORE we tell them the route exists.

import { z } from 'zod';

import { type Route, type RouteCtx } from '../_shared/route.ts';
import {
  admin, parseBody, parseLimit, paginate, parseUuidParam, respondWithIdempotency, created,
  requireCap,
} from '../_shared/handler-helpers.ts';
import { ok, ApiError, internalError } from '../_shared/responses.ts';
import { assertRefInOrg } from '../_shared/crud.ts';
import { requireCaller } from '../_shared/tenant.ts';
import { serveBundleWithGate } from '../_shared/bundleGate.ts';
import { FEATURE_FLAGS } from '../_shared/constants.ts';
import {
  CreateQuoteRequestSchema, UpdateQuoteRequestSchema,
  CreateQuoteLineRequestSchema, ConvertQuoteToProjectRequestSchema,
  QuoteStateSchema,
} from '../_shared/types/sales.ts';
import { QUOTE_FSM, canTransition, type QuoteState } from '../_shared/workflow/sales.ts';
import { nextDocNumber } from '../_shared/numbering.ts';

const BUNDLE = 'quotes-api';

// --- list / get ---

const listQuotes = async (ctx: RouteCtx) => {
  const caller = requireCaller(ctx.req);
  requireCap(caller, 'quotes.quote.read');
  const limit = parseLimit(ctx.url);
  const state = ctx.url.searchParams.get('state');
  // F-Wave7-LISTFILTER-01: customer_id FK filter lifts the CustomerDetailPage
  // client-side .filter(...) into a SQL where-clause. RLS Pattern A wraps the
  // org gate so a cross-tenant customer_id still resolves to 200 + [].
  const customerId = ctx.url.searchParams.get('customer_id');
  const client = admin();
  let q = client
    .from('quotes').select('*')
    .eq('org_id', caller.orgId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(limit + 1);
  if (state) q = q.eq('state', state);
  if (customerId) q = q.eq('customer_id', customerId);
  const { data, error } = await q;
  if (error) throw internalError('quotes-api', error);
  const rows = data ?? [];
  return ok(paginate(rows as Array<{ id: string; created_at: string }>, limit));
};

const getQuote = async (ctx: RouteCtx) => {
  const caller = requireCaller(ctx.req);
  requireCap(caller, 'quotes.quote.read');
  parseUuidParam(ctx.params.id);
  const client = admin();
  const { data: quote, error: qErr } = await client
    .from('quotes').select('*')
    .eq('id', ctx.params.id).eq('org_id', caller.orgId)
    .maybeSingle();
  if (qErr) throw internalError('quotes-api', qErr);
  if (!quote) throw new ApiError('NOT_FOUND', 404);
  const { data: lines, error: lErr } = await client
    .from('quote_line_items').select('*')
    .eq('quote_id', ctx.params.id)
    .order('position', { ascending: true });
  if (lErr) throw internalError('quotes-api', lErr);
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
      // F-Wave9-AUTO-NUMBERING-01 (B8): operator may pass a `number` to
      // override; otherwise the org-scoped numbering chassis allocates the
      // next Q-YYYY-NNNNN string via next_doc_number. Mirrors the
      // manufacturing-api pattern from 0054. Empty string is treated as
      // absent so the SPA can drop the field entirely.
      if (body.customer_id) { await assertRefInOrg('customers', caller, body.customer_id); }
      if (body.default_tax_id) { await assertRefInOrg('taxes', caller, body.default_tax_id); }
      if (body.payment_method_id) { await assertRefInOrg('payment_methods', caller, body.payment_method_id); }
      if (body.pricing_tier_id) { await assertRefInOrg('pricing_tiers', caller, body.pricing_tier_id); }
      const supplied = body.number?.trim();
      const number = supplied
        ? supplied
        : await nextDocNumber(caller.orgId, 'quote');
      const client = admin();
      const { data, error } = await client
        .from('quotes')
        .insert({
          ...body,
          number,
          org_id: caller.orgId,
          state: 'draft',
          created_by: caller.userId,
          updated_by: caller.userId,
        })
        .select('*').maybeSingle();
      if (error) throw internalError('quotes-api', error);
      return created(data);
    },
  );
};

const updateQuote = async (ctx: RouteCtx) => {
  const caller = requireCaller(ctx.req);
  requireCap(caller, 'quotes.quote.write');
  parseUuidParam(ctx.params.id);
  const body = await parseBody(ctx.req, UpdateQuoteRequestSchema);
  return respondWithIdempotency(
    ctx.req, caller, BUNDLE, '/quotes/:id', body,
    async () => {
      if (body.customer_id) { await assertRefInOrg('customers', caller, body.customer_id); }
      if (body.default_tax_id) { await assertRefInOrg('taxes', caller, body.default_tax_id); }
      if (body.payment_method_id) { await assertRefInOrg('payment_methods', caller, body.payment_method_id); }
      if (body.pricing_tier_id) { await assertRefInOrg('pricing_tiers', caller, body.pricing_tier_id); }
      const client = admin();
      const { data, error } = await client
        .from('quotes')
        .update({ ...body, updated_by: caller.userId, updated_at: new Date().toISOString() })
        .eq('id', ctx.params.id).eq('org_id', caller.orgId)
        .select('*').maybeSingle();
      if (error) throw internalError('quotes-api', error);
      if (!data) throw new ApiError('NOT_FOUND', 404);
      return ok(data);
    },
  );
};

const deleteQuote = async (ctx: RouteCtx) => {
  const caller = requireCaller(ctx.req);
  requireCap(caller, 'quotes.quote.delete');
  parseUuidParam(ctx.params.id);
  return respondWithIdempotency(
    ctx.req, caller, BUNDLE, '/quotes/:id-delete', null,
    async () => {
      const client = admin();
      const { data, error } = await client
        .from('quotes')
        .update({ deleted_at: new Date().toISOString(), updated_by: caller.userId })
        .eq('id', ctx.params.id).eq('org_id', caller.orgId)
        .select('id').maybeSingle();
      if (error) throw internalError('quotes-api', error);
      if (!data) throw new ApiError('NOT_FOUND', 404);
      return ok({ id: data.id, deleted: true });
    },
  );
};

// --- line items ---

// A6 (WS-A MONEY INTEGRITY, doc): currency is snapshotted at the
// document-header grain by design (quotes.currency_code). Quote lines do not
// carry a per-line currency_code because Kitstak is single-currency-per-
// document. The same convention holds on invoice lines and purchase-order
// lines. No schema change.
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
  parseUuidParam(ctx.params.id);
  const body = await parseBody(ctx.req, CreateQuoteLineRequestSchema);
  return respondWithIdempotency(
    ctx.req, caller, BUNDLE, '/quotes/:id/line-items', body,
    async () => {
      const client = admin();
      // Confirm parent quote is in this org and editable.
      const { data: parent, error: pErr } = await client
        .from('quotes').select('id, org_id, state')
        .eq('id', ctx.params.id).eq('org_id', caller.orgId).maybeSingle();
      if (pErr) throw internalError('quotes-api', pErr);
      if (!parent) throw new ApiError('NOT_FOUND', 404);
      if (!['draft', 'revise_requested'].includes(parent.state as string)) {
        throw new ApiError('STATE_CONFLICT', 409, 'quote is not editable in current state');
      }

      if (body.item_id) { await assertRefInOrg('items', caller, body.item_id); }
      if (body.vas_id) { await assertRefInOrg('value_added_services', caller, body.vas_id); }
      if (body.tax_id) { await assertRefInOrg('taxes', caller, body.tax_id); }

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
      if (error) throw internalError('quotes-api', error);

      await client.rpc('recompute_quote_totals', { p_quote_id: ctx.params.id });
      return created(data);
    },
  );
};

const removeLineItem = async (ctx: RouteCtx) => {
  const caller = requireCaller(ctx.req);
  requireCap(caller, 'quotes.quote.write');
  parseUuidParam(ctx.params.id);
  parseUuidParam(ctx.params.lineId, 'lineId');
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
      if (error) throw internalError('quotes-api', error);
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
  parseUuidParam(ctx.params.id);
  return respondWithIdempotency(
    ctx.req, caller, BUNDLE, routeKey, { to },
    async () => {
      const client = admin();
      const { data: quote, error: qErr } = await client
        .from('quotes').select('id, org_id, state')
        .eq('id', ctx.params.id).eq('org_id', caller.orgId).maybeSingle();
      if (qErr) throw internalError('quotes-api', qErr);
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
      if (error) throw internalError('quotes-api', error);
      return ok(data);
    },
  );
}

const submitQuote   = (c: RouteCtx) => transitionTo(c, 'submitted',        'quotes.quote.submit',  '/quotes/:id/submit');
const approveQuote  = (c: RouteCtx) => transitionTo(c, 'approved',         'quotes.quote.approve', '/quotes/:id/approve');
const reviseQuote   = (c: RouteCtx) => transitionTo(c, 'revise_requested', 'quotes.quote.revise',  '/quotes/:id/revise');
const cancelQuote   = (c: RouteCtx) => transitionTo(c, 'cancelled',        'quotes.quote.cancel',  '/quotes/:id/cancel');

// --- send (no transition, marks sent_at + queues an email notification) ---
//
// Resolution order for the recipient email:
//   1. body.recipient_email (operator override on this send)
//   2. customers.primary_email for the quote's customer_id
//   3. 422 VALIDATION_ERROR if neither is available
//
// The notification row carries payload.to which the Resend sender reads at
// drain time (see supabase/functions/_shared/notifications/senders.ts).
// Email body is intentionally minimal at v1; richer templating + PDF
// attachment can land in a follow-up without breaking this contract.

const SendBodySchema = z.object({ recipient_email: z.string().email().optional() });

const sendQuote = async (ctx: RouteCtx) => {
  const caller = requireCaller(ctx.req);
  requireCap(caller, 'quotes.send');
  parseUuidParam(ctx.params.id);
  const body = await parseBody(ctx.req, SendBodySchema);
  return respondWithIdempotency(
    ctx.req, caller, BUNDLE, '/quotes/:id/send', body,
    async () => {
      const client = admin();

      // Resolve the quote and its customer's email before stamping sent_at,
      // so we fail closed cleanly when the recipient cannot be determined.
      const { data: quoteRow, error: quoteErr } = await client
        .from('quotes')
        .select('id, number, customer_id, total_cents, currency_code')
        .eq('id', ctx.params.id).eq('org_id', caller.orgId)
        .is('deleted_at', null)
        .maybeSingle();
      if (quoteErr) throw internalError('quotes-api', quoteErr);
      if (!quoteRow) throw new ApiError('NOT_FOUND', 404);

      let customerEmail: string | null = null;
      let customerName: string | null = null;
      if (quoteRow.customer_id) {
        const { data: cust, error: custErr } = await client
          .from('customers')
          .select('primary_email, display_name')
          .eq('id', quoteRow.customer_id).eq('org_id', caller.orgId)
          .maybeSingle();
        if (custErr) throw internalError('quotes-api', custErr);
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

      // Stamp sent_at on the quote.
      const { data, error } = await client
        .from('quotes')
        .update({ sent_at: new Date().toISOString(), updated_by: caller.userId })
        .eq('id', ctx.params.id).eq('org_id', caller.orgId)
        .select('*').maybeSingle();
      if (error) throw internalError('quotes-api', error);
      if (!data) throw new ApiError('NOT_FOUND', 404);

      // Queue the email notification. The notifications-worker drains it on
      // its next cycle. If the INSERT fails after the UPDATE landed, the
      // operator can re-click Send (idempotency-key changes per click) and
      // the second attempt re-queues without double-stamping sent_at.
      const greeting = customerName ? `Hi ${customerName},` : 'Hello,';
      const subject = `Quote ${quoteRow.number}`;
      const emailBody =
        `${greeting}\n\n` +
        `Your quote ${quoteRow.number} is ready for review. ` +
        `Reply to this email if you have any questions.\n\n` +
        `Thanks.`;
      const { error: notifErr } = await client.from('notifications').insert({
        org_id: caller.orgId,
        recipient_user_id: caller.userId,
        entity_type: 'quote',
        entity_id: ctx.params.id,
        channel: 'email',
        subject,
        body: emailBody,
        payload: { to: recipient, quote_number: quoteRow.number },
      });
      if (notifErr) {
        // Do not throw — sent_at already stamped. Log so the operator can
        // diagnose via Edge Function logs and re-click Send to retry.
        console.error('quotes-api: failed to queue email notification', {
          quote_id: ctx.params.id,
          org_id: caller.orgId,
          message: notifErr.message,
        });
      }

      return ok(data);
    },
  );
};

// --- convert to project ---

const convertToProject = async (ctx: RouteCtx) => {
  const caller = requireCaller(ctx.req);
  requireCap(caller, 'quotes.convert_to_project');
  parseUuidParam(ctx.params.id);
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
        throw internalError('quotes-api', error);
      }
      return created({ project_id: data });
    },
  );
};

// --- versions ---

const listVersions = async (ctx: RouteCtx) => {
  const caller = requireCaller(ctx.req);
  requireCap(caller, 'quotes.version.read');
  parseUuidParam(ctx.params.id);
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
  if (error) throw internalError('quotes-api', error);
  return ok(data ?? []);
};

// --- PDF (stub; Agent F's pdf-worker not yet online) ---

const getPdf = async (ctx: RouteCtx) => {
  const caller = requireCaller(ctx.req);
  requireCap(caller, 'quotes.pdf.read');
  parseUuidParam(ctx.params.id);
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
  parseUuidParam(ctx.params.id);
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
      if (error) throw internalError('quotes-api', error);
      return created(data);
    },
  );
};

const decideApproval = async (ctx: RouteCtx) => {
  const caller = requireCaller(ctx.req);
  requireCap(caller, 'quotes.approval.write');
  parseUuidParam(ctx.params.id);
  parseUuidParam(ctx.params.approvalId, 'approvalId');
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
      if (error) throw internalError('quotes-api', error);
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

serveBundleWithGate({
  flagKey: FEATURE_FLAGS.PLUGINS_THREE_PL,
  routes: ROUTES,
  bundle: BUNDLE,
});
