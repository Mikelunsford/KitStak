// quotes-api local helpers. Same pattern as invoicing-api/_helpers.ts: thin
// wrapper that provides a sales-cap-aware requireCap. The capability set is
// held in _shared/capabilities/sales.ts (the byte-mirrored side-car canon);
// the org-cap set in _shared/capabilities.ts is left undisturbed.

import { ApiError } from '../_shared/responses.ts';
import type { Caller } from '../_shared/tenant.ts';
import {
  SALES_CAPABILITIES_BY_ROLE,
  type SalesCapability,
  type SalesRoleCode,
} from '../_shared/capabilities/sales.ts';

export function requireSalesCap(
  caller: Caller,
  cap: SalesCapability,
): void {
  const role = caller.role as unknown as SalesRoleCode;
  if (SALES_CAPABILITIES_BY_ROLE[role]?.includes(cap)) return;
  throw new ApiError('FORBIDDEN', 403, `caller lacks capability: ${cap}`);
}
