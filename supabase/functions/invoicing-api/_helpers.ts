// invoicing-api local helpers. Thin wrapper that re-exports the substrate
// and provides a finance-cap-aware requireCap. The capability set is held in
// _shared/capabilities/finance.ts (the byte-mirrored side-car canon); the
// org-cap set in _shared/capabilities.ts is left undisturbed.

import { ApiError } from '../_shared/responses.ts';
import type { Caller } from '../_shared/tenant.ts';
import {
  FINANCE_CAPABILITY_POLICY,
  type FinanceCapability,
  type FinanceRoleCode,
} from '../_shared/capabilities/finance.ts';

export function requireFinanceCap(
  caller: Caller,
  cap: FinanceCapability,
): void {
  const role = caller.role as unknown as FinanceRoleCode;
  if (FINANCE_CAPABILITY_POLICY[role]?.includes(cap)) return;
  throw new ApiError('FORBIDDEN', 403, `caller lacks capability: ${cap}`);
}

export const BUNDLE = 'invoicing-api';
