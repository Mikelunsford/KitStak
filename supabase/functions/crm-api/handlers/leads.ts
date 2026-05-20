// crm-api leads handlers. State machine per workflow/crm.ts. Convert flow
// calls the public.convert_lead RPC, which is the only atomic path that
// inserts a customer + opportunity and stamps the lead under one transaction.

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
  LeadConvertResultSchema,
  LeadConvertSchema,
  LeadCreateSchema,
  LeadPatchSchema,
  LeadSchema,
  type Lead,
} from '../../_shared/types/crm.ts';
import {
  canCrmTransition,
  leadStateMachine,
  type LeadState,
} from '../../_shared/workflow/crm.ts';
import { BUNDLE } from '../_helpers.ts';
import { requireCap } from '../../_shared/handler-helpers.ts';

const LEAD_COLS =
  'id, org_id, display_name, company_name, source, status, primary_email, ' +
  'primary_phone, owner_user_id, estimated_value_cents, currency_code, ' +
  'converted_customer_id, converted_opportunity_id, converted_at, notes, ' +
  'created_at, updated_at';

interface LeadRow {
  id: string;
  org_id: string;
  display_name: string;
  company_name: string | null;
  source: string | null;
  status: LeadState;
  primary_email: string | null;
  primary_phone: string | null;
  owner_user_id: string | null;
  estimated_value_cents: number;
  currency_code: string | null;
  converted_customer_id: string | null;
  converted_opportunity_id: string | null;
  converted_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

function rowToLead(row: LeadRow): Lead {
  return LeadSchema.parse(row);
}

async function fetchLeadRow(caller: Caller, id: string): Promise<LeadRow> {
  const { data, error } = await admin()
    .from('leads')
    .select(LEAD_COLS)
    .eq('id', id)
    .eq('org_id', caller.orgId)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) {
    throw new ApiError('INTERNAL_ERROR', 500, 'lead lookup failed', {
      detail: error.message,
    });
  }
  if (!data) throw new ApiError('NOT_FOUND', 404, 'lead not found');
  return data as LeadRow;
}

export async function listLeads({ req, url }: RouteCtx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'crm.leads.read');

  const limit = parseLimit(url);
  const cursor = decodeCursor(url.searchParams.get('cursor'));
  const status = url.searchParams.get('status');
  const owner = url.searchParams.get('owner_user_id');
  const q = url.searchParams.get('q');

  let query = admin()
    .from('leads')
    .select(LEAD_COLS)
    .eq('org_id', caller.orgId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1);

  if (status) query = query.eq('status', status);
  if (owner) query = query.eq('owner_user_id', owner);
  if (q) query = query.ilike('display_name', `%${q}%`);
  if (cursor) {
    query = query.or(
      `created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`,
    );
  }

  const { data, error } = await query;
  if (error) {
    throw new ApiError('INTERNAL_ERROR', 500, 'lead list failed', {
      detail: error.message,
    });
  }
  const rows = (data ?? []) as LeadRow[];
  const { items, next_cursor } = paginate(rows, limit);
  return ok(items.map(rowToLead), { next_cursor });
}

export async function getLead({ req, params }: RouteCtx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'crm.leads.read');
  parseUuidParam(params.id);
  const row = await fetchLeadRow(caller, params.id);
  return ok(rowToLead(row));
}

export async function createLead({ req }: RouteCtx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'crm.leads.write');
  const body = await parseBody(req, LeadCreateSchema);

  return respondWithIdempotency(req, caller, BUNDLE, 'POST /leads', body, async () => {
    const insertRow = {
      org_id: caller.orgId,
      display_name: body.display_name,
      company_name: body.company_name ?? null,
      source: body.source,
      status: body.status,
      primary_email: body.primary_email ?? null,
      primary_phone: body.primary_phone ?? null,
      owner_user_id: body.owner_user_id ?? null,
      estimated_value_cents: body.estimated_value_cents,
      currency_code: body.currency_code ?? null,
      notes: body.notes ?? null,
      created_by: caller.userId,
      updated_by: caller.userId,
    };
    const { data, error } = await admin()
      .from('leads')
      .insert(insertRow)
      .select(LEAD_COLS)
      .single();
    if (error || !data) {
      throw new ApiError('INTERNAL_ERROR', 500, 'lead insert failed', {
        detail: error?.message,
      });
    }
    return created(rowToLead(data as LeadRow));
  });
}

