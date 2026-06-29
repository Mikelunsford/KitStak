// estimates-api: draft estimates that price off a rate card and convert into a
// real quote (ADR 0006, P1b).
//
//   GET    /estimates                list the org's estimates
//   GET    /estimates/:id            one estimate plus its recomputed breakdown
//   POST   /estimates                create a draft estimate
//   PATCH  /estimates/:id            edit a draft estimate
//   POST   /estimates/:id/convert    build a real quote from the estimate
//   POST   /estimates/:id/cancel     cancel a draft estimate
//   DELETE /estimates/:id            soft-delete an estimate
//
// Money model: the rate card stores rate_micros (BIGINT, millionths of a
// currency unit); the pure pricing core (../_shared/estimate/engine.ts) reduces
// every line total to integer cents with banker's rounding. The estimate row
// snapshots subtotal_cents / total_cents for the list; the detail view and the
// convert flow recompute the full breakdown server-side from inputs + the rate
// card so no float ever reaches a money column.
//
// One quote engine: convert produces a normal quotes-api quote (header plus
// quote_line_items, then recompute_quote_totals), so the audit trigger, the
// numbering chassis, and the currency snapshot all apply for free. It does NOT
// add a second quote-like store.
//
// Gate: estimates are sales work, so the read/write authority is the quote
// capability (quotes.quote.read / quotes.quote.write), not a new capability.
// RLS posture: service-role bypasses RLS, so every query combines an explicit
// `.eq('org_id', caller.orgId)` (Pattern A).

import { route, type Route, type RouteCtx } from '../_shared/route.ts';
import {
  admin, parseBody, parseUuidParam, respondWithIdempotency, created, requireCap,
} from '../_shared/handler-helpers.ts';
import { ok, ApiError, internalError } from '../_shared/responses.ts';
import { listOrgScoped, assertRefInOrg } from '../_shared/crud.ts';
import { requireCaller, type Caller } from '../_shared/tenant.ts';
import { nextDocNumber } from '../_shared/numbering.ts';
import {
  computeEstimate, fmtCents, MIN_PROJECT_CENTS,
  type EstimateInput, type EstimateResult,
} from '../_shared/estimate/engine.ts';
import {
  FAMILIES, type EngineKind, type FamilyKey,
} from '../_shared/estimate/families.ts';
import type { RateCardLine } from '../_shared/estimate/rateCard.ts';
import {
  CreateEstimateRequestSchema, UpdateEstimateRequestSchema,
  ConvertEstimateRequestSchema, EstimateInputsSchema,
} from '../_shared/types/estimate.ts';

const BUNDLE = 'estimates-api';

// The stored estimate row shape the handlers read back from the DB.
interface EstimateRow {
  id: string;
  org_id: string;
  name: string;
  customer_id: string | null;
  rate_card_id: string | null;
  family: string;
  engine: string;
  currency_code: string;
  status: string;
  inputs: unknown;
  notes: string | null;
}

// Resolve the rate-card lines the engine prices against: the estimate's card, or
// the org's default card when the estimate names none. Maps the DB columns
// (group_key, rate_micros) onto the engine's RateCardLine shape. Missing card or
// lines yields an empty card; the engine prices unknown codes at 0, never throws.
async function loadRateCardLines(
  orgId: string,
  rateCardId: string | null,
): Promise<RateCardLine[]> {
  const client = admin();
  let cardId = rateCardId;
  if (!cardId) {
    const { data: def, error: defErr } = await client
      .from('rate_cards').select('id')
      .eq('org_id', orgId).eq('is_default', true)
      .is('deleted_at', null)
      .maybeSingle();
    if (defErr) throw internalError(BUNDLE, defErr);
    cardId = (def?.id as string | undefined) ?? null;
  }
  if (!cardId) return [];
  const { data: rows, error } = await client
    .from('rate_card_lines').select('code, group_key, label, rate_micros')
    .eq('org_id', orgId).eq('rate_card_id', cardId);
  if (error) throw internalError(BUNDLE, error);
  return ((rows ?? []) as Array<Record<string, unknown>>).map((r) => ({
    code: String(r.code),
    group: r.group_key as RateCardLine['group'],
    label: String(r.label),
    rateMicros: Number(r.rate_micros),
  }));
}

// Build the full EstimateInput from the row's family/engine columns plus its
// inputs jsonb (parsed through the canon schema so every numeric field is
// present and defaulted).
function buildInput(family: string, engine: string, inputs: unknown): EstimateInput {
  const parsed = EstimateInputsSchema.parse(inputs ?? {});
  return {
    family: family as FamilyKey,
    engine: engine as EngineKind,
    ...parsed,
  };
}

