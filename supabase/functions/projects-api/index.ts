// projects-api: CRUD for projects + project_phases, state transitions,
// drag-drop phase reorder.

import { z } from 'zod';

import { route, type Route, type RouteCtx } from '../_shared/route.ts';
import {
  admin, parseBody, parseLimit, paginate, respondWithIdempotency, created,
} from '../_shared/handler-helpers.ts';
import { requireSalesCap as requireCap } from './_helpers.ts';
import { ok, ApiError } from '../_shared/responses.ts';
import { requireCaller } from '../_shared/tenant.ts';
import {
  CreateProjectRequestSchema, TransitionRequestSchema,
  ReorderPhasesRequestSchema, ProjectStateSchema, ProjectPhaseStateSchema,
  CreateProjectLineItemRequestSchema, UpdateProjectLineItemRequestSchema,
} from '../_shared/types/sales.ts';
import {
  PROJECT_FSM, PROJECT_PHASE_FSM, canTransition,
  type ProjectState, type ProjectPhaseState,
} from '../_shared/workflow/sales.ts';

const BUNDLE = 'projects-api';

const UpdateProjectRequestSchema = CreateProjectRequestSchema.partial();

const CreatePhaseRequestSchema = z.object({
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  position: z.number().int().optional(),
  start_date: z.string().nullable().optional(),
  due_date: z.string().nullable().optional(),
});
const UpdatePhaseRequestSchema = CreatePhaseRequestSchema.partial();

// --- projects ---

const listProjects = async (ctx: RouteCtx) => {
  const caller = requireCaller(ctx.req);
  requireCap(caller, 'projects.project.read');
  const limit = parseLimit(ctx.url);
  const state = ctx.url.searchParams.get('state');
  const client = admin();
  let q = client
    .from('projects').select('*')
    .eq('org_id', caller.orgId).is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(limit + 1);
  if (state) q = q.eq('state', state);
  const { data, error } = await q;
  if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
  const rows = data ?? [];
  return ok(paginate(rows as Array<{ id: string; created_at: string }>, limit));
};

const getProject = async (ctx: RouteCtx) => {
  const caller = requireCaller(ctx.req);
  requireCap(caller, 'projects.project.read');
  const client = admin();
  const { data: project, error: pErr } = await client
    .from('projects').select('*')
    .eq('id', ctx.params.id).eq('org_id', caller.orgId)
    .maybeSingle();
  if (pErr) throw new ApiError('INTERNAL_ERROR', 500, pErr.message);
  if (!project) throw new ApiError('NOT_FOUND', 404);
  const { data: phases, error: phErr } = await client
    .from('project_phases').select('*')
    .eq('project_id', ctx.params.id)
    .order('position', { ascending: true });
  if (phErr) throw new ApiError('INTERNAL_ERROR', 500, phErr.message);
  return ok({ project, phases: phases ?? [] });
};

const createProject = async (ctx: RouteCtx) => {
  const caller = requireCaller(ctx.req);
  requireCap(caller, 'projects.project.write');
  const body = await parseBody(ctx.req, CreateProjectRequestSchema);
  return respondWithIdempotency(
    ctx.req, caller, BUNDLE, '/projects', body,
    async () => {
      const client = admin();
      const { data, error } = await client
        .from('projects')
        .insert({
          ...body,
          org_id: caller.orgId,
          state: 'pending',
          created_by: caller.userId, updated_by: caller.userId,
        })
        .select('*').maybeSingle();
      if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
      return created(data);
    },
  );
};

const updateProject = async (ctx: RouteCtx) => {
  const caller = requireCaller(ctx.req);
  requireCap(caller, 'projects.project.write');
  const body = await parseBody(ctx.req, UpdateProjectRequestSchema);
  return respondWithIdempotency(
    ctx.req, caller, BUNDLE, '/projects/:id', body,
    async () => {
      const client = admin();
      const { data, error } = await client
        .from('projects')
        .update({ ...body, updated_by: caller.userId, updated_at: new Date().toISOString() })
        .eq('id', ctx.params.id).eq('org_id', caller.orgId)
        .select('*').maybeSingle();
      if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
      if (!data) throw new ApiError('NOT_FOUND', 404);
      return ok(data);
    },
  );
};

