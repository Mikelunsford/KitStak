// Higher-order handler wrapper that runs `requireFlag` before delegating.
// Keeps per-route flag checks out of handler bodies so a route table reads
// declaratively:
//
//   { method: 'GET', path: '/expenses', handler: withFlag('finance.expenses', listExpenses) }
//
// The wrapped handler MUST already accept a Caller. The wrapper calls
// requireCaller(req) to resolve the caller before the flag check, so the
// inner handler receives a non-null Caller and can skip the auth dance.

import type { Caller } from './tenant.ts';
import { requireCaller } from './tenant.ts';
import { requireFlag } from './requireFlag.ts';

export type FlaggedHandler = (
  req: Request,
  caller: Caller,
) => Promise<Response> | Response;

/**
 * Wrap a handler so it only runs when `flagKey` is enabled for the caller's
 * org. Throws FEATURE_DISABLED (403) otherwise; that error must surface to
 * the bundle's top-level error catcher so the envelope is uniform.
 */
export function withFlag(
  flagKey: string,
  handler: FlaggedHandler,
): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    const caller = requireCaller(req);
    await requireFlag(caller, flagKey);
    return await handler(req, caller);
  };
}
