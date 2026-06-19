// three-pl-api supply-plans handlers. supply_plans (parent; FSM draft /
// released / fulfilled / cancelled; release / cancel / fulfill are RPCs that
// emit reserve / reserve_release spine movements) plus supply_plan_lines
// (child; per-item demand resolution). Handler bodies moved verbatim from the
// former monolithic index.ts during the R-W13-DX-01 structural split; no
// behaviour change.

import type { RouteCtx } from '../../_shared/route.ts';
import { ApiError, ok, internalError } from '../../_shared/responses.ts';
import {
  admin, parseBody, parseLimit, parseUuidParam, respondWithIdempotency, created, requireCap,
} from '../../_shared/handler-helpers.ts';
import {
  parseSearch, parseSort, decodeSortCursor, buildSearchOr, buildKeysetOr,
  paginateSorted, type SortSpec,
} from '../../_shared/list-query.ts';
import { requireCaller } from '../../_shared/tenant.ts';
import { assertRefInOrg } from '../../_shared/crud.ts';
import { nextDocNumber } from '../../_shared/numbering.ts';
import {
  SupplyPlanSchema,
  SupplyPlanCreateSchema,
  SupplyPlanPatchSchema,
  SupplyPlanLineSchema,
  SupplyPlanLineCreateSchema,
  SupplyPlanLineUpdateSchema,
} from '../../_shared/types/threepl.ts';
import {
  BUNDLE, nowIso, loadSupplyPlan, assertSupplyPlanParent, nextSupplyPlanLinePosition,
} from './_helpers.ts';

// Workstream C (UI scan) server list toolbar allowlists. plan_number is nullable
// (migration 0096: org-scoped, nullable, unique only where present) so it is a
// SEARCH column only, never a sort. SORT_COLS are NOT NULL only (created_at,
// status), so the keyset cursor never straddles a null. DEFAULT_SORT keeps the
// legacy created_at desc ordering when no sort param is sent.
const SUPPLY_PLAN_SEARCH_COLS = ['plan_number'] as const;
const SUPPLY_PLAN_SORT_COLS = ['created_at', 'status'] as const;
const SUPPLY_PLAN_DEFAULT_SORT: SortSpec = { column: 'created_at', dir: 'desc' };

export async function listSupplyPlans({ req, url }: RouteCtx): Promise<Response> {
  const caller = requireCaller(req);
  const limit = parseLimit(url);
  const sort = parseSort(url, SUPPLY_PLAN_SORT_COLS, SUPPLY_PLAN_DEFAULT_SORT);
  const search = parseSearch(url);
  const cursor = decodeSortCursor(url.searchParams.get('cursor'));
  const status = url.searchParams.get('status');
  const projectId = url.searchParams.get('project_id');
  let q = admin()
    .from('supply_plans').select('*')
    .eq('org_id', caller.orgId).is('deleted_at', null);
  if (status) q = q.eq('status', status);
  if (projectId) q = q.eq('project_id', projectId);
  if (search) q = q.or(buildSearchOr(SUPPLY_PLAN_SEARCH_COLS, search));
  q = q
    .order(sort.column, { ascending: sort.dir === 'asc' })
    .order('id', { ascending: sort.dir === 'asc' })
    .limit(limit + 1);
  if (cursor) q = q.or(buildKeysetOr(sort, cursor));
  const { data, error } = await q;
  if (error) throw internalError(BUNDLE, error);
  const rows = (data ?? []).map((r) => SupplyPlanSchema.parse(r)) as Array<
    ReturnType<typeof SupplyPlanSchema.parse> & { id: string }
  >;
  return ok(paginateSorted(rows, limit, sort.column));
}

