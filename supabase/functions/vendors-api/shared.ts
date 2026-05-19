// Shared helpers for the vendors-api bundle.
// All handlers route through requireCaller -> requireVioCap -> admin().

import { ApiError, ok } from '../_shared/responses.ts';
import { admin, parseLimit, decodeCursor, paginate, parseBody, parseUuidParam, respondWithIdempotency, created } from '../_shared/handler-helpers.ts';
import { requireCaller, type Caller } from '../_shared/tenant.ts';
import {
  hasVendorsInventoryOpsCap,
  type VendorsInventoryOpsCapability,
} from '../_shared/capabilities/vendors_inventory_ops.ts';
import {
  canTransitionVio,
  type Fsm,
} from '../_shared/workflow/vendors_inventory_ops.ts';

export {
  ApiError, ok, admin, parseLimit, decodeCursor, paginate, parseBody,
  parseUuidParam, respondWithIdempotency, created, requireCaller,
};
export type { Caller };

/**
 * Capability check at handler entry for vendors/inventory/ops side-car caps.
 * Throws FORBIDDEN 403 when the caller lacks the cap.
 */
export function requireVioCap(
  caller: Caller,
  cap: VendorsInventoryOpsCapability,
): void {
  if (hasVendorsInventoryOpsCap(caller.role, cap)) return;
  throw new ApiError('FORBIDDEN', 403, `caller lacks capability: ${cap}`);
}

/**
 * Guarded state transition. Throws STATE_CONFLICT 409 when the FSM does not
 * declare from -> to. The DB CHECK is the second backstop.
 */
export function assertTransition<S extends string>(
  fsm: Fsm<S>,
  from: S,
  to: S,
): void {
  if (!canTransitionVio(fsm, from, to)) {
    throw new ApiError(
      'STATE_CONFLICT',
      409,
      `illegal ${fsm.entity} transition: ${from} -> ${to}`,
    );
  }
}

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
    throw new ApiError('INTERNAL_ERROR', 500, error.message);
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
    throw new ApiError('INTERNAL_ERROR', 500, error.message);
  }
  if (!data) {
    throw new ApiError('NOT_FOUND', 404);
  }
  return data as T;
}
