// crm-api local helpers. Re-exports the substrate the handlers reuse plus
// a thin CRM-capability-aware requireCap wrapper. Keeps imports terse and
// lets the SPA-mirrored capability set stay isolated from the org-cap set.

import { ApiError } from '../_shared/responses.ts';
import type { Caller } from '../_shared/tenant.ts';
import {
  CRM_CAPABILITY_POLICY,
  type CrmCapability,
  type CrmRoleCode,
} from '../_shared/capabilities/crm.ts';

export function requireCrmCap(caller: Caller, cap: CrmCapability): void {
  const role = caller.role as unknown as CrmRoleCode;
  if (CRM_CAPABILITY_POLICY[role]?.includes(cap)) return;
  throw new ApiError('FORBIDDEN', 403, `caller lacks capability: ${cap}`);
}

export const BUNDLE = 'crm-api';
