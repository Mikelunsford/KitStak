// three-pl-api billing-reviews handlers. billing_reviews (parent; FSM draft /
// approved / invoiced / cancelled; approve / cancel are RPCs: approve cuts the
// spine DRAFT invoice and mints the INV- number itself, never passed from the
// wire, and moves draft -> approved; cancel moves draft|approved ->
// cancelled). review_number is BILL- (numbering chassis, 0103). Handler bodies
// moved verbatim from the former monolithic index.ts during the R-W13-DX-01
// structural split; no behaviour change.

import type { RouteCtx } from '../../_shared/route.ts';
import { ApiError, ok, internalError } from '../../_shared/responses.ts';
import {
  admin, parseBody, parseUuidParam, respondWithIdempotency, created, requireCap,
} from '../../_shared/handler-helpers.ts';
import { requireCaller } from '../../_shared/tenant.ts';
import { assertRefInOrg } from '../../_shared/crud.ts';
import { nextDocNumber } from '../../_shared/numbering.ts';
import {
  BillingReviewSchema,
  BillingReviewCreateSchema,
  BillingReviewPatchSchema,
} from '../../_shared/types/threepl.ts';
import {
  BUNDLE, nowIso, loadBillingReview, assertBillingReviewParent,
} from './_helpers.ts';

export async function listBillingReviews({ req, url }: RouteCtx): Promise<Response> {
  const caller = requireCaller(req);
  const status = url.searchParams.get('status');
  const jobRunId = url.searchParams.get('job_run_id');
  const projectId = url.searchParams.get('project_id');
  const accountId = url.searchParams.get('account_id');
  let q = admin()
    .from('billing_reviews').select('*')
    .eq('org_id', caller.orgId).is('deleted_at', null)
    .order('created_at', { ascending: false }).limit(200);
  if (status) q = q.eq('status', status);
  if (jobRunId) q = q.eq('job_run_id', jobRunId);
  if (projectId) q = q.eq('project_id', projectId);
  if (accountId) q = q.eq('account_id', accountId);
  const { data, error } = await q;
  if (error) throw internalError(BUNDLE, error);
  return ok((data ?? []).map((r) => BillingReviewSchema.parse(r)));
}

export async function createBillingReview({ req }: RouteCtx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'threepl.billing_review.create');
  const body = await parseBody(req, BillingReviewCreateSchema);
  return respondWithIdempotency(req, caller, BUNDLE, '/billing-reviews', body, async () => {
    // Optional demand links; a cross-tenant or missing ref resolves to
    // NOT_FOUND 404 (never copied).
    if (body.job_run_id) { await assertRefInOrg('job_runs', caller, body.job_run_id); }
    if (body.project_id) { await assertRefInOrg('projects', caller, body.project_id); }
    if (body.account_id) { await assertRefInOrg('three_pl_accounts', caller, body.account_id); }
    // Operator may pass a review_number to override; otherwise the org-scoped
    // numbering chassis allocates the next BILL- string (0103).
    const reviewNumber = body.review_number?.trim()
      ? body.review_number.trim()
      : await nextDocNumber(caller.orgId, 'billing_review');
    const insert: Record<string, unknown> = {
      org_id: caller.orgId,
      review_number: reviewNumber,
      job_run_id: body.job_run_id ?? null,
      project_id: body.project_id ?? null,
      account_id: body.account_id ?? null,
      currency_code: body.currency_code ?? null,
      status: 'draft',
      notes: body.notes ?? null,
      payload: body.payload ?? {},
      created_by: caller.userId,
      updated_by: caller.userId,
    };
    const { data, error } = await admin().from('billing_reviews')
      .insert(insert).select('*').single();
    if (error) throw internalError(BUNDLE, error);
    return created(BillingReviewSchema.parse(data));
  });
}

export async function getBillingReview({ req, params }: RouteCtx): Promise<Response> {
  const caller = requireCaller(req);
  parseUuidParam(params.id);
  const row = await loadBillingReview(caller, params.id);
  return ok(row);
}

