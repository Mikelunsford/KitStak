// finance-api local helpers. Re-exports the substrate the handlers reuse plus
// the finance-cap requireCap. Per-route gating on the
// `finance.journal_entries.enabled` flag uses the shared getFlag helper.

import { ApiError } from '../_shared/responses.ts';
import type { Caller } from '../_shared/tenant.ts';
import {
  FINANCE_CAPABILITY_POLICY,
  type FinanceCapability,
  type FinanceRoleCode,
} from '../_shared/capabilities/finance.ts';
import { getFlag } from '../_shared/feature-flags.ts';
import { ERROR_CODES, FEATURE_FLAGS } from '../_shared/constants.ts';

export function requireFinanceCap(
  caller: Caller,
  cap: FinanceCapability,
): void {
  const role = caller.role as unknown as FinanceRoleCode;
  if (FINANCE_CAPABILITY_POLICY[role]?.includes(cap)) return;
  throw new ApiError(ERROR_CODES.FORBIDDEN, 403, `caller lacks capability: ${cap}`);
}

/**
 * Require `finance.journal_entries.enabled` per-route gate. Returns 403
 * FEATURE_DISABLED with details.flag so the SPA can route to
 * /feature-unavailable. AUDIT-aligned per-route gate, not a bundle gate.
 */
export async function requireFinanceJeFlag(caller: Caller): Promise<void> {
  const flag = await getFlag(
    caller.orgId,
    FEATURE_FLAGS.FINANCE_JOURNAL_ENTRIES_ENABLED,
  );
  if (!flag.enabled) {
    throw new ApiError(
      ERROR_CODES.FEATURE_DISABLED,
      403,
      'finance journal entries feature is disabled for this org',
      { flag: FEATURE_FLAGS.FINANCE_JOURNAL_ENTRIES_ENABLED },
    );
  }
}

export const BUNDLE = 'finance-api';