const deleteProject = async (ctx: RouteCtx) => {
  const caller = requireCaller(ctx.req);
  requireCap(caller, 'projects.project.delete');
  return respondWithIdempotency(
    ctx.req, caller, BUNDLE, '/projects/:id-delete', null,
    async () => {
      const client = admin();
      const { data, error } = await client
        .from('projects')
        .update({ deleted_at: new Date().toISOString(), updated_by: caller.userId })
        .eq('id', ctx.params.id).eq('org_id', caller.orgId)
        .select('id').maybeSingle();
      if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
      if (!data) throw new ApiError('NOT_FOUND', 404);
      return ok({ id: data.id, deleted: true });
    },
  );
};

const transitionProject = async (ctx: RouteCtx) => {
  const caller = requireCaller(ctx.req);
  requireCap(caller, 'projects.transition');
  const body = await parseBody(ctx.req, TransitionRequestSchema);
  const to = body.to as ProjectState;
  return respondWithIdempotency(
    ctx.req, caller, BUNDLE, '/projects/:id/transition', body,
    async () => {
      const client = admin();
      const { data: p } = await client
        .from('projects').select('id, org_id, state')
        .eq('id', ctx.params.id).eq('org_id', caller.orgId).maybeSingle();
      if (!p) throw new ApiError('NOT_FOUND', 404);
      const from = p.state as ProjectState;
      if (!canTransition(PROJECT_FSM, from, to)) {
        throw new ApiError('STATE_CONFLICT', 409,
          `illegal transition ${from} -> ${to}`);
      }
      const { data, error } = await client
        .from('projects')
        .update({ state: to, updated_by: caller.userId })
        .eq('id', ctx.params.id).eq('org_id', caller.orgId)
        .select('*').maybeSingle();
      if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
      return ok(data);
    },
  );
};

// --- phases ---

const createPhase = async (ctx: RouteCtx) => {
  const caller = requireCaller(ctx.req);
  requireCap(caller, 'projects.phase.write');
  const body = await parseBody(ctx.req, CreatePhaseRequestSchema);
  return respondWithIdempotency(
    ctx.req, caller, BUNDLE, '/projects/:id/phases', body,
    async () => {
      const client = admin();
      // Verify parent ownership.
      const { data: parent } = await client
        .from('projects').select('id')
        .eq('id', ctx.params.id).eq('org_id', caller.orgId).maybeSingle();
      if (!parent) throw new ApiError('NOT_FOUND', 404);

      let position = body.position;
      if (position === undefined) {
        const { data: maxRow } = await client
          .from('project_phases').select('position')
          .eq('project_id', ctx.params.id)
          .order('position', { ascending: false }).limit(1).maybeSingle();
        position = ((maxRow?.position as number) ?? -1) + 1;
      }

      const { data, error } = await client
        .from('project_phases')
        .insert({
          project_id: ctx.params.id,
          name: body.name,
          description: body.description ?? null,
          position,
          start_date: body.start_date ?? null,
          due_date: body.due_date ?? null,
          state: 'pending',
          created_by: caller.userId, updated_by: caller.userId,
        })
        .select('*').maybeSingle();
      if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
      return created(data);
    },
  );
};

