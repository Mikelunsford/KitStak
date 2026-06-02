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
  return paginate<T>((data ?? []) as T[], limit);
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
