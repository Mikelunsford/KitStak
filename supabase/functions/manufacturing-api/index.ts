// manufacturing-api bundle.
//
// Pillar 2 (Manufacturing) HTTP surface. Path A3 of the Manufacturing wiring
// plan (operator-approved 2026-05-20). Sibling bundle to ops-api; deliberately
// separate from the Pillar 1 production_runs flow per Decision-C.
//
// BUNDLE GATE: plugins.manufacturing. Constitutional rule (AUDIT.md / 00-canon):
//   Bundle gate off  -> every route returns 404 NOT_FOUND envelope.
//   Per-route flag   -> 403 FEATURE_DISABLED with details.flag. (Not used here.)
//
// The gate fires BEFORE the route table so even a caller hitting an unknown
// path gets 404. Callers without an org claim land in the standard
// UNAUTHORIZED / NO_ACTIVE_ORG envelopes; we only reach the flag read once
// the caller resolves.
//
// State machine (handler-enforced, mirrors the manufacturing_runs CHECK from
// migration 0052 and the audit-trigger guard from the same migration):
//   draft     -> started
//   started   -> completed   (DB trigger tg_manufacturing_runs_emit_movements
//                             from migration 0053 writes stock_movements when
//                             warehouse_id is non-null; null warehouse_id is
//                             an admin-only run and the trigger early-returns)
//   draft     -> cancelled
//   started   -> cancelled
//   completed -> ANY         -> illegal (terminal)
// Invalid transitions are rejected with STATE_CONFLICT 409 BEFORE the DB
// call so the operator never sees a 500-class error bubble out of the
// status CHECK constraint. Matches the ops-api FSM-violation precedent
// (see assertTransition in supabase/functions/ops-api/index.ts).
//
// Routes (when plugins.manufacturing is enabled for the caller's org):
//   GET    /manufacturing-runs                           list (RLS-only)
//   POST   /manufacturing-runs                           create
//   GET    /manufacturing-runs/:id                       read (RLS-only)
//   PATCH  /manufacturing-runs/:id                       update (draft only)
//   DELETE /manufacturing-runs/:id                       soft-delete
//   POST   /manufacturing-runs/:id/start                 draft -> started
//   POST   /manufacturing-runs/:id/complete              started -> completed
//   POST   /manufacturing-runs/:id/cancel                draft|started -> cancelled
//   GET    /manufacturing-runs/:id/consumed              list consumed lines
//   POST   /manufacturing-runs/:id/consumed              add consumed line
//   PATCH  /manufacturing-runs/:id/consumed/:lineId      update
//   DELETE /manufacturing-runs/:id/consumed/:lineId      delete
//   GET    /manufacturing-runs/:id/produced              list produced lines
//   POST   /manufacturing-runs/:id/produced              add produced line
//   PATCH  /manufacturing-runs/:id/produced/:lineId      update
//   DELETE /manufacturing-runs/:id/produced/:lineId      delete

import { route, type Route } from '../_shared/route.ts';
import { ApiError, ok, fromApiError } from '../_shared/responses.ts';
import {
  admin, parseBody, parseUuidParam, respondWithIdempotency, created, requireCap,
} from '../_shared/handler-helpers.ts';
import { readCallerContext, requireCaller, type Caller } from '../_shared/tenant.ts';
import { getFlag } from '../_shared/feature-flags.ts';
import { nextDocNumber } from '../_shared/numbering.ts';
import { ERROR_CODES, FEATURE_FLAGS } from '../_shared/constants.ts';
import {
  ManufacturingRunSchema,
  ManufacturingRunCreateSchema,
  ManufacturingRunPatchSchema,
  ManufacturingRunConsumedLineItemSchema,
  ManufacturingRunConsumedLineItemCreateSchema,
  ManufacturingRunConsumedLineItemUpdateSchema,
  ManufacturingRunProducedLineItemSchema,
  ManufacturingRunProducedLineItemCreateSchema,
  ManufacturingRunProducedLineItemUpdateSchema,
  type ManufacturingRun,
  type ManufacturingRunStatus,
} from '../_shared/types/vendors_inventory_ops.ts';

