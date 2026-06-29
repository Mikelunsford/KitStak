// three-pl-api build-from-quote orchestration (ADR 0006 P2b-2). Turns an
// approved quote into a buildable job by reusing the existing 3PL chain and the
// run-scoped build artifacts (migration 0145). No new migration: every write is
// a plain entity create on a Pattern A table that already carries its 0096 auto
// state-transition / audit trigger, so the audit chassis records the build.
//
// Steps (each guarded so a re-run never duplicates):
//   1. convert_quote_to_project RPC  -> project_id. The approved-state guard and
//      the cross-tenant (NOT_FOUND 404) gate live IN the RPC (migration 0136),
//      so this endpoint inherits "the quote must be approved" for free; it also
//      freezes job_template_snapshot + source_job_template_id onto the project.
//   2. a DRAFT supply_plan from the project materials + org default warehouse
//      (ported from quotes-api autoCreateDraftSupplyPlan; skips if one exists).
//   3. a job_run against the project, inheriting the project's frozen
//      job_template_snapshot, status 'planned' (reuses the project's run if one
//      is already present, so the build stays idempotent).
//   4. (operator decision, default on) a DRAFT receiving_order exploded from the
//      job BOM: each project line item's bom_items components, required qty =
//      quantity_per * line quantity, aggregated by component. receiving_orders
//      .warehouse_id is NOT NULL, so this is skipped when the org has no default
//      warehouse (returns null); also skipped when the BOM resolves to nothing.
//   5. a draft job_run_jacket + a job_run_timeline (mabd from project.due_date)
//      so the run lands GATED: the P2b-1 start-gate blocks start_job_run until
//      the jacket is approved, and the operator has a timeline to fill in.
//
// Capability: threepl.job_run.create (the dominant action is creating a
// buildable job in this bundle; the convert RPC self-enforces approved-state and
// org scope). No capabilities-canon change. The alternative gate would be
// quotes.convert_to_project; job_run.create is chosen because the endpoint lives
// in the plugins.three_pl bundle and produces a job. Idempotency-keyed; the
// source quote id rides the idempotency body so one key can not be reused across
// different quotes.

import type { RouteCtx } from '../../_shared/route.ts';
import { ApiError, ok, internalError } from '../../_shared/responses.ts';
import {
  admin, parseBody, parseUuidParam, respondWithIdempotency, requireCap,
} from '../../_shared/handler-helpers.ts';
import { requireCaller, type Caller } from '../../_shared/tenant.ts';
import { nextDocNumber } from '../../_shared/numbering.ts';
import { BuildJobFromQuoteRequestSchema } from '../../_shared/types/jobbuilder.ts';
import { BUNDLE } from './_helpers.ts';
import { loadJacketRow } from './job_artifacts.ts';

// The just-converted project's build-relevant fields, read once and threaded
// into the job_run (snapshot inheritance) and the timeline (mabd seed).
interface BuildProject {
  job_template_snapshot: Record<string, unknown> | null;
  source_job_template_id: string | null;
  due_date: string | null;
}

async function loadBuildProject(caller: Caller, projectId: string): Promise<BuildProject> {
  const { data, error } = await admin().from('projects')
    .select('job_template_snapshot, source_job_template_id, due_date')
    .eq('org_id', caller.orgId).eq('id', projectId).maybeSingle();
  if (error) throw internalError(BUNDLE, error);
  if (!data) throw new ApiError('NOT_FOUND', 404);
  return {
    job_template_snapshot: (data.job_template_snapshot as Record<string, unknown> | null) ?? null,
    source_job_template_id: (data.source_job_template_id as string | null) ?? null,
    due_date: (data.due_date as string | null) ?? null,
  };
}

// DRAFT supply plan from the project materials + org default warehouse. Ported
// from quotes-api autoCreateDraftSupplyPlan; returns the existing plan id when
// one is already present (retry safety) or the new id. Org-scoped throughout.
async function ensureDraftSupplyPlan(caller: Caller, projectId: string): Promise<string | null> {
  const client = admin();
  const { data: existing, error: existErr } = await client
    .from('supply_plans').select('id')
    .eq('org_id', caller.orgId).eq('project_id', projectId).is('deleted_at', null)
    .limit(1).maybeSingle();
  if (existErr) throw internalError(BUNDLE, existErr);
  if (existing) return (existing.id as string);

  const warehouseId = await orgDefaultWarehouse(caller);
  const { data: lineItems, error: liErr } = await client
    .from('project_line_items').select('item_id, quantity, position')
    .eq('org_id', caller.orgId).eq('project_id', projectId)
    .order('position', { ascending: true });
  if (liErr) throw internalError(BUNDLE, liErr);
  const materials = (lineItems ?? []).filter(
    (r) => (r as { item_id: string | null }).item_id !== null,
  );

  const planNumber = await nextDocNumber(caller.orgId, 'supply_plan');
  const { data: plan, error: planErr } = await client.from('supply_plans')
    .insert({
      org_id: caller.orgId, plan_number: planNumber, project_id: projectId,
      warehouse_id: warehouseId, status: 'draft',
      created_by: caller.userId, updated_by: caller.userId,
    })
    .select('id').single();
  if (planErr) throw internalError(BUNDLE, planErr);
  const planId = (plan as { id: string }).id;

  for (let i = 0; i < materials.length; i++) {
    const m = materials[i] as { item_id: string; quantity: number | null };
    const { error: lineErr } = await client.from('supply_plan_lines').insert({
      org_id: caller.orgId, supply_plan_id: planId, item_id: m.item_id,
      required_qty: m.quantity ?? 0, resolution: 'reserve', position: i,
      created_by: caller.userId, updated_by: caller.userId,
    });
    if (lineErr) throw internalError(BUNDLE, lineErr);
  }
  return planId;
}