const updatePhase = async (ctx: RouteCtx) => {
  const caller = requireCaller(ctx.req);
  requireCap(caller, 'projects.phase.write');
  const body = await parseBody(ctx.req, UpdatePhaseRequestSchema);
  return respondWithIdempotency(
    ctx.req, caller, BUNDLE, '/projects/:id/phases/:phaseId', body,
    async () => {
      const client = admin();
      // Parent tenant gate.
      const { data: parent } = await client
        .from('projects').select('id')
        .eq('id', ctx.params.id).eq('org_id', caller.orgId).maybeSingle();
      if (!parent) throw new ApiError('NOT_FOUND', 404);
      const { data, error } = await client
        .from('project_phases')
        .update({ ...body, updated_by: caller.userId, updated_at: new Date().toISOString() })
        .eq('id', ctx.params.phaseId).eq('project_id', ctx.params.id)
        .select('*').maybeSingle();
      if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
      if (!data) throw new ApiError('NOT_FOUND', 404);
      return ok(data);
    },
  );
};

const deletePhase = async (ctx: RouteCtx) => {
  const caller = requireCaller(ctx.req);
  requireCap(caller, 'projects.phase.write');
  return respondWithIdempotency(
    ctx.req, caller, BUNDLE, '/projects/:id/phases/:phaseId-delete', null,
    async () => {
      const client = admin();
      const { data: parent } = await client
        .from('projects').select('id')
        .eq('id', ctx.params.id).eq('org_id', caller.orgId).maybeSingle();
      if (!parent) throw new ApiError('NOT_FOUND', 404);
      const { error } = await client
        .from('project_phases').delete()
        .eq('id', ctx.params.phaseId).eq('project_id', ctx.params.id);
      if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
      return ok({ id: ctx.params.phaseId, deleted: true });
    },
  );
};

const transitionPhase = async (ctx: RouteCtx) => {
  const caller = requireCaller(ctx.req);
  requireCap(caller, 'projects.phase.transition');
  const body = await parseBody(ctx.req, TransitionRequestSchema);
  const to = body.to as ProjectPhaseState;
  return respondWithIdempotency(
    ctx.req, caller, BUNDLE, '/projects/:id/phases/:phaseId/transition', body,
    async () => {
      const client = admin();
      const { data: parent } = await client
        .from('projects').select('id')
        .eq('id', ctx.params.id).eq('org_id', caller.orgId).maybeSingle();
      if (!parent) throw new ApiError('NOT_FOUND', 404);
      const { data: phase } = await client
        .from('project_phases').select('id, state')
        .eq('id', ctx.params.phaseId).eq('project_id', ctx.params.id).maybeSingle();
      if (!phase) throw new ApiError('NOT_FOUND', 404);
      const from = phase.state as ProjectPhaseState;
      if (!canTransition(PROJECT_PHASE_FSM, from, to)) {
        throw new ApiError('STATE_CONFLICT', 409,
          `illegal transition ${from} -> ${to}`);
      }
      const { data, error } = await client
        .from('project_phases')
        .update({ state: to, updated_by: caller.userId })
        .eq('id', ctx.params.phaseId).eq('project_id', ctx.params.id)
        .select('*').maybeSingle();
      if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
      return ok(data);
    },
  );
};

const reorderPhases = async (ctx: RouteCtx) => {
  const caller = requireCaller(ctx.req);
  requireCap(caller, 'projects.phase.reorder');
  const body = await parseBody(ctx.req, ReorderPhasesRequestSchema);
  return respondWithIdempotency(
    ctx.req, caller, BUNDLE, '/projects/:id/phases/reorder', body,
    async () => {
      const client = admin();
      const { data: parent } = await client
        .from('projects').select('id')
        .eq('id', ctx.params.id).eq('org_id', caller.orgId).maybeSingle();
      if (!parent) throw new ApiError('NOT_FOUND', 404);

      // Verify every supplied phase belongs to this project.
      const { data: existing, error: exErr } = await client
        .from('project_phases').select('id')
        .eq('project_id', ctx.params.id);
      if (exErr) throw new ApiError('INTERNAL_ERROR', 500, exErr.message);
      const existingIds = new Set((existing ?? []).map((r) => (r as { id: string }).id));
      for (const id of body.phase_ids) {
        if (!existingIds.has(id)) {
          throw new ApiError('VALIDATION_ERROR', 422,
            `phase ${id} does not belong to project`);
        }
      }

      // Apply new positions in caller-supplied order.
      const now = new Date().toISOString();
      for (let i = 0; i < body.phase_ids.length; i++) {
        const { error } = await client
          .from('project_phases')
          .update({ position: i, updated_by: caller.userId, updated_at: now })
          .eq('id', body.phase_ids[i])
          .eq('project_id', ctx.params.id);
        if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
      }
      return ok({ project_id: ctx.params.id, ordered: body.phase_ids });
    },
  );
};