export async function createSupplyPlan({ req }: RouteCtx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'threepl.supply_plan.create');
  const body = await parseBody(req, SupplyPlanCreateSchema);
  return respondWithIdempotency(req, caller, BUNDLE, '/supply-plans', body, async () => {
    // project_id and warehouse_id are optional spine refs; a cross-tenant or
    // missing ref resolves to NOT_FOUND 404 (never copied).
    if (body.project_id) { await assertRefInOrg('projects', caller, body.project_id); }
    if (body.warehouse_id) { await assertRefInOrg('warehouses', caller, body.warehouse_id); }
    if (body.job_run_id) { await assertRefInOrg('job_runs', caller, body.job_run_id); }
    const planNumber = body.plan_number?.trim()
      ? body.plan_number.trim()
      : await nextDocNumber(caller.orgId, 'supply_plan');
    const insert: Record<string, unknown> = {
      org_id: caller.orgId,
      plan_number: planNumber,
      project_id: body.project_id ?? null,
      warehouse_id: body.warehouse_id ?? null,
      job_run_id: body.job_run_id ?? null,
      status: 'draft',
      notes: body.notes ?? null,
      payload: body.payload ?? {},
      created_by: caller.userId,
      updated_by: caller.userId,
    };
    const { data, error } = await admin().from('supply_plans')
      .insert(insert).select('*').single();
    if (error) throw internalError(BUNDLE, error);
    return created(SupplyPlanSchema.parse(data));
  });
}

export async function getSupplyPlan({ req, params }: RouteCtx): Promise<Response> {
  const caller = requireCaller(req);
  parseUuidParam(params.id);
  const row = await loadSupplyPlan(caller, params.id);
  return ok(row);
}

export async function patchSupplyPlan({ req, params }: RouteCtx): Promise<Response> {
  const caller = requireCaller(req);
  // No dedicated supply_plan.update cap; header edits reuse the create cap
  // (same role gate), matching the job-templates delete precedent. Status
  // moves via the release / cancel routes, not here.
  requireCap(caller, 'threepl.supply_plan.create');
  parseUuidParam(params.id);
  const body = await parseBody(req, SupplyPlanPatchSchema);
  return respondWithIdempotency(req, caller, BUNDLE, '/supply-plans/:id', body, async () => {
    await assertSupplyPlanParent(caller, params.id);
    if (body.project_id) { await assertRefInOrg('projects', caller, body.project_id); }
    if (body.warehouse_id) { await assertRefInOrg('warehouses', caller, body.warehouse_id); }
    if (body.job_run_id) { await assertRefInOrg('job_runs', caller, body.job_run_id); }
    const patch: Record<string, unknown> = {
      updated_by: caller.userId,
      updated_at: nowIso(),
    };
    if (body.project_id !== undefined) patch.project_id = body.project_id;
    if (body.warehouse_id !== undefined) patch.warehouse_id = body.warehouse_id;
    if (body.job_run_id !== undefined) patch.job_run_id = body.job_run_id;
    if (body.plan_number !== undefined) patch.plan_number = body.plan_number;
    if (body.notes !== undefined) patch.notes = body.notes;
    if (body.payload !== undefined) patch.payload = body.payload;
    const { data, error } = await admin().from('supply_plans')
      .update(patch)
      .eq('org_id', caller.orgId).eq('id', params.id).is('deleted_at', null)
      .select('*').maybeSingle();
    if (error) throw internalError(BUNDLE, error);
    if (!data) throw new ApiError('NOT_FOUND', 404);
    return ok(SupplyPlanSchema.parse(data));
  });
}

export async function deleteSupplyPlan({ req, params }: RouteCtx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'threepl.supply_plan.create');
  parseUuidParam(params.id);
  return respondWithIdempotency(req, caller, BUNDLE, '/supply-plans/:id-delete', null, async () => {
    await assertSupplyPlanParent(caller, params.id);
    const { data, error } = await admin().from('supply_plans')
      .update({ deleted_at: nowIso(), updated_by: caller.userId, updated_at: nowIso() })
      .eq('org_id', caller.orgId).eq('id', params.id).is('deleted_at', null)
      .select('id').maybeSingle();
    if (error) throw internalError(BUNDLE, error);
    if (!data) throw new ApiError('NOT_FOUND', 404);
    return ok({ id: params.id, deleted: true });
  });
}

