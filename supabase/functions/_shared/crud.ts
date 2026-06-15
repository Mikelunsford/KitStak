// Shared tenant-scoped CRUD read helpers (E6, F-Wave10-REVIEW-REMEDIATION).
//
// Promoted from vendors-api/shared.ts so other bundles can reuse the same
// Pattern A read shape without copy-pasting. vendors-api/shared.ts re-exports
// these so its bundle keeps working unchanged. A broader call-site migration
// across every bundle is tracked as a follow-up; this pass only relocates.
//
// RLS posture: service-role bypasses RLS, so every query here combines an
// explicit `.eq('org_id', caller.orgId)` filter (Pattern A) per the
// constitution. The capability check (requireCap) is the per-route authority
// and is enforced by the calling handler, not these helpers.

import { ApiError, internalError } from './responses.ts';
import { admin, parseLimit, decodeCursor, paginate } from './handler-helpers.ts';
import type { Caller } from './tenant.ts';

/**
 * Cursor-paginated list over a tenant-scoped table. Order by
 * (created_at desc, id desc). Returns canonical { items, next_cursor }.
 */
export async function listOrgScoped<T extends { id: string; created_at: string }>(
  table: string,
  caller: Caller,
  url: URL,
  options: {
    select?: string;
    filters?: Array<[string, string, string]>;
    softDelete?: boolean;
  } = {},
): Promise<{ items: T[]; next_cursor: string | null }> {
  const limit = parseLimit(url);
  const cursor = decodeCursor(url.searchParams.get('cursor'));
  const select = options.select ?? '*';

  let q = admin()
    .from(table)
    .select(select)
    .eq('org_id', caller.orgId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1);

  if (options.softDelete !== false) {
    q = q.is('deleted_at', null);
  }
  for (const [col, op, val] of options.filters ?? []) {
    if (op === 'eq') q = q.eq(col, val);
    else if (op === 'ilike') q = q.ilike(col, val);
  }
  if (cursor) {
    q = q.lt('created_at', cursor.created_at);
  }

  const { data, error } = await q;
  if (error) {
    throw internalError(`crud:listOrgScoped:${table}`, error);
  }
  return paginate<T>((data ?? []) as unknown as T[], limit);
}

export async function getByIdOrgScoped<T>(
  table: string,
  caller: Caller,
  id: string,
  select = '*',
): Promise<T> {
  const { data, error } = await admin()
    .from(table)
    .select(select)
    .eq('org_id', caller.orgId)
    .eq('id', id)
    .maybeSingle();
  if (error) {
    throw internalError(`crud:getByIdOrgScoped:${table}`, error);
  }
  if (!data) {
    throw new ApiError('NOT_FOUND', 404);
  }
  return data as T;
}

/**
 * Assert a client-supplied foreign-key id references a row in the caller's
 * org, before a write persists that reference. Defense-in-depth for Pattern
 * A: a service-role insert or update can otherwise store a cross-tenant
 * foreign key, because every FK constraint in this schema is a plain
 * single-column reference that checks existence, not org.
 *
 * Throws NOT_FOUND (404) when the referenced row is absent or belongs to
 * another org. That is the constitutional answer for a cross-tenant
 * reference on a write (never 403). The same 404 covers "does not exist" and
 * "exists in another org", so it leaks no cross-tenant existence oracle.
 *
 * `column` overrides the matched column for references that point at a
 * non-id column (for example org_memberships.user_id). Soft-deleted parents
 * are rejected by default (a `deleted_at is null` filter). Pass
 * `softDelete: false` for the parent tables with no `deleted_at` column
 * (chart_of_accounts, expense_categories, org_memberships, journal_entries),
 * otherwise the filter errors at the database.
 */
export async function assertRefInOrg(
  table: string,
  caller: Caller,
  id: string,
  options: { column?: string; softDelete?: boolean } = {},
): Promise<void> {
  const column = options.column ?? 'id';
  let q = admin()
    .from(table)
    .select(column)
    .eq('org_id', caller.orgId)
    .eq(column, id);
  if (options.softDelete !== false) {
    q = q.is('deleted_at', null);
  }
  const { data, error } = await q.limit(1);
  if (error) {
    throw internalError(`crud:assertRefInOrg:${table}`, error);
  }
  if (!data || data.length === 0) {
    throw new ApiError('NOT_FOUND', 404, `referenced ${table} not found in org`);
  }
}

/**
 * Assert a client-supplied lot_id references an in-org lot that is bound to the
 * SAME item the lot is being attached to. A lot is bound to exactly one item
 * (lots.item_id is NOT NULL), so a lot_id on a receiving line or putaway task
 * whose lot.item_id differs from the line / task item_id is incoherent: it would
 * credit a lot-keyed bin row for the wrong item. This is the server-side
 * authority for the cross-item lot guard.
 *
 * Org-scoped admin select of lots (id, item_id) filtered to non-soft-deleted
 * rows. Throws NOT_FOUND (404) when the lot is missing, soft-deleted,
 * cross-tenant, OR its item_id does not match `itemId`. 404 (never 403) is the
 * constitutional answer for an out-of-scope reference on a write, and the single
 * envelope covers "does not exist", "another org", and "wrong item" so it leaks
 * no cross-tenant or cross-item existence oracle. Mirrors assertRefInOrg.
 */
export async function assertLotForItem(
  caller: Caller,
  lotId: string,
  itemId: string,
): Promise<void> {
  const { data, error } = await admin()
    .from('lots')
    .select('id, item_id')
    .eq('org_id', caller.orgId)
    .eq('id', lotId)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) {
    throw internalError('crud:assertLotForItem:lots', error);
  }
  if (!data || (data as { item_id: string }).item_id !== itemId) {
    throw new ApiError('NOT_FOUND', 404, 'referenced lot not found for this item');
  }
}

/**
 * Batch variant of assertRefInOrg. Verifies that every id in `ids` references a
 * row in the caller's org with a single `where in (...)` query instead of one
 * round-trip per id. Throws NOT_FOUND (404) if any distinct non-null id is
 * missing. `column` and `softDelete` behave as in assertRefInOrg.
 */
export async function assertRefsInOrg(
  table: string,
  caller: Caller,
  ids: ReadonlyArray<string>,
  options: { column?: string; softDelete?: boolean } = {},
): Promise<void> {
  const column = options.column ?? 'id';
  const distinct = [
    ...new Set(ids.filter((v) => typeof v === 'string' && v.length > 0)),
  ];
  if (distinct.length === 0) return;
  let q = admin()
    .from(table)
    .select(column)
    .eq('org_id', caller.orgId)
    .in(column, distinct);
  if (options.softDelete !== false) {
    q = q.is('deleted_at', null);
  }
  const { data, error } = await q;
  if (error) {
    throw internalError(`crud:assertRefsInOrg:${table}`, error);
  }
  const found = new Set(
    (data ?? []).map((r) => (r as unknown as Record<string, unknown>)[column]),
  );
  for (const id of distinct) {
    if (!found.has(id)) {
      throw new ApiError('NOT_FOUND', 404, `referenced ${table} not found in org`);
    }
  }
}