// --- project line items (shipped in migration 0044) ---

const listLineItems = async (ctx: RouteCtx) => {
  const caller = requireCaller(ctx.req);
  requireCap(caller, 'projects.line_item.read');
  const client = admin();
  const { data: parent } = await client
    .from('projects').select('id')
    .eq('id', ctx.params.id).eq('org_id', caller.orgId).maybeSingle();
  if (!parent) throw new ApiError('NOT_FOUND', 404);
  const { data, error } = await client
    .from('project_line_items').select('*')
    .eq('project_id', ctx.params.id)
    .eq('org_id', caller.orgId)
    .order('position', { ascending: true });
  if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
  return ok(data ?? []);
};

const createLineItem = async (ctx: RouteCtx) => {
  const caller = requireCaller(ctx.req);
  requireCap(caller, 'projects.line_item.create');
  const body = await parseBody(ctx.req, CreateProjectLineItemRequestSchema);
  return respondWithIdempotency(
    ctx.req, caller, BUNDLE, '/projects/:id/line-items', body,
    async () => {
      const client = admin();
      const { data: parent } = await client
        .from('projects').select('id')
        .eq('id', ctx.params.id).eq('org_id', caller.orgId).maybeSingle();
      if (!parent) throw new ApiError('NOT_FOUND', 404);

      let position = body.position;
      if (position === undefined) {
        const { data: maxRow } = await client
          .from('project_line_items').select('position')
          .eq('project_id', ctx.params.id)
          .order('position', { ascending: false }).limit(1).maybeSingle();
        position = ((maxRow?.position as number) ?? -1) + 1;
      }

      const insert = {
        org_id: caller.orgId,
        project_id: ctx.params.id,
        item_id: body.item_id ?? null,
        source_quote_line_item_id: body.source_quote_line_item_id ?? null,
        name: body.name,
        description: body.description ?? null,
        quantity: body.quantity,
        unit_price_cents: body.unit_price_cents,
        tax_rate_id: body.tax_rate_id ?? null,
        discount_percent: body.discount_percent,
        position,
        created_by: caller.userId,
        updated_by: caller.userId,
      };
      const { data, error } = await client
        .from('project_line_items').insert(insert).select('*').maybeSingle();
      if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
      return created(data);
    },
  );
};

const updateLineItem = async (ctx: RouteCtx) => {
  const caller = requireCaller(ctx.req);
  requireCap(caller, 'projects.line_item.update');
  const body = await parseBody(ctx.req, UpdateProjectLineItemRequestSchema);
  return respondWithIdempotency(
    ctx.req, caller, BUNDLE, '/projects/:id/line-items/:lineId', body,
    async () => {
      const client = admin();
      const { data: parent } = await client
        .from('projects').select('id')
        .eq('id', ctx.params.id).eq('org_id', caller.orgId).maybeSingle();
      if (!parent) throw new ApiError('NOT_FOUND', 404);
      const { data, error } = await client
        .from('project_line_items')
        .update({ ...body, updated_by: caller.userId })
        .eq('id', ctx.params.lineId)
        .eq('project_id', ctx.params.id)
        .eq('org_id', caller.orgId)
        .select('*').maybeSingle();
      if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
      if (!data) throw new ApiError('NOT_FOUND', 404);
      return ok(data);
    },
  );
};

