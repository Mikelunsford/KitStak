// feedback-admin-api local helpers (platform-staff, CROSS-TENANT surface).
//
// BUNDLE is the idempotency route-key namespace. assertPlatformStaff is the
// gate every mutating / cross-tenant read handler runs after requireCaller:
// it is the server authority for "is this caller a Kitstak operator". A
// non-staff caller is denied 403 FORBIDDEN. The check reads platform_staff
// directly through the service-role client (the table is RLS-locked for
// authenticated; only service_role and is_platform_staff() can see it).

import { admin } from '../_shared/handler-helpers.ts';
import { ApiError } from '../_shared/responses.ts';
import { ERROR_CODES } from '../_shared/constants.ts';
import type { Caller } from '../_shared/tenant.ts';

export const BUNDLE = 'feedback-admin-api';

/** True when the user has a platform_staff row. Never throws. */
export async function isPlatformStaff(userId: string): Promise<boolean> {
  const { data, error } = await admin()
    .from('platform_staff')
    .select('user_id')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) return false;
  return Boolean(data);
}

/**
 * Gate a handler on platform-staff membership. Throws 403 FORBIDDEN when the
 * caller is not on the operator allowlist. Every handler except GET / and
 * GET /me calls this immediately after requireCaller.
 */
export async function assertPlatformStaff(caller: Caller): Promise<void> {
  const ok = await isPlatformStaff(caller.userId);
  if (!ok) {
    throw new ApiError(ERROR_CODES.FORBIDDEN, 403, 'platform staff only');
  }
}
