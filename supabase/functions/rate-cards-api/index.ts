// rate-cards-api: CRUD for the Estimate Engine's pricing source (ADR 0006, P1b).
//
//   GET    /rate-cards                       list the org's rate cards
//   GET    /rate-cards/:id                   one card plus its lines
//   POST   /rate-cards                       create a card
//   PATCH  /rate-cards/:id                   patch a card
//   DELETE /rate-cards/:id                   soft-delete a card
//   GET    /rate-cards/:id/lines             the card's lines (position order)
//   POST   /rate-cards/:id/lines             add a line
//   PATCH  /rate-cards/:id/lines/:lineId     patch a line
//   DELETE /rate-cards/:id/lines/:lineId     remove a line
//
// Rate cards are per-org pricing config, so the read/write gate is the settings
// capability (settings.read / settings.write), not a new capability. rate_micros
// is a BIGINT in millionths of a currency unit; no float reaches the column.
//
// RLS posture: service-role bypasses RLS, so every query combines an explicit
// `.eq('org_id', caller.orgId)` (Pattern A). requireCap is the per-route
// authority. No bundle gate: the Estimate Engine generalises past 3PL, so the
// pricing source is not gated on a pillar plugin.

import { route, type Route, type RouteCtx } from '../_shared/route.ts';
import {
  admin, parseBody, parseUuidParam, respondWithIdempotency, created, requireCap,
} from '../_shared/handler-helpers.ts';
import { ok, ApiError, internalError } from '../_shared/responses.ts';
import { listOrgScoped } from '../_shared/crud.ts';
import { requireCaller } from '../_shared/tenant.ts';
import {
  RateCardCreateSchema, RateCardPatchSchema,
  RateCardLineCreateSchema, RateCardLinePatchSchema,
} from '../_shared/types/estimate.ts';

const BUNDLE = 'rate-cards-api';

// Clear the org's existing default flag so a new/edited default does not collide
// with the partial unique index (one default per org among live cards). Scoped
// to the caller org, optionally excluding the card being promoted.
async function clearOtherDefaults(orgId: string, exceptId?: string): Promise<void> {
  const client = admin();
  let q = client
    .from('rate_cards')
    .update({ is_default: false })
    .eq('org_id', orgId)
    .eq('is_default', true)
    .is('deleted_at', null);
  if (exceptId) q = q.neq('id', exceptId);
  const { error } = await q;
  if (error) throw internalError(BUNDLE, error);
}

// --- cards ---

const listCards = async (ctx: RouteCtx) => {
  const caller = requireCaller(ctx.req);
  requireCap(caller, 'settings.read');
  const page = await listOrgScoped('rate_cards', caller, ctx.url);
  return ok(page);
};

const getCard = async (ctx: RouteCtx) => {
  const caller = requireCaller(ctx.req);
  requireCap(caller, 'settings.read');
  parseUuidParam(ctx.params.id);
  const client = admin();
  const { data: card, error: cErr } = await client
    .from('rate_cards').select('*')
    .eq('id', ctx.params.id).eq('org_id', caller.orgId)
    .is('deleted_at', null)
    .maybeSingle();
  if (cErr) throw internalError(BUNDLE, cErr);
  if (!card) throw new ApiError('NOT_FOUND', 404);
  const { data: lines, error: lErr } = await client
    .from('rate_card_lines').select('*')
    .eq('rate_card_id', ctx.params.id).eq('org_id', caller.orgId)
    .order('position', { ascending: true });
  if (lErr) throw internalError(BUNDLE, lErr);
  return ok({ rate_card: card, lines: lines ?? [] });
};