const deleteLineItem = async (ctx: RouteCtx) => {
  const caller = requireCaller(ctx.req);
  requireCap(caller, 'projects.line_item.delete');
  return respondWithIdempotency(
    ctx.req, caller, BUNDLE, '/projects/:id/line-items/:lineId-delete', null,
    async () => {
      const client = admin();
      const { data: parent } = await client
        .from('projects').select('id')
        .eq('id', ctx.params.id).eq('org_id', caller.orgId).maybeSingle();
      if (!parent) throw new ApiError('NOT_FOUND', 404);
      const { error } = await client
        .from('project_line_items').delete()
        .eq('id', ctx.params.lineId)
        .eq('project_id', ctx.params.id)
        .eq('org_id', caller.orgId);
      if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
      return ok({ id: ctx.params.lineId, deleted: true });
    },
  );
};

// --- convert project to invoice (shipped in migration 0045) ---
//
// p_caller_org_id closes the cross-tenant gate at the RPC boundary, same
// pattern as convert_quote_to_project. NOT_FOUND on cross-tenant /
// missing; STATE_CONFLICT on a project not in ready_to_ship / completed.

const convertToInvoice = async (ctx: RouteCtx) => {
  const caller = requireCaller(ctx.req);
  requireCap(caller, 'projects.convert_to_invoice');
  return respondWithIdempotency(
    ctx.req, caller, BUNDLE, '/projects/:id/convert-to-invoice', {},
    async () => {
      const client = admin();
      const { data, error } = await client.rpc('convert_project_to_invoice', {
        p_project_id: ctx.params.id,
        p_caller_org_id: caller.orgId,
        p_actor: caller.userId,
      });
      if (error) {
        if (/NOT_FOUND/.test(error.message)) throw new ApiError('NOT_FOUND', 404);
        if (/STATE_CONFLICT/.test(error.message)) {
          throw new ApiError('STATE_CONFLICT', 409, error.message);
        }
        throw new ApiError('INTERNAL_ERROR', 500, error.message);
      }
      return created({ invoice_id: data });
    },
  );
};

// silence unused
void ProjectStateSchema;
void ProjectPhaseStateSchema;

const ROUTES: Route[] = [
  { method: 'GET',    path: '/projects',                                handler: listProjects },
  { method: 'GET',    path: '/projects/:id',                            handler: getProject },
  { method: 'POST',   path: '/projects',                                handler: createProject },
  { method: 'PATCH',  path: '/projects/:id',                            handler: updateProject },
  { method: 'DELETE', path: '/projects/:id',                            handler: deleteProject },
  { method: 'POST',   path: '/projects/:id/transition',                 handler: transitionProject },

  { method: 'POST',   path: '/projects/:id/convert-to-invoice',         handler: convertToInvoice },

  { method: 'GET',    path: '/projects/:id/line-items',                 handler: listLineItems },
  { method: 'POST',   path: '/projects/:id/line-items',                 handler: createLineItem },
  { method: 'PATCH',  path: '/projects/:id/line-items/:lineId',         handler: updateLineItem },
  { method: 'DELETE', path: '/projects/:id/line-items/:lineId',         handler: deleteLineItem },

  { method: 'POST',   path: '/projects/:id/phases',                     handler: createPhase },
  { method: 'PATCH',  path: '/projects/:id/phases/:phaseId',            handler: updatePhase },
  { method: 'DELETE', path: '/projects/:id/phases/:phaseId',            handler: deletePhase },
  { method: 'POST',   path: '/projects/:id/phases/:phaseId/transition', handler: transitionPhase },
  { method: 'PATCH',  path: '/projects/:id/phases/reorder',             handler: reorderPhases },
];

Deno.serve((req: Request) => route(req, ROUTES, { bundle: BUNDLE }));