// The org default warehouse id (0030 is_default flag), or null.
async function orgDefaultWarehouse(caller: Caller): Promise<string | null> {
  const { data, error } = await admin().from('warehouses').select('id')
    .eq('org_id', caller.orgId).eq('is_default', true).limit(1).maybeSingle();
  if (error) throw internalError(BUNDLE, error);
  return (data?.id as string | undefined) ?? null;
}

// A job_run for the project: reuse the project's existing run when present (so a
// re-run never mints a duplicate), else create one inheriting the project's
// frozen job_template_snapshot (createJobRun pattern), status 'planned'.
async function ensureJobRun(caller: Caller, projectId: string, proj: BuildProject): Promise<string> {
  const client = admin();
  const { data: existing, error: existErr } = await client.from('job_runs').select('id')
    .eq('org_id', caller.orgId).eq('project_id', projectId).is('deleted_at', null)
    .order('created_at', { ascending: true }).limit(1).maybeSingle();
  if (existErr) throw internalError(BUNDLE, existErr);
  if (existing) return (existing.id as string);

  const runNumber = await nextDocNumber(caller.orgId, 'job_run');
  const { data, error } = await client.from('job_runs').insert({
    org_id: caller.orgId, run_number: runNumber, project_id: projectId,
    job_template_id: proj.source_job_template_id,
    job_template_snapshot: proj.job_template_snapshot,
    status: 'planned', payload: {},
    created_by: caller.userId, updated_by: caller.userId,
  }).select('id').single();
  if (error) throw internalError(BUNDLE, error);
  return ((data as { id: string }).id);
}

// DRAFT receiving order exploded from the job BOM. Returns the existing RO id
// when one is already linked to the project (retry safety), null when the org
// has no default warehouse (warehouse_id is NOT NULL) or the BOM resolves to no
// components. status 'created' is the initial / draft state of receiving_orders.
async function ensureDraftReceivingOrder(caller: Caller, projectId: string): Promise<string | null> {
  const client = admin();
  const { data: existing, error: existErr } = await client.from('receiving_orders').select('id')
    .eq('org_id', caller.orgId).eq('project_id', projectId).is('deleted_at', null)
    .limit(1).maybeSingle();
  if (existErr) throw internalError(BUNDLE, existErr);
  if (existing) return (existing.id as string);

  const warehouseId = await orgDefaultWarehouse(caller);
  if (!warehouseId) return null;

  const components = await explodeProjectBom(caller, projectId);
  if (components.length === 0) return null;

  const receivingNumber = await nextDocNumber(caller.orgId, 'receiving_order');
  const { data: ro, error: roErr } = await client.from('receiving_orders').insert({
    org_id: caller.orgId, receiving_number: receivingNumber, warehouse_id: warehouseId,
    project_id: projectId, status: 'created', payload: {},
    created_by: caller.userId, updated_by: caller.userId,
  }).select('id').single();
  if (roErr) throw internalError(BUNDLE, roErr);
  const roId = (ro as { id: string }).id;

  for (let i = 0; i < components.length; i++) {
    const c = components[i] as BomComponent;
    const { error: lineErr } = await client.from('receiving_order_line_items').insert({
      org_id: caller.orgId, receiving_order_id: roId, item_id: c.item_id,
      quantity: c.required_qty, uom: c.uom, position: i,
      created_by: caller.userId, updated_by: caller.userId,
    });
    if (lineErr) throw internalError(BUNDLE, lineErr);
  }
  return roId;
}

interface BomComponent { item_id: string; required_qty: number; uom: string | null }