export async function releaseSupplyPlan({ req, params }: RouteCtx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'threepl.supply_plan.release');
  parseUuidParam(params.id);
  return respondWithIdempotency(req, caller, BUNDLE, '/supply-plans/:id/release', null, async () => {
    // release_supply_plan is SECURITY DEFINER and takes the caller org as an
    // explicit param: a missing or cross-tenant plan surfaces as NOT_FOUND
    // (404, never 403); a non-draft plan as STATE_CONFLICT (409); no
    // warehouse as VALIDATION_ERROR.
    const { error } = await admin().rpc('release_supply_plan', {
      p_plan_id: params.id,
      p_actor: caller.userId,
      p_caller_org_id: caller.orgId,
    });
    if (error) {
      if (/NOT_FOUND/.test(error.message)) throw new ApiError('NOT_FOUND', 404);
      if (/STATE_CONFLICT/.test(error.message)) throw new ApiError('STATE_CONFLICT', 409, error.message);
      if (/VALIDATION_ERROR/.test(error.message)) throw new ApiError('VALIDATION_ERROR', 422, error.message);
      throw internalError(BUNDLE, error);
    }
    const row = await loadSupplyPlan(caller, params.id);
    return ok(row);
  });
}

export async function cancelSupplyPlan({ req, params }: RouteCtx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'threepl.supply_plan.cancel');
  parseUuidParam(params.id);
  return respondWithIdempotency(req, caller, BUNDLE, '/supply-plans/:id/cancel', null, async () => {
    const { error } = await admin().rpc('cancel_supply_plan', {
      p_plan_id: params.id,
      p_actor: caller.userId,
      p_caller_org_id: caller.orgId,
    });
    if (error) {
      if (/NOT_FOUND/.test(error.message)) throw new ApiError('NOT_FOUND', 404);
      throw internalError(BUNDLE, error);
    }
    const row = await loadSupplyPlan(caller, params.id);
    return ok(row);
  });
}

export async function fulfillSupplyPlan({ req, params }: RouteCtx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'threepl.supply_plan.fulfill');
  parseUuidParam(params.id);
  return respondWithIdempotency(req, caller, BUNDLE, '/supply-plans/:id/fulfill', null, async () => {
    // fulfill_supply_plan (A6) releases the remaining holds and ends in
    // fulfilled. NOT_FOUND (404) cross-tenant / missing; STATE_CONFLICT (409)
    // when not released.
    const { error } = await admin().rpc('fulfill_supply_plan', {
      p_plan_id: params.id,
      p_actor: caller.userId,
      p_caller_org_id: caller.orgId,
    });
    if (error) {
      if (/NOT_FOUND/.test(error.message)) throw new ApiError('NOT_FOUND', 404);
      if (/STATE_CONFLICT/.test(error.message)) throw new ApiError('STATE_CONFLICT', 409, error.message);
      throw internalError(BUNDLE, error);
    }
    const row = await loadSupplyPlan(caller, params.id);
    return ok(row);
  });
}

// ---------------------------------------------------------------------------
// supply_plan_lines (child; per-item demand resolution)
// ---------------------------------------------------------------------------

export async function listSupplyPlanLines({ req, params }: RouteCtx): Promise<Response> {
  const caller = requireCaller(req);
  parseUuidParam(params.id);
  await assertSupplyPlanParent(caller, params.id);
  const { data, error } = await admin()
    .from('supply_plan_lines').select('*')
    .eq('org_id', caller.orgId)
    .eq('supply_plan_id', params.id)
    .order('position', { ascending: true });
  if (error) throw internalError(BUNDLE, error);
  return ok((data ?? []).map((r) => SupplyPlanLineSchema.parse(r)));
}