// Recompute the full result for a stored estimate from its inputs + rate card.
async function computeForRow(orgId: string, row: EstimateRow): Promise<EstimateResult> {
  const lines = await loadRateCardLines(orgId, row.rate_card_id);
  return computeEstimate(buildInput(row.family, row.engine, row.inputs), lines);
}

// Map the engine result onto the snake_case wire DTO the SPA renders.
function resultDto(r: EstimateResult) {
  const mapItem = (li: { label: string; detail: string; amountCents: number }) => ({
    label: li.label, detail: li.detail, amount_cents: li.amountCents,
  });
  return {
    production_items: r.productionItems.map(mapItem),
    pass_through_items: r.passThroughItems.map(mapItem),
    production_cents: r.productionCents,
    pass_through_cents: r.passThroughCents,
    raw_cents: r.rawCents,
    total_cents: r.totalCents,
    min_applied: r.minApplied,
    has_production: r.hasProduction,
    margin_ok: r.marginOk,
  };
}

// Load one estimate, org-scoped and not soft-deleted. Throws NOT_FOUND on a
// missing or cross-tenant id (never a leak).
async function loadEstimate(caller: Caller, id: string): Promise<EstimateRow> {
  const { data, error } = await admin()
    .from('estimates').select('*')
    .eq('id', id).eq('org_id', caller.orgId)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw internalError(BUNDLE, error);
  if (!data) throw new ApiError('NOT_FOUND', 404);
  return data as EstimateRow;
}

// --- list / get ---

const listEstimates = async (ctx: RouteCtx) => {
  const caller = requireCaller(ctx.req);
  requireCap(caller, 'quotes.quote.read');
  const page = await listOrgScoped('estimates', caller, ctx.url);
  return ok(page);
};

const getEstimate = async (ctx: RouteCtx) => {
  const caller = requireCaller(ctx.req);
  requireCap(caller, 'quotes.quote.read');
  parseUuidParam(ctx.params.id);
  const row = await loadEstimate(caller, ctx.params.id);
  const result = await computeForRow(caller.orgId, row);
  return ok({ estimate: row, result: resultDto(result) });
};

// --- create / patch ---

const createEstimate = async (ctx: RouteCtx) => {
  const caller = requireCaller(ctx.req);
  requireCap(caller, 'quotes.quote.write');
  const body = await parseBody(ctx.req, CreateEstimateRequestSchema);
  return respondWithIdempotency(
    ctx.req, caller, BUNDLE, '/estimates', body,
    async () => {
      if (body.customer_id) await assertRefInOrg('customers', caller, body.customer_id);
      if (body.rate_card_id) await assertRefInOrg('rate_cards', caller, body.rate_card_id);

      const inputs = EstimateInputsSchema.parse(body.inputs ?? {});
      const engine = body.engine ?? FAMILIES[body.family as FamilyKey]?.engine ?? 'flat';
      const result = computeEstimate(
        { family: body.family as FamilyKey, engine: engine as EngineKind, ...inputs },
        await loadRateCardLines(caller.orgId, body.rate_card_id ?? null),
      );

      const { data, error } = await admin()
        .from('estimates')
        .insert({
          org_id: caller.orgId,
          name: body.name,
          customer_id: body.customer_id ?? null,
          rate_card_id: body.rate_card_id ?? null,
          family: body.family,
          engine,
          currency_code: body.currency_code,
          status: 'draft',
          inputs,
          subtotal_cents: result.rawCents,
          total_cents: result.totalCents,
          min_applied: result.minApplied,
          notes: body.notes ?? null,
          created_by: caller.userId,
          updated_by: caller.userId,
        })
        .select('*').maybeSingle();
      if (error) throw internalError(BUNDLE, error);
      return created(data);
    },
  );
};

