// three-pl-api bundle.
//
// 3PL commercial layer HTTP surface (Phase A1: Accounts). Sibling bundle to
// ops-api (which owns 3PL execution: receiving, production, shipments). This
// bundle owns the commercial / planning layer that the 3PL pivot introduces,
// starting with Accounts and their per-account service definitions (Rate Card
// overlay). Job Builders, Job Runs, Supply Plans, and Billing Review land here
// in later phases. Implements the Accounts portion of
// 03-workspace/specs/2026-06-04-3pl-commercial-pivot-and-wms-pillar-plan.md.
//
// BUNDLE GATE: plugins.three_pl. Constitutional rule (00-canon):
//   Bundle gate off  -> every route returns 404 NOT_FOUND envelope.
//   Per-route flag   -> 403 FEATURE_DISABLED with details.flag. (Not used here.)
//
// The gate fires BEFORE the route table so even a caller hitting an unknown
// path gets 404. Reads are RLS-only (no read cap); state-changing routes call
// requireCap. account_number is allocated by the numbering chassis (ACC-,
// migration 0090). three_pl_accounts.status is a simple active / inactive flag
// (not a registered FSM): the deactivate / reactivate routes set it directly.
//
// Routes (when plugins.three_pl is enabled for the caller's org):
//   GET    /accounts                          list (RLS-only)
//   POST   /accounts                          create (ACC- numbering)
//   GET    /accounts/:id                      read (RLS-only)
//   PATCH  /accounts/:id                      update
//   DELETE /accounts/:id                      soft-delete (reuses account.update)
//   POST   /accounts/:id/deactivate           status -> inactive
//   POST   /accounts/:id/reactivate           status -> active
//   GET    /accounts/:id/services             list service definitions (RLS-only)
//   POST   /accounts/:id/services             add service definition
//   PATCH  /accounts/:id/services/:sid        update service definition
//   DELETE /accounts/:id/services/:sid        delete service definition

import { type Route } from '../_shared/route.ts';
import { ApiError, ok, internalError } from '../_shared/responses.ts';
import {
  admin, parseBody, parseUuidParam, respondWithIdempotency, created, requireCap,
} from '../_shared/handler-helpers.ts';
import { requireCaller, type Caller } from '../_shared/tenant.ts';
import { assertRefInOrg } from '../_shared/crud.ts';
import { serveBundleWithGate } from '../_shared/bundleGate.ts';
import { nextDocNumber } from '../_shared/numbering.ts';
import { FEATURE_FLAGS } from '../_shared/constants.ts';
import {
  ThreePlAccountSchema,
  ThreePlAccountCreateSchema,
  ThreePlAccountPatchSchema,
  AccountServiceDefinitionSchema,
  AccountServiceDefinitionCreateSchema,
  AccountServiceDefinitionUpdateSchema,
  JobTemplateSchema,
  JobTemplateCreateSchema,
  JobTemplatePatchSchema,
  JobTemplateLineSchema,
  JobTemplateLineCreateSchema,
  JobTemplateLineUpdateSchema,
  type ThreePlAccount,
  type JobTemplate,
} from '../_shared/types/threepl.ts';

const BUNDLE = 'three-pl-api';

