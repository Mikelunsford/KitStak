// three-pl-api accounts handlers. three_pl_accounts (parent; active / inactive
// flag, no rich FSM) plus account_service_definitions (per-account Rate Card
// overlay). Handler bodies moved verbatim from the former monolithic index.ts
// during the R-W13-DX-01 structural split; no behaviour change.

import type { RouteCtx } from '../../_shared/route.ts';
import { ApiError, ok, internalError } from '../../_shared/responses.ts';
import {
  admin, parseBody, parseUuidParam, respondWithIdempotency, created, requireCap,
} from '../../_shared/handler-helpers.ts';
import { requireCaller } from '../../_shared/tenant.ts';
import { assertRefInOrg } from '../../_shared/crud.ts';
import { nextDocNumber } from '../../_shared/numbering.ts';
import {
  ThreePlAccountSchema,
  ThreePlAccountCreateSchema,
  ThreePlAccountPatchSchema,
  AccountServiceDefinitionSchema,
  AccountServiceDefinitionCreateSchema,
  AccountServiceDefinitionUpdateSchema,
} from '../../_shared/types/threepl.ts';
import {
  BUNDLE, nowIso, loadAccount, assertAccountParent, nextServicePosition,
} from './_helpers.ts';

export async function listAccounts({ req, url }: RouteCtx): Promise<Response> {
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
}

export async function createAccount({ req }: RouteCtx): Promise<Response> {
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
}

export async function getAccount({ req, params }: RouteCtx): Promise<Response> {
  const caller = requireCaller(req);
  parseUuidParam(params.id);
  const row = await loadAccount(caller, params.id);
  return ok(row);
}

export async function patchAccount({ req, params }: RouteCtx): Promise<Response> {
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
}

export async function deleteAccount({ req, params }: RouteCtx): Promise<Response> {
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
}

export async function deactivateAccount({ req, params }: RouteCtx): Promise<Response> {
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
}

export async function reactivateAccount({ req, params }: RouteCtx): Promise<Response> {
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
}

// ---------------------------------------------------------------------------
// account_service_definitions (per-account Rate Card overlay)
// ---------------------------------------------------------------------------

export async function listAccountServices({ req, params }: RouteCtx): Promise<Response> {
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
}

export async function createAccountService({ req, params }: RouteCtx): Promise<Response> {
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
}

export async function patchAccountService({ req, params }: RouteCtx): Promise<Response> {
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
}

export async function deleteAccountService({ req, params }: RouteCtx): Promise<Response> {
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
}