const createCard = async (ctx: RouteCtx) => {
  const caller = requireCaller(ctx.req);
  requireCap(caller, 'settings.write');
  const body = await parseBody(ctx.req, RateCardCreateSchema);
  return respondWithIdempotency(
    ctx.req, caller, BUNDLE, '/rate-cards', body,
    async () => {
      if (body.is_default) await clearOtherDefaults(caller.orgId);
      const { data, error } = await admin()
        .from('rate_cards')
        .insert({
          name: body.name,
          currency_code: body.currency_code,
          is_default: body.is_default ?? false,
          status: body.status ?? 'active',
          notes: body.notes ?? null,
          org_id: caller.orgId,
          created_by: caller.userId,
          updated_by: caller.userId,
        })
        .select('*').maybeSingle();
      if (error) throw internalError(BUNDLE, error);
      return created(data);
    },
  );
};

const patchCard = async (ctx: RouteCtx) => {
  const caller = requireCaller(ctx.req);
  requireCap(caller, 'settings.write');
  parseUuidParam(ctx.params.id);
  const body = await parseBody(ctx.req, RateCardPatchSchema);
  return respondWithIdempotency(
    ctx.req, caller, BUNDLE, '/rate-cards/:id', body,
    async () => {
      if (body.is_default) await clearOtherDefaults(caller.orgId, ctx.params.id);
      const patch: Record<string, unknown> = {
        updated_by: caller.userId,
        updated_at: new Date().toISOString(),
      };
      for (const k of ['name', 'currency_code', 'is_default', 'status', 'notes'] as const) {
        if (body[k] !== undefined) patch[k] = body[k];
      }
      const { data, error } = await admin()
        .from('rate_cards').update(patch)
        .eq('id', ctx.params.id).eq('org_id', caller.orgId)
        .is('deleted_at', null)
        .select('*').maybeSingle();
      if (error) throw internalError(BUNDLE, error);
      if (!data) throw new ApiError('NOT_FOUND', 404);
      return ok(data);
    },
  );
};

const deleteCard = async (ctx: RouteCtx) => {
  const caller = requireCaller(ctx.req);
  requireCap(caller, 'settings.write');
  parseUuidParam(ctx.params.id);
  return respondWithIdempotency(
    ctx.req, caller, BUNDLE, '/rate-cards/:id-delete', null,
    async () => {
      const { data, error } = await admin()
        .from('rate_cards')
        .update({ deleted_at: new Date().toISOString(), is_default: false, updated_by: caller.userId })
        .eq('id', ctx.params.id).eq('org_id', caller.orgId)
        .is('deleted_at', null)
        .select('id').maybeSingle();
      if (error) throw internalError(BUNDLE, error);
      if (!data) throw new ApiError('NOT_FOUND', 404);
      return ok({ id: data.id, deleted: true });
    },
  );
};

// --- lines ---

// Confirm the parent card is in the caller's org (and live). A cross-tenant or
// missing card id surfaces as 404, never a leak.
async function assertCardInOrg(orgId: string, cardId: string): Promise<void> {
  const { data, error } = await admin()
    .from('rate_cards').select('id')
    .eq('id', cardId).eq('org_id', orgId)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw internalError(BUNDLE, error);
  if (!data) throw new ApiError('NOT_FOUND', 404);
}

const listLines = async (ctx: RouteCtx) => {
  const caller = requireCaller(ctx.req);
  requireCap(caller, 'settings.read');
  parseUuidParam(ctx.params.id);
  await assertCardInOrg(caller.orgId, ctx.params.id);
  const { data, error } = await admin()
    .from('rate_card_lines').select('*')
    .eq('rate_card_id', ctx.params.id).eq('org_id', caller.orgId)
    .order('position', { ascending: true });
  if (error) throw internalError(BUNDLE, error);
  return ok(data ?? []);
};

