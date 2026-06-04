// crm-api contacts handlers. Scoped by customer_id query param for list;
// detail/patch/delete operate by contact id under tenant scope.

import type { RouteCtx } from '../../_shared/route.ts';
import { ApiError, ok, noContent } from '../../_shared/responses.ts';
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
import {
  ContactCreateSchema,
  ContactPatchSchema,
  ContactSchema,
  type Contact,
} from '../../_shared/types/crm.ts';
import { BUNDLE } from '../_helpers.ts';
import { requireCap } from '../../_shared/handler-helpers.ts';

const CONTACT_COLS =
  'id, org_id, customer_id, first_name, last_name, email, phone, title, ' +
  'is_primary, is_active, created_at, updated_at';

interface ContactRow {
  id: string;
  org_id: string;
  customer_id: string;
  first_name: string;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  title: string | null;
  is_primary: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

function rowToContact(row: ContactRow): Contact {
  return ContactSchema.parse(row);
}

async function fetchContactRow(caller: Caller, id: string): Promise<ContactRow> {
  const { data, error } = await admin()
    .from('contacts')
    .select(CONTACT_COLS)
    .eq('id', id)
    .eq('org_id', caller.orgId)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) {
    throw new ApiError('INTERNAL_ERROR', 500, 'contact lookup failed', {
      detail: error.message,
    });
  }
  if (!data) throw new ApiError('NOT_FOUND', 404, 'contact not found');
  return data as unknown as ContactRow;
}

export async function listContacts({ req, url }: RouteCtx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'crm.contacts.read');

  const limit = parseLimit(url);
  const cursor = decodeCursor(url.searchParams.get('cursor'));
  const customerId = url.searchParams.get('customer_id');
  const q = url.searchParams.get('q');

  let query = admin()
    .from('contacts')
    .select(CONTACT_COLS)
    .eq('org_id', caller.orgId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1);

  if (customerId) query = query.eq('customer_id', customerId);
  if (q) query = query.ilike('first_name', `%${q}%`);
  if (cursor) {
    query = query.or(
      `created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`,
    );
  }

  const { data, error } = await query;
  if (error) {
    throw new ApiError('INTERNAL_ERROR', 500, 'contact list failed', {
      detail: error.message,
    });
  }
  const rows = (data ?? []) as unknown as ContactRow[];
  const { items, next_cursor } = paginate(rows, limit);
  return ok(items.map(rowToContact), { next_cursor });
}

export async function getContact({ req, params }: RouteCtx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'crm.contacts.read');
  parseUuidParam(params.id);
  const row = await fetchContactRow(caller, params.id);
  return ok(rowToContact(row));
}

export async function createContact({ req }: RouteCtx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'crm.contacts.write');
  const body = await parseBody(req, ContactCreateSchema);

  return respondWithIdempotency(req, caller, BUNDLE, 'POST /contacts', body, async () => {
    // Confirm the customer is in tenant and not deleted; otherwise return 404
    // rather than leaking the FK failure.
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
      first_name: body.first_name,
      last_name: body.last_name ?? null,
      email: body.email ?? null,
      phone: body.phone ?? null,
      title: body.title ?? null,
      is_primary: body.is_primary ?? false,
      created_by: caller.userId,
      updated_by: caller.userId,
    };
    const { data, error } = await admin()
      .from('contacts')
      .insert(insertRow)
      .select(CONTACT_COLS)
      .single();
    if (error || !data) {
      throw new ApiError('INTERNAL_ERROR', 500, 'contact insert failed', {
        detail: error?.message,
      });
    }
    return created(rowToContact(data as unknown as ContactRow));
  });
}

export async function patchContact({ req, params }: RouteCtx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'crm.contacts.write');
  parseUuidParam(params.id);
  const body = await parseBody(req, ContactPatchSchema);

  return respondWithIdempotency(
    req,
    caller,
    BUNDLE,
    'PATCH /contacts/:id',
    body,
    async () => {
      await fetchContactRow(caller, params.id);
      const patch: Record<string, unknown> = { updated_by: caller.userId };
      if (body.first_name !== undefined) patch.first_name = body.first_name;
      if (body.last_name !== undefined) patch.last_name = body.last_name ?? null;
      if (body.email !== undefined) patch.email = body.email ?? null;
      if (body.phone !== undefined) patch.phone = body.phone ?? null;
      if (body.title !== undefined) patch.title = body.title ?? null;
      if (body.is_primary !== undefined) patch.is_primary = body.is_primary;

      const { data, error } = await admin()
        .from('contacts')
        .update(patch)
        .eq('id', params.id)
        .eq('org_id', caller.orgId)
        .select(CONTACT_COLS)
        .single();
      if (error || !data) {
        throw new ApiError('INTERNAL_ERROR', 500, 'contact update failed', {
          detail: error?.message,
        });
      }
      return ok(rowToContact(data as unknown as ContactRow));
    },
  );
}

export async function deleteContact({ req, params }: RouteCtx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'crm.contacts.delete');
  parseUuidParam(params.id);

  return respondWithIdempotency(
    req,
    caller,
    BUNDLE,
    'DELETE /contacts/:id',
    { id: params.id },
    async () => {
      await fetchContactRow(caller, params.id);
      const { error } = await admin()
        .from('contacts')
        .update({ deleted_at: new Date().toISOString(), updated_by: caller.userId })
        .eq('id', params.id)
        .eq('org_id', caller.orgId);
      if (error) {
        throw new ApiError('INTERNAL_ERROR', 500, 'contact delete failed', {
          detail: error.message,
        });
      }
      return noContent();
    },
  );
}
