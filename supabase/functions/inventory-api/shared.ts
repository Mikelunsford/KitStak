// Shared helpers for the inventory-api bundle. Re-exports from
// _shared and the side-car cap canon.

import { ApiError, ok } from '../_shared/responses.ts';
import {
  admin, parseLimit, decodeCursor, paginate, parseBody,
  respondWithIdempotency, created,
} from '../_shared/handler-helpers.ts';
import { requireCaller, type Caller } from '../_shared/tenant.ts';
import {
  hasVendorsInventoryOpsCap,
  type VendorsInventoryOpsCapability,
} from '../_shared/capabilities/vendors_inventory_ops.ts';

export {
  ApiError, ok, admin, parseLimit, decodeCursor, paginate, parseBody,
  respondWithIdempotency, created, requireCaller,
};
export type { Caller };

export function requireVioCap(
  caller: Caller,
  cap: VendorsInventoryOpsCapability,
): void {
  if (hasVendorsInventoryOpsCap(caller.role, cap)) return;
  throw new ApiError('FORBIDDEN', 403, `caller lacks capability: ${cap}`);
}