export async function patchLead({ req, params }: RouteCtx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'crm.leads.write');
  parseUuidParam(params.id);
  const body = await parseBody(req, LeadPatchSchema);

  return respondWithIdempotency(
    req,
    caller,
    BUNDLE,
    'PATCH /leads/:id',
    body,
    async () => {
      const before = await fetchLeadRow(caller, params.id);

      // If status changes, validate against the FSM. The DB trigger is still
      // authority; this is the early-return path that yields 409 instead of
      // a CHECK failure surfacing as 500.
      if (body.status !== undefined && body.status !== before.status) {
        if (!canCrmTransition(leadStateMachine, before.status, body.status as LeadState)) {
          throw new ApiError(
            'STATE_CONFLICT',
            409,
            `illegal lead transition ${before.status} -> ${body.status}`,
          );
        }
        // Convert is gated by the dedicated endpoint; refuse it here.
        if (body.status === 'converted') {
          throw new ApiError(
            'STATE_CONFLICT',
            409,
            'use POST /leads/:id/convert to convert a lead',
          );
        }
      }

      const patch: Record<string, unknown> = { updated_by: caller.userId };
      if (body.display_name !== undefined) patch.display_name = body.display_name;
      if (body.company_name !== undefined) patch.company_name = body.company_name ?? null;
      if (body.source !== undefined) patch.source = body.source;
      if (body.status !== undefined) patch.status = body.status;
      if (body.primary_email !== undefined) patch.primary_email = body.primary_email ?? null;
      if (body.primary_phone !== undefined) patch.primary_phone = body.primary_phone ?? null;
      if (body.owner_user_id !== undefined) patch.owner_user_id = body.owner_user_id ?? null;
      if (body.estimated_value_cents !== undefined) {
        patch.estimated_value_cents = body.estimated_value_cents;
      }
      if (body.currency_code !== undefined) patch.currency_code = body.currency_code ?? null;
      if (body.notes !== undefined) patch.notes = body.notes ?? null;

      const { data, error } = await admin()
        .from('leads')
        .update(patch)
        .eq('id', params.id)
        .eq('org_id', caller.orgId)
        .select(LEAD_COLS)
        .single();
      if (error || !data) {
        throw new ApiError('INTERNAL_ERROR', 500, 'lead update failed', {
          detail: error?.message,
        });
      }
      return ok(rowToLead(data as LeadRow));
    },
  );
}

export async function convertLead({ req, params }: RouteCtx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'crm.leads.convert');
  parseUuidParam(params.id);
  const body = await parseBody(req, LeadConvertSchema);

  return respondWithIdempotency(
    req,
    caller,
    BUNDLE,
    'POST /leads/:id/convert',
    body,
    async () => {
      // Confirm the lead is visible before invoking the RPC so an unknown id
      // returns 404 instead of the SECURITY DEFINER raise mapping to 500.
      await fetchLeadRow(caller, params.id);

      const { data, error } = await admin().rpc('convert_lead', {
        p_lead_id: params.id,
        p_customer_payload: {
          create_customer: body.create_customer,
          customer_id: body.customer_id ?? null,
        },
        p_opp_payload: {
          display_name: body.opportunity_name,
          amount_cents: body.opportunity_amount_cents,
          currency_code: body.opportunity_currency_code ?? null,
        },
        p_actor_user_id: caller.userId,
      });
      if (error) {
        // Best-effort mapping of the function-raised errcodes back to API codes.
        const msg = error.message ?? 'lead convert failed';
        if (msg.includes('STATE_CONFLICT') || msg.includes('already converted')) {
          throw new ApiError('STATE_CONFLICT', 409, msg);
        }
        if (msg.includes('VALIDATION_ERROR')) {
          throw new ApiError('VALIDATION_ERROR', 422, msg);
        }
        if (msg.includes('NOT_FOUND')) {
          throw new ApiError('NOT_FOUND', 404, msg);
        }
        throw new ApiError('INTERNAL_ERROR', 500, msg);
      }
      const result = LeadConvertResultSchema.parse(data);
      return ok(result);
    },
  );
}
