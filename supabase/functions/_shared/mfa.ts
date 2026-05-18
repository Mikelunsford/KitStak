// MFA enforcement helper.
//
// Platform-admin operations and other high-privilege actions gate on a
// verified TOTP factor on the caller's account. We check via the
// public.has_verified_totp(uuid) SECURITY DEFINER RPC (the auth schema is
// not PostgREST-exposed, so a direct query against auth.mfa_factors fails).
//
// Per-request memoization: a single request that calls requireMfaVerified
// from multiple code paths only hits the RPC once. Keyed on a WeakMap so
// completed requests get GC'd. The WeakMap key is the Request object; the
// inner Map is keyed on userId.
//
// Phase 1 establishes the surface; Wave 2 platform-admin handlers will be
// the first callers.

import { admin } from './handler-helpers.ts';
import { ApiError } from './responses.ts';
import type { Caller } from './tenant.ts';

interface CallerLike {
  userId: string;
}

const requestCache = new WeakMap<object, Map<string, boolean>>();

/**
 * Returns true iff the user has a verified TOTP factor. Bare check; throws
 * INTERNAL_ERROR on RPC failure so a transient DB error never silently
 * downgrades to "deny" (or worse, "allow").
 */
export async function hasVerifiedTotp(userId: string): Promise<boolean> {
  const { data, error } = await admin().rpc('has_verified_totp', {
    p_user_id: userId,
  });
  if (error) {
    throw new ApiError(
      'INTERNAL_ERROR',
      500,
      `mfa factor lookup failed: ${error.message}`,
      { detail: error.message },
    );
  }
  return data === true;
}

/**
 * Throws MFA_REQUIRED (403) if the caller has no verified TOTP factor.
 *
 * Optional `req` argument enables per-request memoization. When provided,
 * subsequent calls within the same request return from the WeakMap.
 */
export async function requireMfaVerified(
  caller: Caller | CallerLike,
  req?: Request,
): Promise<void> {
  const userId = caller.userId;

  if (req) {
    let cache = requestCache.get(req);
    if (cache) {
      const hit = cache.get(userId);
      if (hit === true) return;
      if (hit === false) {
        throw new ApiError(
          'MFA_REQUIRED',
          403,
          'This action requires an enrolled and verified TOTP factor.',
        );
      }
    } else {
      cache = new Map();
      requestCache.set(req, cache);
    }
    const ok = await hasVerifiedTotp(userId);
    cache.set(userId, ok);
    if (!ok) {
      throw new ApiError(
        'MFA_REQUIRED',
        403,
        'This action requires an enrolled and verified TOTP factor.',
      );
    }
    return;
  }

  const ok = await hasVerifiedTotp(userId);
  if (!ok) {
    throw new ApiError(
      'MFA_REQUIRED',
      403,
      'This action requires an enrolled and verified TOTP factor.',
    );
  }
}