// Explode the project's line-item items through bom_items into aggregated
// component demand: required qty = quantity_per * line quantity, summed across
// every parent line that consumes the same component. Free-text project lines
// (no item_id) contribute nothing. Ordered by component id for a stable RO.
async function explodeProjectBom(caller: Caller, projectId: string): Promise<BomComponent[]> {
  const client = admin();
  const { data: lines, error: liErr } = await client.from('project_line_items')
    .select('item_id, quantity').eq('org_id', caller.orgId).eq('project_id', projectId);
  if (liErr) throw internalError(BUNDLE, liErr);
  const parents = (lines ?? []).filter((r) => (r as { item_id: string | null }).item_id !== null);

  const totals = new Map<string, { qty: number; uom: string | null }>();
  for (const p of parents) {
    const line = p as { item_id: string; quantity: number | null };
    const lineQty = line.quantity ?? 0;
    const { data: bom, error: bomErr } = await client.from('bom_items')
      .select('component_item_id, quantity_per, unit_of_measure')
      .eq('org_id', caller.orgId).eq('parent_item_id', line.item_id);
    if (bomErr) throw internalError(BUNDLE, bomErr);
    for (const row of bom ?? []) {
      const b = row as { component_item_id: string; quantity_per: number | null; unit_of_measure: string | null };
      const add = Number(b.quantity_per ?? 0) * Number(lineQty);
      const prev = totals.get(b.component_item_id);
      if (prev) prev.qty += add;
      else totals.set(b.component_item_id, { qty: add, uom: b.unit_of_measure ?? null });
    }
  }
  return [...totals.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([item_id, v]) => ({ item_id, required_qty: v.qty, uom: v.uom }));
}

// Seed a draft jacket (idempotent) so the run lands gated, and a timeline row
// (idempotent) carrying the project due date as the must-arrive-by date. Neither
// clobbers an existing artifact, so a re-run preserves operator edits.
async function ensureDraftJacket(caller: Caller, runId: string): Promise<void> {
  if (await loadJacketRow(caller.orgId, runId)) return;
  const { error } = await admin().from('job_run_jacket').insert({
    org_id: caller.orgId, job_run_id: runId, status: 'draft',
    created_by: caller.userId, updated_by: caller.userId,
  });
  if (error) throw internalError(BUNDLE, error);
}

async function ensureTimeline(caller: Caller, runId: string, mabd: string | null): Promise<void> {
  const { data: existing, error: selErr } = await admin().from('job_run_timeline')
    .select('id').eq('org_id', caller.orgId).eq('job_run_id', runId).maybeSingle();
  if (selErr) throw internalError(BUNDLE, selErr);
  if (existing) return;
  const { error } = await admin().from('job_run_timeline').insert({
    org_id: caller.orgId, job_run_id: runId, mabd,
    created_by: caller.userId, updated_by: caller.userId,
  });
  if (error) throw internalError(BUNDLE, error);
}

export async function buildJobFromQuote(ctx: RouteCtx): Promise<Response> {
  const caller = requireCaller(ctx.req);
  requireCap(caller, 'threepl.job_run.create');
  parseUuidParam(ctx.params.quoteId, 'quoteId');
  const body = await parseBody(ctx.req, BuildJobFromQuoteRequestSchema);
  return respondWithIdempotency(
    ctx.req, caller, BUNDLE, '/build-from-quote/:quoteId',
    { ...body, source_quote_id: ctx.params.quoteId },
    async () => {
      // 1. convert. The RPC owns the approved-state guard and the cross-tenant
      // NOT_FOUND boundary; a missing / non-approved quote surfaces here.
      const { data, error } = await admin().rpc('convert_quote_to_project', {
        p_quote_id: ctx.params.quoteId,
        p_actor: caller.userId,
        p_caller_org_id: caller.orgId,
        p_project_number: body.project_number ?? null,
        p_tier_id: body.tier_id ?? null,
      });
      if (error) {
        if (/NOT_FOUND/.test(error.message)) throw new ApiError('NOT_FOUND', 404);
        if (/STATE_CONFLICT/.test(error.message)) {
          throw new ApiError('STATE_CONFLICT', 409, error.message);
        }
        throw internalError(BUNDLE, error);
      }
      const projectId = data as string;
      const proj = await loadBuildProject(caller, projectId);

      // 2-3. supply plan + job run.
      const supplyPlanId = await ensureDraftSupplyPlan(caller, projectId);
      const jobRunId = await ensureJobRun(caller, projectId, proj);

      // 4. receiving order from the BOM (operator decision; default on).
      const wantRo = body.create_receiving_order ?? true;
      const receivingOrderId = wantRo
        ? await ensureDraftReceivingOrder(caller, projectId)
        : null;

      // 5. gate the run: draft jacket + timeline seeded from the project due date.
      await ensureDraftJacket(caller, jobRunId);
      await ensureTimeline(caller, jobRunId, proj.due_date);

      return ok({
        project_id: projectId,
        job_run_id: jobRunId,
        supply_plan_id: supplyPlanId,
        receiving_order_id: receivingOrderId,
      });
    },
  );
}
