// Shared helpers for the inventory-api bundle. Re-exports from _shared.
// The per-bundle requireVioCap shim was retired at F-Wave2-AGENT-A-05;
// handlers now use requireCap from the singular handler-helpers module.

import {
  admin, parseLimit, decodeCursor, encodeCursor, paginate, parseBody,
  parseUuidParam, respondWithIdempotency, created, requireCap,
} from '../_shared/handler-helpers.ts';
import { ApiError, ok, internalError } from '../_shared/responses.ts';
import { requireCaller, type Caller } from '../_shared/tenant.ts';
import { assertRefInOrg } from '../_shared/crud.ts';

export {
  ApiError, ok, admin, parseLimit, decodeCursor, encodeCursor, paginate, parseBody,
  parseUuidParam, respondWithIdempotency, created, requireCaller, requireCap,
  internalError, assertRefInOrg,
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