const BUNDLE = 'manufacturing-api';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function loadRun(caller: Caller, id: string): Promise<ManufacturingRun> {
  const { data, error } = await admin()
    .from('manufacturing_runs').select('*')
    .eq('org_id', caller.orgId).eq('id', id).is('deleted_at', null)
    .maybeSingle();
  if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
  if (!data) throw new ApiError('NOT_FOUND', 404);
  return ManufacturingRunSchema.parse(data);
}

// Pattern A parent-existence probe. Cross-tenant or soft-deleted parents
// resolve to NOT_FOUND 404, matching the ops-api line-item precedent.
async function assertRunParent(caller: Caller, id: string): Promise<void> {
  const { data, error } = await admin().from('manufacturing_runs').select('id')
    .eq('org_id', caller.orgId).eq('id', id).is('deleted_at', null).maybeSingle();
  if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
  if (!data) throw new ApiError('NOT_FOUND', 404);
}

async function nextLinePosition(
  table: 'manufacturing_run_consumed_line_items' | 'manufacturing_run_produced_line_items',
  caller: Caller, runId: string,
): Promise<number> {
  const { data, error } = await admin().from(table)
    .select('position')
    .eq('org_id', caller.orgId)
    .eq('manufacturing_run_id', runId)
    .order('position', { ascending: false }).limit(1).maybeSingle();
  if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
  return ((data?.position as number | undefined) ?? -1) + 1;
}

