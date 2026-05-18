// Per-route feature flag guard.
//
// Gating policy (per constitution and 00-canon/01-architecture.md):
//
//   Bundle-level gate    Entire Edge function bundle returns 404 NOT_FOUND
//                        when the flag is off. Hides the plugin surface
//                        entirely. Used for the five pillar plugins:
//                        plugins.3pl, plugins.manufacturing,
//                        plugins.copack_ecom, plugins.kitforce,
//                        plugins.kitcost. Implement at the top of the
//                        bundle's index.ts, not via this helper.
//
//   Per-route gate       Individual route inside an active bundle returns
//                        403 FEATURE_DISABLED with `details.flag` so the SPA
//                        can read it from the error envelope and redirect to
//                        /feature-unavailable?flag=<key>. This module's job.
//
// A 403 where a 404 is constitutionally required is a release blocker. Pick
// the right gate type for the flag and stick with it.

import { ApiError } from './responses.ts';
import type { Caller } from './tenant.ts';
import { getFlag } from './feature-flags.ts';

/**
 * Throws FEATURE_DISABLED (403) if the flag is off for the caller's org.
 * Returns void on success.
 *
 * The error envelope carries `details: { flag }`; the SPA reads it to route
 * to the feature-unavailable page.
 */
export async function requireFlag(
  caller: Caller,
  flagKey: string,
): Promise<void> {
  const { enabled } = await getFlag(caller.orgId, flagKey);
  if (!enabled) {
    throw new ApiError(
      'FEATURE_DISABLED',
      403,
      `Feature '${flagKey}' is not enabled for this workspace.`,
      { flag: flagKey },
    );
  }
}