const patchEstimate = async (ctx: RouteCtx) => {
  const caller = requireCaller(ctx.req);
  requireCap(caller, 'quotes.quote.write');
  parseUuidParam(ctx.params.id);
  const body = await parseBody(ctx.req, UpdateEstimateRequestSchema);
  return respondWithIdempotency(
    ctx.req, caller, BUNDLE, '/estimates/:id', body,
    async () => {
      const existing = await loadEstimate(caller, ctx.params.id);
      if (existing.status !== 'draft') {
        throw new ApiError('STATE_CONFLICT', 409, 'only a draft estimate can be edited');
      }
      if (body.customer_id) await assertRefInOrg('customers', caller, body.customer_id);
      if (body.rate_card_id) await assertRefInOrg('rate_cards', caller, body.rate_card_id);

      // Merge: family/engine/rate_card/customer follow the body when sent, else
      // hold their stored value. When the family changes without an explicit
      // engine, the new family's default engine applies.
      const family = (body.family ?? existing.family) as FamilyKey;
      const engine = (body.engine
        ?? (body.family ? FAMILIES[body.family as FamilyKey]?.engine : undefined)
        ?? existing.engine) as EngineKind;
      const rateCardId = body.rate_card_id !== undefined ? body.rate_card_id : existing.rate_card_id;
      const mergedInputs = EstimateInputsSchema.parse({
        ...EstimateInputsSchema.parse(existing.inputs ?? {}),
        ...(body.inputs ?? {}),
      });
      const result = computeEstimate(
        { family, engine, ...mergedInputs },
        await loadRateCardLines(caller.orgId, rateCardId),
      );

      const patch: Record<string, unknown> = {
        family,
        engine,
        inputs: mergedInputs,
        subtotal_cents: result.rawCents,
        total_cents: result.totalCents,
        min_applied: result.minApplied,
        updated_by: caller.userId,
        updated_at: new Date().toISOString(),
      };
      if (body.name !== undefined) patch.name = body.name;
      if (body.customer_id !== undefined) patch.customer_id = body.customer_id;
      if (body.rate_card_id !== undefined) patch.rate_card_id = body.rate_card_id;
      if (body.currency_code !== undefined) patch.currency_code = body.currency_code;
      if (body.notes !== undefined) patch.notes = body.notes;

      const { data, error } = await admin()
        .from('estimates').update(patch)
        .eq('id', ctx.params.id).eq('org_id', caller.orgId)
        .eq('status', 'draft')
        .select('*').maybeSingle();
      if (error) throw internalError(BUNDLE, error);
      if (!data) throw new ApiError('NOT_FOUND', 404);
      return ok(data);
    },
  );
};

// --- convert to quote ---

const convertEstimate = async (ctx: RouteCtx) => {
  const caller = requireCaller(ctx.req);
  requireCap(caller, 'quotes.quote.write');
  parseUuidParam(ctx.params.id);
  const body = await parseBody(ctx.req, ConvertEstimateRequestSchema);
  return respondWithIdempotency(
    ctx.req, caller, BUNDLE, '/estimates/:id/convert', { estimate_id: ctx.params.id, ...body },
    async () => {
      const est = await loadEstimate(caller, ctx.params.id);
      if (est.status !== 'draft') {
        throw new ApiError('STATE_CONFLICT', 409, 'this estimate has already been converted or cancelled');
      }
      if (!est.customer_id) {
        throw new ApiError(
          'VALIDATION_ERROR', 422,
          'An estimate needs a customer before it converts to a quote. Choose one first.',
        );
      }
      await assertRefInOrg('customers', caller, est.customer_id);

      const result = await computeForRow(caller.orgId, est);
      const client = admin();

      // Each estimate line is already a rounded cents total (the engine rounds at
      // the line grain), so it maps to a single-unit quote line at that cents
      // amount. quantity_e3 = 1000 (qty 1), no discount, no tax: the line total
      // equals the estimate line total exactly. No float, no re-derivation.
      const estLines = [...result.productionItems, ...result.passThroughItems]
        .map((li) => ({ name: li.label, description: li.detail, amount: li.amountCents }));
      if (result.minApplied) {
        estLines.push({
          name: 'Project minimum adjustment',
          description: `Applied the ${fmtCents(MIN_PROJECT_CENTS)} project minimum`,
          amount: result.totalCents - result.rawCents,
        });
      }

      const number = body.number?.trim()
        ? body.number.trim()
        : await nextDocNumber(caller.orgId, 'quote');

      const { data: quote, error: qErr } = await client
        .from('quotes')
        .insert({
          org_id: caller.orgId,
          number,
          customer_id: est.customer_id,
          title: body.title?.trim() ? body.title.trim() : est.name,
          description: est.notes ?? null,
          currency_code: est.currency_code,
          state: 'draft',
          created_by: caller.userId,
          updated_by: caller.userId,
        })
        .select('id').maybeSingle();
      if (qErr) throw internalError(BUNDLE, qErr);
      const quoteId = (quote as { id: string }).id;

      for (let i = 0; i < estLines.length; i++) {
        const l = estLines[i];
        const amount = String(l.amount);
        const { error: lErr } = await client
          .from('quote_line_items')
          .insert({
            quote_id: quoteId,
            position: i,
            item_id: null,
            vas_id: null,
            sku: null,
            name: l.name,
            description: l.description,
            kind: 'item',
            quantity_e3: 1000,
            unit_price_cents: amount,
            discount_bps: 0,
            tax_id: null,
            tax_rate_snapshot: 0,
            is_taxable: false,
            billing_interval: 'one_time',
            tier_id: null,
            line_subtotal_cents: amount,
            line_discount_cents: '0',
            line_tax_cents: '0',
            line_total_cents: amount,
            created_by: caller.userId,
            updated_by: caller.userId,
          });
        if (lErr) throw internalError(BUNDLE, lErr);
      }

      // Server-authoritative header totals from the lines just written.
      const { error: rpcErr } = await client.rpc('recompute_quote_totals', {
        p_quote_id: quoteId,
      });
      if (rpcErr) throw internalError(BUNDLE, rpcErr);

      // Stamp the estimate converted. Guarded on status=draft so a concurrent
      // convert that already landed surfaces as 0 rows (the idempotency layer is
      // the primary guard; this is belt-and-suspenders).
      const { data: updated, error: uErr } = await client
        .from('estimates')
        .update({
          status: 'converted',
          converted_to_quote_id: quoteId,
          converted_at: new Date().toISOString(),
          updated_by: caller.userId,
        })
        .eq('id', est.id).eq('org_id', caller.orgId).eq('status', 'draft')
        .select('id').maybeSingle();
      if (uErr) throw internalError(BUNDLE, uErr);
      if (!updated) throw new ApiError('STATE_CONFLICT', 409, 'estimate state changed during convert');

      return created({ quote_id: quoteId, estimate_id: est.id });
    },
  );
};