// State-machine guard. Rejects illegal transitions BEFORE the DB call with
// STATE_CONFLICT 409 (the canonical FSM-violation envelope per
// _shared/constants.ts ERROR_CODES; ops-api uses the same code for the same
// class of bug — see assertTransition in supabase/functions/ops-api/index.ts).
function assertManufacturingTransition(
  from: ManufacturingRunStatus,
  to: ManufacturingRunStatus,
): void {
  const allowed: Record<ManufacturingRunStatus, ReadonlyArray<ManufacturingRunStatus>> = {
    draft: ['started', 'cancelled'],
    started: ['completed', 'cancelled'],
    completed: [],
    cancelled: [],
  };
  if (!allowed[from].includes(to)) {
    throw new ApiError(
      'STATE_CONFLICT', 409,
      `illegal manufacturing_run transition: ${from} -> ${to}`,
    );
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Route table
// ---------------------------------------------------------------------------

const TABLE: Route[] = [
  // -------------------------------------------------------------------------
  // manufacturing_runs (parent)
  // -------------------------------------------------------------------------
  {
    method: 'GET', path: '/manufacturing-runs',
    handler: async ({ req, url }) => {
      const caller = requireCaller(req);
      // Read is RLS-only per A4: no manufacturing.run.read cap exists.
      // RLS Pattern A filters cross-tenant rows; the org_id filter below
      // is the defense-in-depth handler gate so cross-tenant lists return
      // 200 + [].
      const status = url.searchParams.get('status');
      const warehouseId = url.searchParams.get('warehouse_id');
      // F-Wave9-AUDIT-V3-WAVE-C4-01: project_id filter added so
      // ProjectDetailPage can ask the server for only manufacturing runs
      // bound to a given project. Mirrors the receiving_orders project_id
      // filter shape (UX-Q6). RLS Pattern A wraps the org gate so a
      // cross-tenant project_id resolves to 200 + []. Backed by
      // manufacturing_runs_project_id_idx (migration 0063).
      const projectId = url.searchParams.get('project_id');
      let q = admin()
        .from('manufacturing_runs').select('*')
        .eq('org_id', caller.orgId).is('deleted_at', null)
        .order('created_at', { ascending: false }).limit(200);
      if (status) q = q.eq('status', status);
      if (warehouseId) q = q.eq('warehouse_id', warehouseId);
      if (projectId) q = q.eq('project_id', projectId);
      const { data, error } = await q;
      if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
      return ok((data ?? []).map((r) => ManufacturingRunSchema.parse(r)));
    },
  },
  {
    method: 'POST', path: '/manufacturing-runs',
    handler: async ({ req }) => {
      const caller = requireCaller(req);
      requireCap(caller, 'manufacturing.run.create');
      const body = await parseBody(req, ManufacturingRunCreateSchema);
      return respondWithIdempotency(req, caller, BUNDLE, '/manufacturing-runs', body, async () => {
        // Operator may pass a `run_number` to override; otherwise the
        // org-scoped numbering chassis (next_doc_number RPC) allocates the
        // next MFG-YYYY-NNNNN string. Seeded with prefix MFG- + yearly reset
        // by migration 0054 (F-Wave9-MFG-RUN-NUMBERING-01).
        const runNumber = body.run_number?.trim()
          ? body.run_number.trim()
          : await nextDocNumber(caller.orgId, 'manufacturing_run');
        const insert: Record<string, unknown> = {
          org_id: caller.orgId,
          status: 'draft',
          run_number: runNumber,
          warehouse_id: body.warehouse_id ?? null,
          // F-Wave9-AUDIT-V3-WAVE-C2-01: project linkage wired through
          // from the body. Nullable column; absent / null both land as
          // NULL in the DB.
          project_id: body.project_id ?? null,
          planned_start_at: body.planned_start_at ?? null,
          planned_complete_at: body.planned_complete_at ?? null,
          notes: body.notes ?? null,
          payload: body.payload ?? {},
          created_by: caller.userId,
          updated_by: caller.userId,
        };
        const { data, error } = await admin().from('manufacturing_runs')
          .insert(insert).select('*').single();
        if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
        return created(ManufacturingRunSchema.parse(data));
      });
    },
  },
  {
    method: 'GET', path: '/manufacturing-runs/:id',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      parseUuidParam(params.id);
      const row = await loadRun(caller, params.id);
      return ok(row);
    },
  },
  {
    method: 'PATCH', path: '/manufacturing-runs/:id',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      requireCap(caller, 'manufacturing.run.update');
      parseUuidParam(params.id);
      const body = await parseBody(req, ManufacturingRunPatchSchema);
      return respondWithIdempotency(req, caller, BUNDLE, '/manufacturing-runs/:id', body, async () => {
        const cur = await loadRun(caller, params.id);
        // Only draft runs are editable. Once a run has started, status
        // transitions are the only legal mutation surface.
        if (cur.status !== 'draft') {
          throw new ApiError(
            'STATE_CONFLICT', 409,
            `manufacturing_run cannot be edited from status=${cur.status}`,
          );
        }
        const patch: Record<string, unknown> = {
          updated_by: caller.userId,
          updated_at: nowIso(),
        };
        if (body.run_number !== undefined) patch.run_number = body.run_number;
        if (body.warehouse_id !== undefined) patch.warehouse_id = body.warehouse_id;
        // F-Wave9-AUDIT-V3-WAVE-C2-01: link / unlink supported on PATCH.
        // Explicit undefined check preserves the partial-PATCH contract:
        // unspecified fields are not touched; explicit null clears the
        // linkage (ON DELETE SET NULL precedent).
        if (body.project_id !== undefined) patch.project_id = body.project_id;
        if (body.planned_start_at !== undefined) patch.planned_start_at = body.planned_start_at;
        if (body.planned_complete_at !== undefined) patch.planned_complete_at = body.planned_complete_at;
        if (body.notes !== undefined) patch.notes = body.notes;
        if (body.payload !== undefined) patch.payload = body.payload;
        const { data, error } = await admin().from('manufacturing_runs')
          .update(patch)
          .eq('org_id', caller.orgId).eq('id', params.id).is('deleted_at', null)
          .select('*').maybeSingle();
        if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
        if (!data) throw new ApiError('NOT_FOUND', 404);
        return ok(ManufacturingRunSchema.parse(data));
      });
    },
  },
  {
    method: 'DELETE', path: '/manufacturing-runs/:id',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      requireCap(caller, 'manufacturing.run.delete');
      parseUuidParam(params.id);
      return respondWithIdempotency(req, caller, BUNDLE, '/manufacturing-runs/:id-delete', null, async () => {
        const cur = await loadRun(caller, params.id);
        // Completed runs have already emitted stock_movements via the
        // tg_manufacturing_runs_emit_movements trigger (migration 0053).
        // Soft-deleting them would orphan those movements and undermine
        // the audit chain; refuse with 409.
        if (cur.status === 'completed') {
          throw new ApiError(
            'STATE_CONFLICT', 409,
            'manufacturing_run cannot be deleted after completion',
          );
        }
        const { data, error } = await admin().from('manufacturing_runs')
          .update({
            deleted_at: nowIso(),
            updated_by: caller.userId,
            updated_at: nowIso(),
          })
          .eq('org_id', caller.orgId).eq('id', params.id).is('deleted_at', null)
          .select('id').maybeSingle();
        if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
        if (!data) throw new ApiError('NOT_FOUND', 404);
        return ok({ id: params.id, deleted: true });
      });
    },
  },

  // -------------------------------------------------------------------------
  // State transitions
  // -------------------------------------------------------------------------
  {
    method: 'POST', path: '/manufacturing-runs/:id/start',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      requireCap(caller, 'manufacturing.run.start');
      parseUuidParam(params.id);
      return respondWithIdempotency(req, caller, BUNDLE, '/manufacturing-runs/:id/start', null, async () => {
        const cur = await loadRun(caller, params.id);
        assertManufacturingTransition(cur.status, 'started');
        const ts = nowIso();
        const { data, error } = await admin().from('manufacturing_runs')
          .update({
            status: 'started',
            started_at: ts,
            updated_by: caller.userId,
            updated_at: ts,
          })
          .eq('org_id', caller.orgId).eq('id', params.id).is('deleted_at', null)
          .select('*').maybeSingle();
        if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
        if (!data) throw new ApiError('NOT_FOUND', 404);
        return ok(ManufacturingRunSchema.parse(data));
      });
    },
  },
  {
    method: 'POST', path: '/manufacturing-runs/:id/complete',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      requireCap(caller, 'manufacturing.run.complete');
      parseUuidParam(params.id);
      return respondWithIdempotency(req, caller, BUNDLE, '/manufacturing-runs/:id/complete', null, async () => {
        const cur = await loadRun(caller, params.id);
        assertManufacturingTransition(cur.status, 'completed');
        const ts = nowIso();
        // DB trigger tg_manufacturing_runs_emit_movements (migration 0053)
        // fires AFTER UPDATE OF status and writes stock_movements when
        // warehouse_id is non-null. Null warehouse_id -> trigger early-
        // returns (admin-only run).
        const { data, error } = await admin().from('manufacturing_runs')
          .update({
            status: 'completed',
            completed_at: ts,
            updated_by: caller.userId,
            updated_at: ts,
          })
          .eq('org_id', caller.orgId).eq('id', params.id).is('deleted_at', null)
          .select('*').maybeSingle();
        if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
        if (!data) throw new ApiError('NOT_FOUND', 404);
        return ok(ManufacturingRunSchema.parse(data));
      });
    },
  },
  {
    method: 'POST', path: '/manufacturing-runs/:id/cancel',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      requireCap(caller, 'manufacturing.run.cancel');
      parseUuidParam(params.id);
      return respondWithIdempotency(req, caller, BUNDLE, '/manufacturing-runs/:id/cancel', null, async () => {
        const cur = await loadRun(caller, params.id);
        assertManufacturingTransition(cur.status, 'cancelled');
        const ts = nowIso();
        const { data, error } = await admin().from('manufacturing_runs')
          .update({
            status: 'cancelled',
            cancelled_at: ts,
            updated_by: caller.userId,
            updated_at: ts,
          })
          .eq('org_id', caller.orgId).eq('id', params.id).is('deleted_at', null)
          .select('*').maybeSingle();
        if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
        if (!data) throw new ApiError('NOT_FOUND', 404);
        return ok(ManufacturingRunSchema.parse(data));
      });
    },
  },

  // -------------------------------------------------------------------------
  // Consumed line items (item_id REQUIRED per migration 0052)
  // -------------------------------------------------------------------------
  {
    method: 'GET', path: '/manufacturing-runs/:id/consumed',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      parseUuidParam(params.id);
      await assertRunParent(caller, params.id);
      const { data, error } = await admin()
        .from('manufacturing_run_consumed_line_items').select('*')
        .eq('org_id', caller.orgId)
        .eq('manufacturing_run_id', params.id)
        .order('position', { ascending: true });
      if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
      return ok((data ?? []).map((r) => ManufacturingRunConsumedLineItemSchema.parse(r)));
    },
  },
  {
    method: 'POST', path: '/manufacturing-runs/:id/consumed',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      requireCap(caller, 'manufacturing.run.line_item.create');
      parseUuidParam(params.id);
      const body = await parseBody(req, ManufacturingRunConsumedLineItemCreateSchema);
      return respondWithIdempotency(
        req, caller, BUNDLE, '/manufacturing-runs/:id/consumed', body,
        async () => {
          await assertRunParent(caller, params.id);
          const position = body.position ?? await nextLinePosition(
            'manufacturing_run_consumed_line_items', caller, params.id,
          );
          const insert = {
            org_id: caller.orgId,
            manufacturing_run_id: params.id,
            item_id: body.item_id,
            quantity: body.quantity,
            unit_cost_cents: body.unit_cost_cents ?? null,
            uom: body.uom ?? null,
            reference: body.reference ?? null,
            position,
            created_by: caller.userId,
            updated_by: caller.userId,
          };
          const { data, error } = await admin()
            .from('manufacturing_run_consumed_line_items').insert(insert)
            .select('*').single();
          if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
          return created(ManufacturingRunConsumedLineItemSchema.parse(data));
        },
      );
    },
  },
  {
    method: 'PATCH', path: '/manufacturing-runs/:id/consumed/:lineId',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      requireCap(caller, 'manufacturing.run.line_item.update');
      parseUuidParam(params.id);
      parseUuidParam(params.lineId, 'lineId');
      const body = await parseBody(req, ManufacturingRunConsumedLineItemUpdateSchema);
      return respondWithIdempotency(
        req, caller, BUNDLE, '/manufacturing-runs/:id/consumed/:lineId', body,
        async () => {
          await assertRunParent(caller, params.id);
          const patch: Record<string, unknown> = { updated_by: caller.userId };
          if (body.item_id !== undefined) patch.item_id = body.item_id;
          if (body.quantity !== undefined) patch.quantity = body.quantity;
          if (body.unit_cost_cents !== undefined) patch.unit_cost_cents = body.unit_cost_cents;
          if (body.uom !== undefined) patch.uom = body.uom;
          if (body.reference !== undefined) patch.reference = body.reference;
          if (body.position !== undefined) patch.position = body.position;
          const { data, error } = await admin()
            .from('manufacturing_run_consumed_line_items')
            .update(patch)
            .eq('org_id', caller.orgId)
            .eq('manufacturing_run_id', params.id)
            .eq('id', params.lineId)
            .select('*').maybeSingle();
          if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
          if (!data) throw new ApiError('NOT_FOUND', 404);
          return ok(ManufacturingRunConsumedLineItemSchema.parse(data));
        },
      );
    },
  },
  {
    method: 'DELETE', path: '/manufacturing-runs/:id/consumed/:lineId',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      requireCap(caller, 'manufacturing.run.line_item.delete');
      parseUuidParam(params.id);
      parseUuidParam(params.lineId, 'lineId');
      return respondWithIdempotency(
        req, caller, BUNDLE, '/manufacturing-runs/:id/consumed/:lineId-delete', null,
        async () => {
          await assertRunParent(caller, params.id);
          const { data, error } = await admin()
            .from('manufacturing_run_consumed_line_items').delete()
            .eq('org_id', caller.orgId)
            .eq('manufacturing_run_id', params.id)
            .eq('id', params.lineId)
            .select('id').maybeSingle();
          if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
          if (!data) throw new ApiError('NOT_FOUND', 404);
          return ok({ id: params.lineId, deleted: true });
        },
      );
    },
  },

  // -------------------------------------------------------------------------
  // Produced line items (item_id NULLABLE per migration 0052)
  // -------------------------------------------------------------------------
  {
    method: 'GET', path: '/manufacturing-runs/:id/produced',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      parseUuidParam(params.id);
      await assertRunParent(caller, params.id);
      const { data, error } = await admin()
        .from('manufacturing_run_produced_line_items').select('*')
        .eq('org_id', caller.orgId)
        .eq('manufacturing_run_id', params.id)
        .order('position', { ascending: true });
      if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
      return ok((data ?? []).map((r) => ManufacturingRunProducedLineItemSchema.parse(r)));
    },
  },
  {
    method: 'POST', path: '/manufacturing-runs/:id/produced',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      requireCap(caller, 'manufacturing.run.line_item.create');
      parseUuidParam(params.id);
      const body = await parseBody(req, ManufacturingRunProducedLineItemCreateSchema);
      return respondWithIdempotency(
        req, caller, BUNDLE, '/manufacturing-runs/:id/produced', body,
        async () => {
          await assertRunParent(caller, params.id);
          const position = body.position ?? await nextLinePosition(
            'manufacturing_run_produced_line_items', caller, params.id,
          );
          const insert = {
            org_id: caller.orgId,
            manufacturing_run_id: params.id,
            item_id: body.item_id ?? null,
            quantity: body.quantity,
            unit_cost_cents: body.unit_cost_cents ?? null,
            uom: body.uom ?? null,
            reference: body.reference ?? null,
            position,
            created_by: caller.userId,
            updated_by: caller.userId,
          };
          const { data, error } = await admin()
            .from('manufacturing_run_produced_line_items').insert(insert)
            .select('*').single();
          if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
          return created(ManufacturingRunProducedLineItemSchema.parse(data));
        },
      );
    },
  },
  {
    method: 'PATCH', path: '/manufacturing-runs/:id/produced/:lineId',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      requireCap(caller, 'manufacturing.run.line_item.update');
      parseUuidParam(params.id);
      parseUuidParam(params.lineId, 'lineId');
      const body = await parseBody(req, ManufacturingRunProducedLineItemUpdateSchema);
      return respondWithIdempotency(
        req, caller, BUNDLE, '/manufacturing-runs/:id/produced/:lineId', body,
        async () => {
          await assertRunParent(caller, params.id);
          const patch: Record<string, unknown> = { updated_by: caller.userId };
          if (body.item_id !== undefined) patch.item_id = body.item_id;
          if (body.quantity !== undefined) patch.quantity = body.quantity;
          if (body.unit_cost_cents !== undefined) patch.unit_cost_cents = body.unit_cost_cents;
          if (body.uom !== undefined) patch.uom = body.uom;
          if (body.reference !== undefined) patch.reference = body.reference;
          if (body.position !== undefined) patch.position = body.position;
          const { data, error } = await admin()
            .from('manufacturing_run_produced_line_items')
            .update(patch)
            .eq('org_id', caller.orgId)
            .eq('manufacturing_run_id', params.id)
            .eq('id', params.lineId)
            .select('*').maybeSingle();
          if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
          if (!data) throw new ApiError('NOT_FOUND', 404);
          return ok(ManufacturingRunProducedLineItemSchema.parse(data));
        },
      );
    },
  },
  {
    method: 'DELETE', path: '/manufacturing-runs/:id/produced/:lineId',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      requireCap(caller, 'manufacturing.run.line_item.delete');
      parseUuidParam(params.id);
      parseUuidParam(params.lineId, 'lineId');
      return respondWithIdempotency(
        req, caller, BUNDLE, '/manufacturing-runs/:id/produced/:lineId-delete', null,
        async () => {
          await assertRunParent(caller, params.id);
          const { data, error } = await admin()
            .from('manufacturing_run_produced_line_items').delete()
            .eq('org_id', caller.orgId)
            .eq('manufacturing_run_id', params.id)
            .eq('id', params.lineId)
            .select('id').maybeSingle();
          if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
          if (!data) throw new ApiError('NOT_FOUND', 404);
          return ok({ id: params.lineId, deleted: true });
        },
      );
    },
  },
];

// ---------------------------------------------------------------------------
// Bundle-level dispatcher: gate on plugins.manufacturing before any route runs.
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return route(req, [], { bundle: BUNDLE });
  }
  const ctx = readCallerContext(req);
  if (ctx.orgId) {
    const flag = await getFlag(ctx.orgId, FEATURE_FLAGS.PLUGINS_MANUFACTURING);
    if (!flag.enabled) {
      return fromApiError(new ApiError(ERROR_CODES.NOT_FOUND, 404));
    }
  }
  return route(req, TABLE, { bundle: BUNDLE });
});
