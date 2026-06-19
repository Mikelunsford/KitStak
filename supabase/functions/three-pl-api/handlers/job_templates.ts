// three-pl-api job-templates handlers. job_templates (parent; the Job Builder
// engine; active / inactive flag) plus job_template_lines (child; builder
// definition lines). Handler bodies moved verbatim from the former monolithic
// index.ts during the R-W13-DX-01 structural split; no behaviour change.

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
  JobTemplateSchema,
  JobTemplateCreateSchema,
  JobTemplatePatchSchema,
  JobTemplateLineSchema,
  JobTemplateLineCreateSchema,
  JobTemplateLineUpdateSchema,
} from '../../_shared/types/threepl.ts';
import {
  BUNDLE, nowIso, loadJobTemplate, assertJobTemplateParent, nextLinePosition,
} from './_helpers.ts';

// Workstream C (UI scan) server list toolbar allowlists. SEARCH_COLS are the
// columns an operator types to find a template: name (NOT NULL) and the nullable
// template_number. SORT_COLS are NOT NULL only (created_at, name, status), so the
// keyset cursor never straddles a null; template_number is nullable so it is a
// search target only, never a sort. The variant facet stays an .eq filter, not a
// sort. DEFAULT_SORT keeps the legacy created_at desc ordering.
const JOB_TEMPLATE_SEARCH_COLS = ['name', 'template_number'] as const;
const JOB_TEMPLATE_SORT_COLS = ['created_at', 'name', 'status'] as const;
const JOB_TEMPLATE_DEFAULT_SORT: SortSpec = { column: 'created_at', dir: 'desc' };

export async function listJobTemplates({ req, url }: RouteCtx): Promise<Response> {
  const caller = requireCaller(req);
  const limit = parseLimit(url);
  const sort = parseSort(url, JOB_TEMPLATE_SORT_COLS, JOB_TEMPLATE_DEFAULT_SORT);
  const search = parseSearch(url);
  const cursor = decodeSortCursor(url.searchParams.get('cursor'));
  const status = url.searchParams.get('status');
  const variant = url.searchParams.get('variant');
  let q = admin()
    .from('job_templates').select('*')
    .eq('org_id', caller.orgId).is('deleted_at', null);
  if (status) q = q.eq('status', status);
  if (variant) q = q.eq('variant', variant);
  if (search) q = q.or(buildSearchOr(JOB_TEMPLATE_SEARCH_COLS, search));
  q = q
    .order(sort.column, { ascending: sort.dir === 'asc' })
    .order('id', { ascending: sort.dir === 'asc' })
    .limit(limit + 1);
  if (cursor) q = q.or(buildKeysetOr(sort, cursor));
  const { data, error } = await q;
  if (error) throw internalError(BUNDLE, error);
  const rows = (data ?? []).map((r) => JobTemplateSchema.parse(r)) as Array<
    ReturnType<typeof JobTemplateSchema.parse> & { id: string }
  >;
  return ok(paginateSorted(rows, limit, sort.column));
}

export async function createJobTemplate({ req }: RouteCtx): Promise<Response> {
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
}

export async function getJobTemplate({ req, params }: RouteCtx): Promise<Response> {
  const caller = requireCaller(req);
  parseUuidParam(params.id);
  const row = await loadJobTemplate(caller, params.id);
  return ok(row);
}

export async function patchJobTemplate({ req, params }: RouteCtx): Promise<Response> {
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
}

export async function deleteJobTemplate({ req, params }: RouteCtx): Promise<Response> {
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
}

export async function deactivateJobTemplate({ req, params }: RouteCtx): Promise<Response> {
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
}

export async function reactivateJobTemplate({ req, params }: RouteCtx): Promise<Response> {
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
}

// ---------------------------------------------------------------------------
// job_template_lines (child; builder definition lines)
// ---------------------------------------------------------------------------

export async function listJobTemplateLines({ req, params }: RouteCtx): Promise<Response> {
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
}

export async function createJobTemplateLine({ req, params }: RouteCtx): Promise<Response> {
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
}

export async function patchJobTemplateLine({ req, params }: RouteCtx): Promise<Response> {
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
}

export async function deleteJobTemplateLine({ req, params }: RouteCtx): Promise<Response> {
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
}