// --- cancel / delete ---

const cancelEstimate = async (ctx: RouteCtx) => {
  const caller = requireCaller(ctx.req);
  requireCap(caller, 'quotes.quote.write');
  parseUuidParam(ctx.params.id);
  return respondWithIdempotency(
    ctx.req, caller, BUNDLE, '/estimates/:id/cancel', { estimate_id: ctx.params.id },
    async () => {
      const est = await loadEstimate(caller, ctx.params.id);
      if (est.status !== 'draft') {
        throw new ApiError('STATE_CONFLICT', 409, 'only a draft estimate can be cancelled');
      }
      const { data, error } = await admin()
        .from('estimates')
        .update({ status: 'cancelled', cancelled_at: new Date().toISOString(), updated_by: caller.userId })
        .eq('id', est.id).eq('org_id', caller.orgId).eq('status', 'draft')
        .select('*').maybeSingle();
      if (error) throw internalError(BUNDLE, error);
      if (!data) throw new ApiError('NOT_FOUND', 404);
      return ok(data);
    },
  );
};

const deleteEstimate = async (ctx: RouteCtx) => {
  const caller = requireCaller(ctx.req);
  requireCap(caller, 'quotes.quote.write');
  parseUuidParam(ctx.params.id);
  return respondWithIdempotency(
    ctx.req, caller, BUNDLE, '/estimates/:id-delete', null,
    async () => {
      const { data, error } = await admin()
        .from('estimates')
        .update({ deleted_at: new Date().toISOString(), updated_by: caller.userId })
        .eq('id', ctx.params.id).eq('org_id', caller.orgId)
        .is('deleted_at', null)
        .select('id').maybeSingle();
      if (error) throw internalError(BUNDLE, error);
      if (!data) throw new ApiError('NOT_FOUND', 404);
      return ok({ id: data.id, deleted: true });
    },
  );
};

const ROUTES: Route[] = [
  { method: 'GET',    path: '/estimates',              handler: listEstimates },
  { method: 'GET',    path: '/estimates/:id',          handler: getEstimate },
  { method: 'POST',   path: '/estimates',              handler: createEstimate },
  { method: 'PATCH',  path: '/estimates/:id',          handler: patchEstimate },
  { method: 'POST',   path: '/estimates/:id/convert',  handler: convertEstimate },
  { method: 'POST',   path: '/estimates/:id/cancel',   handler: cancelEstimate },
  { method: 'DELETE', path: '/estimates/:id',          handler: deleteEstimate },
];

Deno.serve((req) => route(req, ROUTES, { bundle: BUNDLE }));

export {
  listEstimates, getEstimate, createEstimate, patchEstimate,
  convertEstimate, cancelEstimate, deleteEstimate,
};
