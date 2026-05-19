// crm-api opportunities handlers. Stage machine per workflow/crm.ts; the
// dedicated transition endpoint runs canTransition before the UPDATE so
// illegal moves return 409 instead of triggering the DB CHECK constraint.

import type { RouteCtx } from '../../_shared/route.ts';
import { ApiError, ok, created } from '../../_shared/responses.ts';
import {
  admin,
  decodeCursor,
  paginate,
  parseBody,
  parseLimit,
  parseUuidParam,
  respondWithIdempotency,
} from '../../_shared/handler-helpers.ts';
import { requireCaller, type Caller } from '../../_shared/tenant.ts';
import {
  OpportunityCreateSchema,
  OpportunityPatchSchema,
  OpportunitySchema,
  OpportunityStageTransitionSchema,
  type Opportunity,
} from '../../_shared/types/crm.ts';
import {
  canCrmTransition,
  opportunityStageMachine,
  type OpportunityStageState,
} from '../../_shared/workflow/crm.ts';
import { requireCrmCap, BUNDLE } from '../_helpers.ts';

const OPP_COLS =
  'id, org_id, customer_id, lead_id, display_name, stage, amount_cents, ' +
  'currency_code, probability_pct, expected_close_date, closed_at, ' +
  'close_reason, owner_user_id, notes, created_at, updated_at';

interface OpportunityRow {
  id: string;
  org_id: string;
  customer_id: string;
  lead_id: string | null;
  display_name: string;
  stage: OpportunityStageState;
  amount_cents: number;
  currency_code: string | null;
  probability_pct: number;
  expected_close_date: string | null;
  closed_at: string | null;
  close_reason: string | null;
  owner_user_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

function rowToOpportunity(row: OpportunityRow): Opportunity {
  return OpportunitySchema.parse(row);
}

async function fetchOpportunityRow(
  caller: Caller,
  id: string,
): Promise<OpportunityRow> {
  const { data, error } = await admin()
    .from('opportunities')
    .select(OPP_COLS)
    .eq('id', id)
    .eq('org_id', caller.orgId)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) {
    throw new ApiError('INTERNAL_ERROR', 500, 'opportunity lookup failed', {
      detail: error.message,
    });
  }
  if (!data) throw new ApiError('NOT_FOUND', 404, 'opportunity not found');
  return data as OpportunityRow;
}

export async function listOpportunities({ req, url }: RouteCtx): Promise<Response> {
  const caller = requireCaller(req);
  requireCrmCap(caller, 'crm.opportunities.read');

  const limit = parseLimit(url);
  const cursor = decodeCursor(url.searchParams.get('cursor'));
  const stage = url.searchParams.get('stage');
  const customerId = url.searchParams.get('customer_id');
  const owner = url.searchParams.get('owner_user_id');

  let query = admin()
    .from('opportunities')
    .select(OPP_COLS)
    .eq('org_id', caller.orgId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1);

  if (stage) query = query.eq('stage', stage);
  if (customerId) query = query.eq('customer_id', customerId);
  if (owner) query = query.eq('owner_user_id', owner);
  if (cursor) {
    query = query.or(
      `created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`,
    );
  }

  const { data, error } = await query;
  if (error) {
    throw new ApiError('INTERNAL_ERROR', 500, 'opportunity list failed', {
      detail: error.message,
    });
  }
  const rows = (data ?? []) as OpportunityRow[];
  const { items, next_cursor } = paginate(rows, limit);
  return ok(items.map(rowToOpportunity), { next_cursor });
}

export async function getOpportunity({ req, params }: RouteCtx): Promise<Response> {
  const caller = requireCaller(req);
  requireCrmCap(caller, 'crm.opportunities.read');
  parseUuidParam(params.id);
  const row = await fetchOpportunityRow(caller, params.id);
  return ok(rowToOpportunity(row));
}