export async function patchBillingReview({ req, params }: RouteCtx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'threepl.billing_review.update');
  parseUuidParam(params.id);
  const body = await parseBody(req, BillingReviewPatchSchema);
  return respondWithIdempotency(req, caller, BUNDLE, '/billing-reviews/:id', body, async () => {
    await assertBillingReviewParent(caller, params.id);
    if (body.job_run_id) { await assertRefInOrg('job_runs', caller, body.job_run_id); }
    if (body.project_id) { await assertRefInOrg('projects', caller, body.project_id); }
    if (body.account_id) { await assertRefInOrg('three_pl_accounts', caller, body.account_id); }
    // status moves via the approve / cancel routes, not here.
    const patch: Record<string, unknown> = {
      updated_by: caller.userId,
      updated_at: nowIso(),
    };
    if (body.job_run_id !== undefined) patch.job_run_id = body.job_run_id;
    if (body.project_id !== undefined) patch.project_id = body.project_id;
    if (body.account_id !== undefined) patch.account_id = body.account_id;
    if (body.review_number !== undefined) patch.review_number = body.review_number;
    if (body.currency_code !== undefined) patch.currency_code = body.currency_code;
    if (body.notes !== undefined) patch.notes = body.notes;
    if (body.payload !== undefined) patch.payload = body.payload;
    const { data, error } = await admin().from('billing_reviews')
      .update(patch)
      .eq('org_id', caller.orgId).eq('id', params.id).is('deleted_at', null)
      .select('*').maybeSingle();
    if (error) throw internalError(BUNDLE, error);
    if (!data) throw new ApiError('NOT_FOUND', 404);
    return ok(BillingReviewSchema.parse(data));
  });
}

export async function deleteBillingReview({ req, params }: RouteCtx): Promise<Response> {
  const caller = requireCaller(req);
  // No dedicated threepl.billing_review.delete cap; reuse update (same role
  // gate the dedicated cap would have granted), matching the accounts route.
  requireCap(caller, 'threepl.billing_review.update');
  parseUuidParam(params.id);
  return respondWithIdempotency(req, caller, BUNDLE, '/billing-reviews/:id-delete', null, async () => {
    await assertBillingReviewParent(caller, params.id);
    const { data, error } = await admin().from('billing_reviews')
      .update({ deleted_at: nowIso(), updated_by: caller.userId, updated_at: nowIso() })
      .eq('org_id', caller.orgId).eq('id', params.id).is('deleted_at', null)
      .select('id').maybeSingle();
    if (error) throw internalError(BUNDLE, error);
    if (!data) throw new ApiError('NOT_FOUND', 404);
    return ok({ id: params.id, deleted: true });
  });
}

export async function approveBillingReview({ req, params }: RouteCtx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'threepl.billing_review.approve');
  parseUuidParam(params.id);
  return respondWithIdempotency(req, caller, BUNDLE, '/billing-reviews/:id/approve', null, async () => {
    // approve_billing_review is SECURITY DEFINER and takes the caller org as
    // an explicit param: a missing or cross-tenant review surfaces as
    // NOT_FOUND (404, never 403); a non-draft review as STATE_CONFLICT (409).
    // p_invoice_number is intentionally omitted so the RPC mints the INV-.
    const { error } = await admin().rpc('approve_billing_review', {
      p_review_id: params.id,
      p_actor: caller.userId,
      p_caller_org_id: caller.orgId,
    });
    if (error) {
      if (/NOT_FOUND/.test(error.message)) throw new ApiError('NOT_FOUND', 404);
      if (/STATE_CONFLICT/.test(error.message)) throw new ApiError('STATE_CONFLICT', 409, error.message);
      throw internalError(BUNDLE, error);
    }
    return ok(await loadBillingReview(caller, params.id));
  });
}

export async function cancelBillingReview({ req, params }: RouteCtx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'threepl.billing_review.cancel');
  parseUuidParam(params.id);
  return respondWithIdempotency(req, caller, BUNDLE, '/billing-reviews/:id/cancel', null, async () => {
    const { error } = await admin().rpc('cancel_billing_review', {
      p_review_id: params.id,
      p_actor: caller.userId,
      p_caller_org_id: caller.orgId,
    });
    if (error) {
      if (/NOT_FOUND/.test(error.message)) throw new ApiError('NOT_FOUND', 404);
      if (/STATE_CONFLICT/.test(error.message)) throw new ApiError('STATE_CONFLICT', 409, error.message);
      throw internalError(BUNDLE, error);
    }
    return ok(await loadBillingReview(caller, params.id));
  });
}