export async function createSupplyPlanLine({ req, params }: RouteCtx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'threepl.supply_plan.line.create');
  parseUuidParam(params.id);
  const body = await parseBody(req, SupplyPlanLineCreateSchema);
  return respondWithIdempotency(
    req, caller, BUNDLE, '/supply-plans/:id/lines', body,
    async () => {
      await assertSupplyPlanParent(caller, params.id);
      await assertRefInOrg('items', caller, body.item_id);
      if (body.resolved_po_id) { await assertRefInOrg('purchase_orders', caller, body.resolved_po_id); }
      if (body.resolved_receiving_order_id) { await assertRefInOrg('receiving_orders', caller, body.resolved_receiving_order_id); }
      const position = body.position ?? await nextSupplyPlanLinePosition(caller, params.id);
      const insert = {
        org_id: caller.orgId,
        supply_plan_id: params.id,
        item_id: body.item_id,
        required_qty: body.required_qty ?? 0,
        resolution: body.resolution ?? 'reserve',
        resolved_po_id: body.resolved_po_id ?? null,
        resolved_receiving_order_id: body.resolved_receiving_order_id ?? null,
        notes: body.notes ?? null,
        position,
        created_by: caller.userId,
        updated_by: caller.userId,
      };
      const { data, error } = await admin()
        .from('supply_plan_lines').insert(insert)
        .select('*').single();
      if (error) throw internalError(BUNDLE, error);
      return created(SupplyPlanLineSchema.parse(data));
    },
  );
}

export async function patchSupplyPlanLine({ req, params }: RouteCtx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'threepl.supply_plan.line.update');
  parseUuidParam(params.id);
  parseUuidParam(params.lid, 'lid');
  const body = await parseBody(req, SupplyPlanLineUpdateSchema);
  return respondWithIdempotency(
    req, caller, BUNDLE, '/supply-plans/:id/lines/:lid', body,
    async () => {
      await assertSupplyPlanParent(caller, params.id);
      if (body.item_id) { await assertRefInOrg('items', caller, body.item_id); }
      if (body.resolved_po_id) { await assertRefInOrg('purchase_orders', caller, body.resolved_po_id); }
      if (body.resolved_receiving_order_id) { await assertRefInOrg('receiving_orders', caller, body.resolved_receiving_order_id); }
      const patch: Record<string, unknown> = { updated_by: caller.userId };
      if (body.item_id !== undefined) patch.item_id = body.item_id;
      if (body.required_qty !== undefined) patch.required_qty = body.required_qty;
      if (body.resolution !== undefined) patch.resolution = body.resolution;
      if (body.resolved_po_id !== undefined) patch.resolved_po_id = body.resolved_po_id;
      if (body.resolved_receiving_order_id !== undefined) patch.resolved_receiving_order_id = body.resolved_receiving_order_id;
      if (body.notes !== undefined) patch.notes = body.notes;
      if (body.position !== undefined) patch.position = body.position;
      const { data, error } = await admin()
        .from('supply_plan_lines')
        .update(patch)
        .eq('org_id', caller.orgId)
        .eq('supply_plan_id', params.id)
        .eq('id', params.lid)
        .select('*').maybeSingle();
      if (error) throw internalError(BUNDLE, error);
      if (!data) throw new ApiError('NOT_FOUND', 404);
      return ok(SupplyPlanLineSchema.parse(data));
    },
  );
}

export async function deleteSupplyPlanLine({ req, params }: RouteCtx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'threepl.supply_plan.line.delete');
  parseUuidParam(params.id);
  parseUuidParam(params.lid, 'lid');
  return respondWithIdempotency(
    req, caller, BUNDLE, '/supply-plans/:id/lines/:lid-delete', null,
    async () => {
      await assertSupplyPlanParent(caller, params.id);
      const { data, error } = await admin()
        .from('supply_plan_lines').delete()
        .eq('org_id', caller.orgId)
        .eq('supply_plan_id', params.id)
        .eq('id', params.lid)
        .select('id').maybeSingle();
      if (error) throw internalError(BUNDLE, error);
      if (!data) throw new ApiError('NOT_FOUND', 404);
      return ok({ id: params.lid, deleted: true });
    },
  );
}