const addLine = async (ctx: RouteCtx) => {
  const caller = requireCaller(ctx.req);
  requireCap(caller, 'settings.write');
  parseUuidParam(ctx.params.id);
  const body = await parseBody(ctx.req, RateCardLineCreateSchema);
  return respondWithIdempotency(
    ctx.req, caller, BUNDLE, '/rate-cards/:id/lines', body,
    async () => {
      await assertCardInOrg(caller.orgId, ctx.params.id);
      const { data, error } = await admin()
        .from('rate_card_lines')
        .insert({
          rate_card_id: ctx.params.id,
          org_id: caller.orgId,
          code: body.code,
          group_key: body.group_key,
          label: body.label,
          rate_micros: body.rate_micros,
          uom: body.uom ?? null,
          position: body.position ?? 0,
          created_by: caller.userId,
          updated_by: caller.userId,
        })
        .select('*').maybeSingle();
      if (error) {
        // rate_card_lines is UNIQUE (rate_card_id, code): a duplicate code is a
        // conflict the operator must resolve, not an internal fault.
        if ((error as { code?: string }).code === '23505') {
          throw new ApiError('STATE_CONFLICT', 409, `a line with code "${body.code}" already exists on this card`);
        }
        throw internalError(BUNDLE, error);
      }
      return created(data);
    },
  );
};

const patchLine = async (ctx: RouteCtx) => {
  const caller = requireCaller(ctx.req);
  requireCap(caller, 'settings.write');
  parseUuidParam(ctx.params.id);
  parseUuidParam(ctx.params.lineId, 'lineId');
  const body = await parseBody(ctx.req, RateCardLinePatchSchema);
  return respondWithIdempotency(
    ctx.req, caller, BUNDLE, '/rate-cards/:id/lines/:lineId', body,
    async () => {
      await assertCardInOrg(caller.orgId, ctx.params.id);
      const patch: Record<string, unknown> = {
        updated_by: caller.userId,
        updated_at: new Date().toISOString(),
      };
      for (const k of ['code', 'group_key', 'label', 'rate_micros', 'uom', 'position'] as const) {
        if (body[k] !== undefined) patch[k] = body[k];
      }
      const { data, error } = await admin()
        .from('rate_card_lines').update(patch)
        .eq('id', ctx.params.lineId)
        .eq('rate_card_id', ctx.params.id)
        .eq('org_id', caller.orgId)
        .select('*').maybeSingle();
      if (error) {
        if ((error as { code?: string }).code === '23505') {
          throw new ApiError('STATE_CONFLICT', 409, 'another line on this card already uses that code');
        }
        throw internalError(BUNDLE, error);
      }
      if (!data) throw new ApiError('NOT_FOUND', 404);
      return ok(data);
    },
  );
};

const removeLine = async (ctx: RouteCtx) => {
  const caller = requireCaller(ctx.req);
  requireCap(caller, 'settings.write');
  parseUuidParam(ctx.params.id);
  parseUuidParam(ctx.params.lineId, 'lineId');
  return respondWithIdempotency(
    ctx.req, caller, BUNDLE, '/rate-cards/:id/lines/:lineId-delete', null,
    async () => {
      await assertCardInOrg(caller.orgId, ctx.params.id);
      const { error } = await admin()
        .from('rate_card_lines').delete()
        .eq('id', ctx.params.lineId)
        .eq('rate_card_id', ctx.params.id)
        .eq('org_id', caller.orgId);
      if (error) throw internalError(BUNDLE, error);
      return ok({ id: ctx.params.lineId, deleted: true });
    },
  );
};

const ROUTES: Route[] = [
  { method: 'GET',    path: '/rate-cards',                       handler: listCards },
  { method: 'GET',    path: '/rate-cards/:id',                   handler: getCard },
  { method: 'POST',   path: '/rate-cards',                       handler: createCard },
  { method: 'PATCH',  path: '/rate-cards/:id',                   handler: patchCard },
  { method: 'DELETE', path: '/rate-cards/:id',                   handler: deleteCard },
  { method: 'GET',    path: '/rate-cards/:id/lines',             handler: listLines },
  { method: 'POST',   path: '/rate-cards/:id/lines',             handler: addLine },
  { method: 'PATCH',  path: '/rate-cards/:id/lines/:lineId',     handler: patchLine },
  { method: 'DELETE', path: '/rate-cards/:id/lines/:lineId',     handler: removeLine },
];

Deno.serve((req) => route(req, ROUTES, { bundle: BUNDLE }));

export {
  listCards, getCard, createCard, patchCard, deleteCard,
  listLines, addLine, patchLine, removeLine,
};