export async function createOpportunity({ req }: RouteCtx): Promise<Response> {
  const caller = requireCaller(req);
  requireCrmCap(caller, 'crm.opportunities.write');
  const body = await parseBody(req, OpportunityCreateSchema);

  return respondWithIdempotency(req, caller, BUNDLE, 'POST /opportunities', body, async () => {
    // Confirm the customer is in tenant before insert; FK failure otherwise
    // surfaces as 500. RLS already constrains, but we want 404 not 500.
    const { data: parent, error: parentErr } = await admin()
      .from('customers')
      .select('id')
      .eq('id', body.customer_id)
      .eq('org_id', caller.orgId)
      .is('deleted_at', null)
      .maybeSingle();
    if (parentErr) {
      throw new ApiError('INTERNAL_ERROR', 500, 'customer lookup failed', {
        detail: parentErr.message,
      });
    }
    if (!parent) throw new ApiError('NOT_FOUND', 404, 'customer not found');

    const insertRow = {
      org_id: caller.orgId,
      customer_id: body.customer_id,
      lead_id: body.lead_id ?? null,
      display_name: body.display_name,
      stage: body.stage,
      amount_cents: body.amount_cents,
      currency_code: body.currency_code,
      probability_pct: body.probability_pct,
      expected_close_date: body.expected_close_date ?? null,
      owner_user_id: body.owner_user_id ?? null,
      notes: body.notes ?? null,
      created_by: caller.userId,
      updated_by: caller.userId,
    };
    const { data, error } = await admin()
      .from('opportunities')
      .insert(insertRow)
      .select(OPP_COLS)
      .single();
    if (error || !data) {
      throw new ApiError('INTERNAL_ERROR', 500, 'opportunity insert failed', {
        detail: error?.message,
      });
    }
    return created(rowToOpportunity(data as OpportunityRow));
  });
}

export async function patchOpportunity({ req, params }: RouteCtx): Promise<Response> {
  const caller = requireCaller(req);
  requireCrmCap(caller, 'crm.opportunities.write');
  parseUuidParam(params.id);
  const body = await parseBody(req, OpportunityPatchSchema);

  return respondWithIdempotency(
    req,
    caller,
    BUNDLE,
    'PATCH /opportunities/:id',
    body,
    async () => {
      const before = await fetchOpportunityRow(caller, params.id);

      // Stage moves go through the dedicated transition endpoint so the FSM
      // validation lives in one place. A PATCH that includes `stage` is
      // refused with STATE_CONFLICT rather than silently bypassing.
      if (body.stage !== undefined && body.stage !== before.stage) {
        throw new ApiError(
          'STATE_CONFLICT',
          409,
          'use POST /opportunities/:id/transition to change stage',
        );
      }

      const patch: Record<string, unknown> = { updated_by: caller.userId };
      if (body.customer_id !== undefined) patch.customer_id = body.customer_id;
      if (body.lead_id !== undefined) patch.lead_id = body.lead_id ?? null;
      if (body.display_name !== undefined) patch.display_name = body.display_name;
      if (body.amount_cents !== undefined) patch.amount_cents = body.amount_cents;
      if (body.currency_code !== undefined) patch.currency_code = body.currency_code;
      if (body.probability_pct !== undefined) patch.probability_pct = body.probability_pct;
      if (body.expected_close_date !== undefined) {
        patch.expected_close_date = body.expected_close_date ?? null;
      }
      if (body.owner_user_id !== undefined) patch.owner_user_id = body.owner_user_id ?? null;
      if (body.notes !== undefined) patch.notes = body.notes ?? null;

      const { data, error } = await admin()
        .from('opportunities')
        .update(patch)
        .eq('id', params.id)
        .eq('org_id', caller.orgId)
        .select(OPP_COLS)
        .single();
      if (error || !data) {
        throw new ApiError('INTERNAL_ERROR', 500, 'opportunity update failed', {
          detail: error?.message,
        });
      }
      return ok(rowToOpportunity(data as OpportunityRow));
    },
  );
}

export async function transitionOpportunityStage(
  { req, params }: RouteCtx,
): Promise<Response> {
  const caller = requireCaller(req);
  requireCrmCap(caller, 'crm.opportunities.stage.transition');
  parseUuidParam(params.id);
  const body = await parseBody(req, OpportunityStageTransitionSchema);

  return respondWithIdempotency(
    req,
    caller,
    BUNDLE,
    'POST /opportunities/:id/transition',
    body,
    async () => {
      const before = await fetchOpportunityRow(caller, params.id);
      if (body.stage === before.stage) {
        // Idempotent no-op return the current row.
        return ok(rowToOpportunity(before));
      }
      if (!canCrmTransition(opportunityStageMachine, before.stage, body.stage)) {
        throw new ApiError(
          'STATE_CONFLICT',
          409,
          `illegal opportunity transition ${before.stage} -> ${body.stage}`,
        );
      }

      const patch: Record<string, unknown> = {
        stage: body.stage,
        updated_by: caller.userId,
      };
      if (body.close_reason !== undefined) patch.close_reason = body.close_reason ?? null;
      if (body.stage === 'closed_won' || body.stage === 'closed_lost') {
        patch.closed_at = new Date().toISOString();
      }

      const { data, error } = await admin()
        .from('opportunities')
        .update(patch)
        .eq('id', params.id)
        .eq('org_id', caller.orgId)
        .select(OPP_COLS)
        .single();
      if (error || !data) {
        throw new ApiError('INTERNAL_ERROR', 500, 'opportunity transition failed', {
          detail: error?.message,
        });
      }
      return ok(rowToOpportunity(data as OpportunityRow));
    },
  );
}