function nowIso(): string {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Loaders and parent-existence probes. Cross-tenant or soft-deleted rows
// resolve to NOT_FOUND 404, matching the copack-api / ops-api precedent.
// ---------------------------------------------------------------------------

async function loadAccount(caller: Caller, id: string): Promise<ThreePlAccount> {
  const { data, error } = await admin()
    .from('three_pl_accounts').select('*')
    .eq('org_id', caller.orgId).eq('id', id).is('deleted_at', null)
    .maybeSingle();
  if (error) throw internalError(BUNDLE, error);
  if (!data) throw new ApiError('NOT_FOUND', 404);
  return ThreePlAccountSchema.parse(data);
}

async function assertAccountParent(caller: Caller, id: string): Promise<void> {
  const { data, error } = await admin().from('three_pl_accounts').select('id')
    .eq('org_id', caller.orgId).eq('id', id).is('deleted_at', null).maybeSingle();
  if (error) throw internalError(BUNDLE, error);
  if (!data) throw new ApiError('NOT_FOUND', 404);
}

async function nextServicePosition(caller: Caller, accountId: string): Promise<number> {
  const { data, error } = await admin().from('account_service_definitions')
    .select('position')
    .eq('org_id', caller.orgId)
    .eq('account_id', accountId)
    .order('position', { ascending: false }).limit(1).maybeSingle();
  if (error) throw internalError(BUNDLE, error);
  return ((data?.position as number | undefined) ?? -1) + 1;
}

async function loadJobTemplate(caller: Caller, id: string): Promise<JobTemplate> {
  const { data, error } = await admin()
    .from('job_templates').select('*')
    .eq('org_id', caller.orgId).eq('id', id).is('deleted_at', null)
    .maybeSingle();
  if (error) throw internalError(BUNDLE, error);
  if (!data) throw new ApiError('NOT_FOUND', 404);
  return JobTemplateSchema.parse(data);
}

async function assertJobTemplateParent(caller: Caller, id: string): Promise<void> {
  const { data, error } = await admin().from('job_templates').select('id')
    .eq('org_id', caller.orgId).eq('id', id).is('deleted_at', null).maybeSingle();
  if (error) throw internalError(BUNDLE, error);
  if (!data) throw new ApiError('NOT_FOUND', 404);
}

async function nextLinePosition(caller: Caller, templateId: string): Promise<number> {
  const { data, error } = await admin().from('job_template_lines')
    .select('position')
    .eq('org_id', caller.orgId)
    .eq('template_id', templateId)
    .order('position', { ascending: false }).limit(1).maybeSingle();
  if (error) throw internalError(BUNDLE, error);
  return ((data?.position as number | undefined) ?? -1) + 1;
}

// ---------------------------------------------------------------------------
// Route table
// ---------------------------------------------------------------------------

const TABLE: Route[] = [
  // -------------------------------------------------------------------------
  // three_pl_accounts (parent; active / inactive flag, no rich FSM)
  // -------------------------------------------------------------------------
  {
    method: 'GET', path: '/accounts',
    handler: async ({ req, url }) => {
      const caller = requireCaller(req);
      const status = url.searchParams.get('status');
      const customerId = url.searchParams.get('customer_id');
      let q = admin()
        .from('three_pl_accounts').select('*')
        .eq('org_id', caller.orgId).is('deleted_at', null)
        .order('created_at', { ascending: false }).limit(200);
      if (status) q = q.eq('status', status);
      if (customerId) q = q.eq('customer_id', customerId);
      const { data, error } = await q;
      if (error) throw internalError(BUNDLE, error);
      return ok((data ?? []).map((r) => ThreePlAccountSchema.parse(r)));
    },
  },
  {
    method: 'POST', path: '/accounts',
    handler: async ({ req }) => {
      const caller = requireCaller(req);
      requireCap(caller, 'threepl.account.create');
      const body = await parseBody(req, ThreePlAccountCreateSchema);
      return respondWithIdempotency(req, caller, BUNDLE, '/accounts', body, async () => {
        // customer_id is REQUIRED and must exist in-org; a cross-tenant or
        // missing customer resolves to NOT_FOUND 404 (never copies the customer).
        await assertRefInOrg('customers', caller, body.customer_id);
        // Operator may pass an account_number to override; otherwise the
        // org-scoped numbering chassis allocates the next ACC- string (0090).
        const accountNumber = body.account_number?.trim()
          ? body.account_number.trim()
          : await nextDocNumber(caller.orgId, 'three_pl_account');
        const insert: Record<string, unknown> = {
          org_id: caller.orgId,
          customer_id: body.customer_id,
          account_number: accountNumber,
          name: body.name,
          status: body.status ?? 'active',
          notes: body.notes ?? null,
          payload: body.payload ?? {},
          created_by: caller.userId,
          updated_by: caller.userId,
        };
        const { data, error } = await admin().from('three_pl_accounts')
          .insert(insert).select('*').single();
        if (error) throw internalError(BUNDLE, error);
        return created(ThreePlAccountSchema.parse(data));
      });
    },
  },
  {
    method: 'GET', path: '/accounts/:id',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      parseUuidParam(params.id);
      const row = await loadAccount(caller, params.id);
      return ok(row);
    },
  },
  {
    method: 'PATCH', path: '/accounts/:id',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      requireCap(caller, 'threepl.account.update');
      parseUuidParam(params.id);
      const body = await parseBody(req, ThreePlAccountPatchSchema);
      return respondWithIdempotency(req, caller, BUNDLE, '/accounts/:id', body, async () => {
        await assertAccountParent(caller, params.id);
        if (body.customer_id) { await assertRefInOrg('customers', caller, body.customer_id); }
        // status is set via the deactivate / reactivate routes, not here.
        const patch: Record<string, unknown> = {
          updated_by: caller.userId,
          updated_at: nowIso(),
        };
        if (body.customer_id !== undefined) patch.customer_id = body.customer_id;
        if (body.account_number !== undefined) patch.account_number = body.account_number;
        if (body.name !== undefined) patch.name = body.name;
        if (body.notes !== undefined) patch.notes = body.notes;
        if (body.payload !== undefined) patch.payload = body.payload;
        const { data, error } = await admin().from('three_pl_accounts')
          .update(patch)
          .eq('org_id', caller.orgId).eq('id', params.id).is('deleted_at', null)
          .select('*').maybeSingle();
        if (error) throw internalError(BUNDLE, error);
        if (!data) throw new ApiError('NOT_FOUND', 404);
        return ok(ThreePlAccountSchema.parse(data));
      });
    },
  },
  {
    method: 'DELETE', path: '/accounts/:id',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      // No dedicated threepl.account.delete cap; reuse threepl.account.update
      // (same role gate the dedicated cap would have granted).
      requireCap(caller, 'threepl.account.update');
      parseUuidParam(params.id);
      return respondWithIdempotency(req, caller, BUNDLE, '/accounts/:id-delete', null, async () => {
        await assertAccountParent(caller, params.id);
        const { data, error } = await admin().from('three_pl_accounts')
          .update({
            deleted_at: nowIso(),
            updated_by: caller.userId,
            updated_at: nowIso(),
          })
          .eq('org_id', caller.orgId).eq('id', params.id).is('deleted_at', null)
          .select('id').maybeSingle();
        if (error) throw internalError(BUNDLE, error);
        if (!data) throw new ApiError('NOT_FOUND', 404);
        return ok({ id: params.id, deleted: true });
      });
    },
  },
  {
    method: 'POST', path: '/accounts/:id/deactivate',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      requireCap(caller, 'threepl.account.deactivate');
      parseUuidParam(params.id);
      return respondWithIdempotency(req, caller, BUNDLE, '/accounts/:id/deactivate', null, async () => {
        await assertAccountParent(caller, params.id);
        const ts = nowIso();
        const { data, error } = await admin().from('three_pl_accounts')
          .update({ status: 'inactive', updated_by: caller.userId, updated_at: ts })
          .eq('org_id', caller.orgId).eq('id', params.id).is('deleted_at', null)
          .select('*').maybeSingle();
        if (error) throw internalError(BUNDLE, error);
        if (!data) throw new ApiError('NOT_FOUND', 404);
        return ok(ThreePlAccountSchema.parse(data));
      });
    },
  },
  {
    method: 'POST', path: '/accounts/:id/reactivate',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      requireCap(caller, 'threepl.account.deactivate');
      parseUuidParam(params.id);
      return respondWithIdempotency(req, caller, BUNDLE, '/accounts/:id/reactivate', null, async () => {
        await assertAccountParent(caller, params.id);
        const ts = nowIso();
        const { data, error } = await admin().from('three_pl_accounts')
          .update({ status: 'active', updated_by: caller.userId, updated_at: ts })
          .eq('org_id', caller.orgId).eq('id', params.id).is('deleted_at', null)
          .select('*').maybeSingle();
        if (error) throw internalError(BUNDLE, error);
        if (!data) throw new ApiError('NOT_FOUND', 404);
        return ok(ThreePlAccountSchema.parse(data));
      });
    },
  },

  // -------------------------------------------------------------------------
  // account_service_definitions (per-account Rate Card overlay)
  // -------------------------------------------------------------------------
  {
    method: 'GET', path: '/accounts/:id/services',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      parseUuidParam(params.id);
      await assertAccountParent(caller, params.id);
      const { data, error } = await admin()
        .from('account_service_definitions').select('*')
        .eq('org_id', caller.orgId)
        .eq('account_id', params.id)
        .order('position', { ascending: true });
      if (error) throw internalError(BUNDLE, error);
      return ok((data ?? []).map((r) => AccountServiceDefinitionSchema.parse(r)));
    },
  },
  {
    method: 'POST', path: '/accounts/:id/services',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      requireCap(caller, 'threepl.account.service_definition.create');
      parseUuidParam(params.id);
      const body = await parseBody(req, AccountServiceDefinitionCreateSchema);
      return respondWithIdempotency(
        req, caller, BUNDLE, '/accounts/:id/services', body,
        async () => {
          await assertAccountParent(caller, params.id);
          if (body.vas_id) { await assertRefInOrg('value_added_services', caller, body.vas_id); }
          const position = body.position ?? await nextServicePosition(caller, params.id);
          const insert = {
            org_id: caller.orgId,
            account_id: params.id,
            vas_id: body.vas_id ?? null,
            service_kind: body.service_kind,
            name: body.name,
            rate_cents: body.rate_cents ?? null,
            rate_uom: body.rate_uom ?? null,
            currency_code: body.currency_code ?? null,
            effective_from: body.effective_from ?? null,
            effective_to: body.effective_to ?? null,
            position,
            created_by: caller.userId,
            updated_by: caller.userId,
          };
          const { data, error } = await admin()
            .from('account_service_definitions').insert(insert)
            .select('*').single();
          if (error) throw internalError(BUNDLE, error);
          return created(AccountServiceDefinitionSchema.parse(data));
        },
      );
    },
  },
  {
    method: 'PATCH', path: '/accounts/:id/services/:sid',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      requireCap(caller, 'threepl.account.service_definition.update');
      parseUuidParam(params.id);
      parseUuidParam(params.sid, 'sid');
      const body = await parseBody(req, AccountServiceDefinitionUpdateSchema);
      return respondWithIdempotency(
        req, caller, BUNDLE, '/accounts/:id/services/:sid', body,
        async () => {
          await assertAccountParent(caller, params.id);
          if (body.vas_id) { await assertRefInOrg('value_added_services', caller, body.vas_id); }
          const patch: Record<string, unknown> = { updated_by: caller.userId };
          if (body.vas_id !== undefined) patch.vas_id = body.vas_id;
          if (body.service_kind !== undefined) patch.service_kind = body.service_kind;
          if (body.name !== undefined) patch.name = body.name;
          if (body.rate_cents !== undefined) patch.rate_cents = body.rate_cents;
          if (body.rate_uom !== undefined) patch.rate_uom = body.rate_uom;
          if (body.currency_code !== undefined) patch.currency_code = body.currency_code;
          if (body.effective_from !== undefined) patch.effective_from = body.effective_from;
          if (body.effective_to !== undefined) patch.effective_to = body.effective_to;
          if (body.position !== undefined) patch.position = body.position;
          const { data, error } = await admin()
            .from('account_service_definitions')
            .update(patch)
            .eq('org_id', caller.orgId)
            .eq('account_id', params.id)
            .eq('id', params.sid)
            .select('*').maybeSingle();
          if (error) throw internalError(BUNDLE, error);
          if (!data) throw new ApiError('NOT_FOUND', 404);
          return ok(AccountServiceDefinitionSchema.parse(data));
        },
      );
    },
  },
  {
    method: 'DELETE', path: '/accounts/:id/services/:sid',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      requireCap(caller, 'threepl.account.service_definition.delete');
      parseUuidParam(params.id);
      parseUuidParam(params.sid, 'sid');
      return respondWithIdempotency(
        req, caller, BUNDLE, '/accounts/:id/services/:sid-delete', null,
        async () => {
          await assertAccountParent(caller, params.id);
          const { data, error } = await admin()
            .from('account_service_definitions').delete()
            .eq('org_id', caller.orgId)
            .eq('account_id', params.id)
            .eq('id', params.sid)
            .select('id').maybeSingle();
          if (error) throw internalError(BUNDLE, error);
          if (!data) throw new ApiError('NOT_FOUND', 404);
          return ok({ id: params.sid, deleted: true });
        },
      );
    },
  },

  // -------------------------------------------------------------------------
  // job_templates (parent; the Job Builder engine; active / inactive flag)
  // -------------------------------------------------------------------------
  {
    method: 'GET', path: '/job-templates',
    handler: async ({ req, url }) => {
      const caller = requireCaller(req);
      const status = url.searchParams.get('status');
      const variant = url.searchParams.get('variant');
      let q = admin()
        .from('job_templates').select('*')
        .eq('org_id', caller.orgId).is('deleted_at', null)
        .order('created_at', { ascending: false }).limit(200);
      if (status) q = q.eq('status', status);
      if (variant) q = q.eq('variant', variant);
      const { data, error } = await q;
      if (error) throw internalError(BUNDLE, error);
      return ok((data ?? []).map((r) => JobTemplateSchema.parse(r)));
    },
  },
  {
    method: 'POST', path: '/job-templates',
    handler: async ({ req }) => {
      const caller = requireCaller(req);
      requireCap(caller, 'threepl.job_template.create');
      const body = await parseBody(req, JobTemplateCreateSchema);
      return respondWithIdempotency(req, caller, BUNDLE, '/job-templates', body, async () => {
        // job_type_id and default_bom_item_id are optional spine refs; a
        // cross-tenant or missing ref resolves to NOT_FOUND 404 (never copied).
        if (body.job_type_id) { await assertRefInOrg('job_types', caller, body.job_type_id); }
        if (body.default_bom_item_id) { await assertRefInOrg('items', caller, body.default_bom_item_id); }
        // Operator may pass a template_number to override; otherwise the
        // org-scoped numbering chassis allocates the next JB- string (0092).
        const templateNumber = body.template_number?.trim()
          ? body.template_number.trim()
          : await nextDocNumber(caller.orgId, 'job_template');
        const insert: Record<string, unknown> = {
          org_id: caller.orgId,
          template_number: templateNumber,
          name: body.name,
          variant: body.variant ?? 'custom',
          job_type_id: body.job_type_id ?? null,
          default_bom_item_id: body.default_bom_item_id ?? null,
          status: body.status ?? 'active',
          notes: body.notes ?? null,
          payload: body.payload ?? {},
          created_by: caller.userId,
          updated_by: caller.userId,
        };
        const { data, error } = await admin().from('job_templates')
          .insert(insert).select('*').single();
        if (error) throw internalError(BUNDLE, error);
        return created(JobTemplateSchema.parse(data));
      });
    },
  },
  {
    method: 'GET', path: '/job-templates/:id',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      parseUuidParam(params.id);
      const row = await loadJobTemplate(caller, params.id);
      return ok(row);
    },
  },
  {
    method: 'PATCH', path: '/job-templates/:id',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      requireCap(caller, 'threepl.job_template.update');
      parseUuidParam(params.id);
      const body = await parseBody(req, JobTemplatePatchSchema);
      return respondWithIdempotency(req, caller, BUNDLE, '/job-templates/:id', body, async () => {
        await assertJobTemplateParent(caller, params.id);
        if (body.job_type_id) { await assertRefInOrg('job_types', caller, body.job_type_id); }
        if (body.default_bom_item_id) { await assertRefInOrg('items', caller, body.default_bom_item_id); }
        // status is set via the deactivate / reactivate routes, not here.
        const patch: Record<string, unknown> = {
          updated_by: caller.userId,
          updated_at: nowIso(),
        };
        if (body.name !== undefined) patch.name = body.name;
        if (body.variant !== undefined) patch.variant = body.variant;
        if (body.job_type_id !== undefined) patch.job_type_id = body.job_type_id;
        if (body.default_bom_item_id !== undefined) patch.default_bom_item_id = body.default_bom_item_id;
        if (body.template_number !== undefined) patch.template_number = body.template_number;
        if (body.notes !== undefined) patch.notes = body.notes;
        if (body.payload !== undefined) patch.payload = body.payload;
        const { data, error } = await admin().from('job_templates')
          .update(patch)
          .eq('org_id', caller.orgId).eq('id', params.id).is('deleted_at', null)
          .select('*').maybeSingle();
        if (error) throw internalError(BUNDLE, error);
        if (!data) throw new ApiError('NOT_FOUND', 404);
        return ok(JobTemplateSchema.parse(data));
      });
    },
  },
  {
    method: 'DELETE', path: '/job-templates/:id',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      // No dedicated threepl.job_template.delete cap; reuse update (same role
      // gate the dedicated cap would have granted), matching the accounts route.
      requireCap(caller, 'threepl.job_template.update');
      parseUuidParam(params.id);
      return respondWithIdempotency(req, caller, BUNDLE, '/job-templates/:id-delete', null, async () => {
        await assertJobTemplateParent(caller, params.id);
        const { data, error } = await admin().from('job_templates')
          .update({
            deleted_at: nowIso(),
            updated_by: caller.userId,
            updated_at: nowIso(),
          })
          .eq('org_id', caller.orgId).eq('id', params.id).is('deleted_at', null)
          .select('id').maybeSingle();
        if (error) throw internalError(BUNDLE, error);
        if (!data) throw new ApiError('NOT_FOUND', 404);
        return ok({ id: params.id, deleted: true });
      });
    },
  },
  {
    method: 'POST', path: '/job-templates/:id/deactivate',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      requireCap(caller, 'threepl.job_template.deactivate');
      parseUuidParam(params.id);
      return respondWithIdempotency(req, caller, BUNDLE, '/job-templates/:id/deactivate', null, async () => {
        await assertJobTemplateParent(caller, params.id);
        const ts = nowIso();
        const { data, error } = await admin().from('job_templates')
          .update({ status: 'inactive', updated_by: caller.userId, updated_at: ts })
          .eq('org_id', caller.orgId).eq('id', params.id).is('deleted_at', null)
          .select('*').maybeSingle();
        if (error) throw internalError(BUNDLE, error);
        if (!data) throw new ApiError('NOT_FOUND', 404);
        return ok(JobTemplateSchema.parse(data));
      });
    },
  },
  {
    method: 'POST', path: '/job-templates/:id/reactivate',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      requireCap(caller, 'threepl.job_template.deactivate');
      parseUuidParam(params.id);
      return respondWithIdempotency(req, caller, BUNDLE, '/job-templates/:id/reactivate', null, async () => {
        await assertJobTemplateParent(caller, params.id);
        const ts = nowIso();
        const { data, error } = await admin().from('job_templates')
          .update({ status: 'active', updated_by: caller.userId, updated_at: ts })
          .eq('org_id', caller.orgId).eq('id', params.id).is('deleted_at', null)
          .select('*').maybeSingle();
        if (error) throw internalError(BUNDLE, error);
        if (!data) throw new ApiError('NOT_FOUND', 404);
        return ok(JobTemplateSchema.parse(data));
      });
    },
  },

  // -------------------------------------------------------------------------
  // job_template_lines (child; builder definition lines)
  // -------------------------------------------------------------------------
  {
    method: 'GET', path: '/job-templates/:id/lines',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      parseUuidParam(params.id);
      await assertJobTemplateParent(caller, params.id);
      const { data, error } = await admin()
        .from('job_template_lines').select('*')
        .eq('org_id', caller.orgId)
        .eq('template_id', params.id)
        .order('position', { ascending: true });
      if (error) throw internalError(BUNDLE, error);
      return ok((data ?? []).map((r) => JobTemplateLineSchema.parse(r)));
    },
  },
  {
    method: 'POST', path: '/job-templates/:id/lines',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      requireCap(caller, 'threepl.job_template.line.create');
      parseUuidParam(params.id);
      const body = await parseBody(req, JobTemplateLineCreateSchema);
      return respondWithIdempotency(
        req, caller, BUNDLE, '/job-templates/:id/lines', body,
        async () => {
          await assertJobTemplateParent(caller, params.id);
          if (body.item_id) { await assertRefInOrg('items', caller, body.item_id); }
          if (body.vas_id) { await assertRefInOrg('value_added_services', caller, body.vas_id); }
          const position = body.position ?? await nextLinePosition(caller, params.id);
          const insert = {
            org_id: caller.orgId,
            template_id: params.id,
            line_kind: body.line_kind,
            item_id: body.item_id ?? null,
            vas_id: body.vas_id ?? null,
            name: body.name,
            quantity: body.quantity ?? null,
            rate_cents: body.rate_cents ?? null,
            rate_uom: body.rate_uom ?? null,
            currency_code: body.currency_code ?? null,
            position,
            created_by: caller.userId,
            updated_by: caller.userId,
          };
          const { data, error } = await admin()
            .from('job_template_lines').insert(insert)
            .select('*').single();
          if (error) throw internalError(BUNDLE, error);
          return created(JobTemplateLineSchema.parse(data));
        },
      );
    },
  },
  {
    method: 'PATCH', path: '/job-templates/:id/lines/:lid',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      requireCap(caller, 'threepl.job_template.line.update');
      parseUuidParam(params.id);
      parseUuidParam(params.lid, 'lid');
      const body = await parseBody(req, JobTemplateLineUpdateSchema);
      return respondWithIdempotency(
        req, caller, BUNDLE, '/job-templates/:id/lines/:lid', body,
        async () => {
          await assertJobTemplateParent(caller, params.id);
          if (body.item_id) { await assertRefInOrg('items', caller, body.item_id); }
          if (body.vas_id) { await assertRefInOrg('value_added_services', caller, body.vas_id); }
          const patch: Record<string, unknown> = { updated_by: caller.userId };
          if (body.line_kind !== undefined) patch.line_kind = body.line_kind;
          if (body.item_id !== undefined) patch.item_id = body.item_id;
          if (body.vas_id !== undefined) patch.vas_id = body.vas_id;
          if (body.name !== undefined) patch.name = body.name;
          if (body.quantity !== undefined) patch.quantity = body.quantity;
          if (body.rate_cents !== undefined) patch.rate_cents = body.rate_cents;
          if (body.rate_uom !== undefined) patch.rate_uom = body.rate_uom;
          if (body.currency_code !== undefined) patch.currency_code = body.currency_code;
          if (body.position !== undefined) patch.position = body.position;
          const { data, error } = await admin()
            .from('job_template_lines')
            .update(patch)
            .eq('org_id', caller.orgId)
            .eq('template_id', params.id)
            .eq('id', params.lid)
            .select('*').maybeSingle();
          if (error) throw internalError(BUNDLE, error);
          if (!data) throw new ApiError('NOT_FOUND', 404);
          return ok(JobTemplateLineSchema.parse(data));
        },
      );
    },
  },
  {
    method: 'DELETE', path: '/job-templates/:id/lines/:lid',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      requireCap(caller, 'threepl.job_template.line.delete');
      parseUuidParam(params.id);
      parseUuidParam(params.lid, 'lid');
      return respondWithIdempotency(
        req, caller, BUNDLE, '/job-templates/:id/lines/:lid-delete', null,
        async () => {
          await assertJobTemplateParent(caller, params.id);
          const { data, error } = await admin()
            .from('job_template_lines').delete()
            .eq('org_id', caller.orgId)
            .eq('template_id', params.id)
            .eq('id', params.lid)
            .select('id').maybeSingle();
          if (error) throw internalError(BUNDLE, error);
          if (!data) throw new ApiError('NOT_FOUND', 404);
          return ok({ id: params.lid, deleted: true });
        },
      );
    },
  },
];

// ---------------------------------------------------------------------------
// Bundle-level dispatcher: gate on plugins.three_pl before any route runs.
// Shared with copack-api, ops-api, etc. via _shared/bundleGate.ts.
// ---------------------------------------------------------------------------

serveBundleWithGate({
  flagKey: FEATURE_FLAGS.PLUGINS_THREE_PL,
  routes: TABLE,
  bundle: BUNDLE,
});
