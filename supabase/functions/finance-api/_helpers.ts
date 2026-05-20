// finance-api local helpers. The per-bundle requireFinanceCap shim was
// retired at F-Wave2-AGENT-A-05; handlers now import requireCap directly
// from _shared/handler-helpers.ts. The per-route flag guard for
// `finance.journal_entries.enabled` stays here (still bundle-specific).

import { ApiError } from '../_shared/responses.ts';
import type { Caller } from '../_shared/tenant.ts';
import { getFlag } from '../_shared/feature-flags.ts';
import { ERROR_CODES, FEATURE_FLAGS } from '../_shared/constants.ts';

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
