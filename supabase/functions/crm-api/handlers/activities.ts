// crm-api activities handlers. Polymorphic log against customer / contact /
// lead / opportunity (entity_type + entity_id). Filterable by entity in list.

import type { RouteCtx } from '../../_shared/route.ts';
import { ApiError, ok } from '../../_shared/responses.ts';
import {
  admin,
  created,
  decodeCursor,
  paginate,
  parseBody,
  parseLimit,
  parseUuidParam,
  respondWithIdempotency,
} from '../../_shared/handler-helpers.ts';
import { requireCaller, type Caller } from '../../_shared/tenant.ts';
import { assertRefInOrg } from '../../_shared/crud.ts';
import {
  ActivityCreateSchema,
  ActivityPatchSchema,
  ActivitySchema,
  type Activity,
} from '../../_shared/types/crm.ts';
import { BUNDLE } from '../_helpers.ts';
import { requireCap } from '../../_shared/handler-helpers.ts';

// Polymorphic entity_type to table map for cross-tenant FK validation.
const ENTITY_TABLE: Record<string, string> = {
  customer: 'customers',
  contact: 'contacts',
  lead: 'leads',
  opportunity: 'opportunities',
};

const ACTIVITY_COLS =
  'id, org_id, entity_type, entity_id, kind, subject, body, status, ' +
  'due_at, completed_at, created_at, updated_at';

interface ActivityRow {
  id: string;
  org_id: string;
  entity_type: string;
  entity_id: string;
  kind: string;
  subject: string;
  body: string | null;
  status: string;
  due_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

function rowToActivity(row: ActivityRow): Activity {
  return ActivitySchema.parse(row);
}

async function fetchActivityRow(
  caller: Caller,
  id: string,
): Promise<ActivityRow> {
  const { data, error } = await admin()
    .from('activities')
    .select(ACTIVITY_COLS)
    .eq('id', id)
    .eq('org_id', caller.orgId)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) {
    throw new ApiError('INTERNAL_ERROR', 500, 'activity lookup failed', {
      detail: error.message,
    });
  }
  if (!data) throw new ApiError('NOT_FOUND', 404, 'activity not found');
  return data as ActivityRow;
}

export async function listActivities({ req, url }: RouteCtx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'crm.activities.read');

  const limit = parseLimit(url);
  const cursor = decodeCursor(url.searchParams.get('cursor'));
  const entityType = url.searchParams.get('entity_type');
  const entityId = url.searchParams.get('entity_id');
  const status = url.searchParams.get('status');

  let query = admin()
    .from('activities')
    .select(ACTIVITY_COLS)
    .eq('org_id', caller.orgId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1);

  if (entityType) query = query.eq('entity_type', entityType);
  if (entityId) query = query.eq('entity_id', entityId);
  if (status) query = query.eq('status', status);
  if (cursor) {
    query = query.or(
      `created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`,
    );
  }

  const { data, error } = await query;
  if (error) {
    throw new ApiError('INTERNAL_ERROR', 500, 'activity list failed', {
      detail: error.message,
    });
  }
  const rows = (data ?? []) as ActivityRow[];
  const { items, next_cursor } = paginate(rows, limit);
  return ok(items.map(rowToActivity), { next_cursor });
}

export async function getActivity({ req, params }: RouteCtx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'crm.activities.read');
  parseUuidParam(params.id);
  const row = await fetchActivityRow(caller, params.id);
  return ok(rowToActivity(row));
}

export async function createActivity({ req }: RouteCtx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'crm.activities.write');
  const body = await parseBody(req, ActivityCreateSchema);

  return respondWithIdempotency(req, caller, BUNDLE, 'POST /activities', body, async () => {
    // Polymorphic entity_id must reference a row in the caller's org. Map the
    // entity_type to its table, then verify before insert so a cross-tenant
    // reference returns 404 instead of persisting.
    const entityTable = ENTITY_TABLE[body.entity_type];
    if (!entityTable) {
      // Fail closed. An entity_type with no table mapping must never skip the
      // org-scope check, or a future enum value would persist an unvalidated
      // cross-tenant reference.
      throw new ApiError('VALIDATION_ERROR', 422, 'unknown entity_type');
    }
    await assertRefInOrg(entityTable, caller, body.entity_id);

    const insertRow = {
      org_id: caller.orgId,
      entity_type: body.entity_type,
      entity_id: body.entity_id,
      kind: body.kind,
      subject: body.subject,
      body: body.body ?? null,
      status: 'open',
      due_at: body.due_at ?? null,
      completed_at: body.completed_at ?? null,
      created_by: caller.userId,
      updated_by: caller.userId,
    };
    const { data, error } = await admin()
      .from('activities')
      .insert(insertRow)
      .select(ACTIVITY_COLS)
      .single();
    if (error || !data) {
      throw new ApiError('INTERNAL_ERROR', 500, 'activity insert failed', {
        detail: error?.message,
      });
    }
    return created(rowToActivity(data as ActivityRow));
  });
}

export async function patchActivity({ req, params }: RouteCtx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'crm.activities.write');
  parseUuidParam(params.id);
  const body = await parseBody(req, ActivityPatchSchema);

  return respondWithIdempotency(
    req,
    caller,
    BUNDLE,
    'PATCH /activities/:id',
    body,
    async () => {
      await fetchActivityRow(caller, params.id);
      const patch: Record<string, unknown> = { updated_by: caller.userId };
      if (body.subject !== undefined) patch.subject = body.subject;
      if (body.body !== undefined) patch.body = body.body ?? null;
      if (body.due_at !== undefined) patch.due_at = body.due_at ?? null;
      if (body.completed_at !== undefined) patch.completed_at = body.completed_at ?? null;
      if (body.status !== undefined) patch.status = body.status;

      const { data, error } = await admin()
        .from('activities')
        .update(patch)
        .eq('id', params.id)
        .eq('org_id', caller.orgId)
        .select(ACTIVITY_COLS)
        .single();
      if (error || !data) {
        throw new ApiError('INTERNAL_ERROR', 500, 'activity update failed', {
          detail: error?.message,
        });
      }
      return ok(rowToActivity(data as ActivityRow));
    },
  );
}
