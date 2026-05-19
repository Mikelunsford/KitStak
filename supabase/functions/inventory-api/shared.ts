// Shared helpers for the inventory-api bundle. Re-exports from
// _shared and the side-car cap canon.

import { ApiError, ok } from '../_shared/responses.ts';
import {
  admin, parseLimit, decodeCursor, encodeCursor, paginate, parseBody,
  parseUuidParam, respondWithIdempotency, created,
} from '../_shared/handler-helpers.ts';
import { requireCaller, type Caller } from '../_shared/tenant.ts';
import {
  hasVendorsInventoryOpsCap,
  type VendorsInventoryOpsCapability,
} from '../_shared/capabilities/vendors_inventory_ops.ts';

export {
  ApiError, ok, admin, parseLimit, decodeCursor, encodeCursor, paginate, parseBody,
  parseUuidParam, respondWithIdempotency, created, requireCaller,
};
export type { Caller };

/**
 * Variant of the canonical `paginate()` helper for tables that lack a
 * `created_at` column. `stock_levels` (migration 0030) ships only
 * `updated_at`, so its cursor payload is `(updated_at, id)`. The wire
 * cursor still uses the canonical `{ created_at, id }` shape from
 * `CursorPayload`; we just stuff the table's `updated_at` into the
 * `created_at` slot so the existing `decodeCursor` round-trips it
 * without a second cursor type. The opacity contract holds (the
 * client treats it as base64 blob), and the handler that decodes the
 * cursor on the next request knows to compare against `updated_at`.
 */
export function paginateByUpdatedAt<
  T extends { id: string; updated_at: string },
>(
  rows: T[],
  limit: number,
): { items: T[]; next_cursor: string | null } {
  if (rows.length <= limit) return { items: rows, next_cursor: null };
  const items = rows.slice(0, limit);
  const overflow = rows[limit];
  return {
    items,
    next_cursor: encodeCursor({
      created_at: overflow.updated_at,
      id: overflow.id,
    }),
  };
}

export function requireVioCap(
  caller: Caller,
  cap: VendorsInventoryOpsCapability,
): void {
  if (hasVendorsInventoryOpsCap(caller.role, cap)) return;
  throw new ApiError('FORBIDDEN', 403, `caller lacks capability: ${cap}`);
}
