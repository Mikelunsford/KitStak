// Feature flag reader.
//
// Source of truth: public.org_feature_flags(org_id, flag_key, is_enabled,
// config). Bundle-level gates (e.g. plugins.three_pl on the ops-api bundle)
// return 404 NOT_FOUND to hide the surface entirely. Per-route gates (e.g.
// finance.expenses inside an active bundle) return 403 FEATURE_DISABLED
// with details.flag so the SPA can route to /feature-unavailable.
//
// Cache: 5-minute in-memory Map per Deno instance. Eviction is lazy on read.
// Org admins flipping a flag via settings-api can bound staleness to 5 min;
// multi-instance Deno workers each maintain their own cache. Fail-closed: an
// error or absent row yields { enabled: false, config: {} }.

import { admin } from './handler-helpers.ts';

const CACHE_TTL_MS = 5 * 60 * 1000;

export interface FlagValue {
  enabled: boolean;
  config: Record<string, unknown>;
}

interface CacheEntry {
  value: FlagValue;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

function cacheKey(orgId: string, flagKey: string): string {
  return `${orgId}::${flagKey}`;
}

/**
 * Read a feature flag for an org. Returns `{ enabled, config }`. Fail-closed
 * on RLS denial or query error.
 *
 * `flagKey` is dot-namespaced: `<domain>.<feature>`. Examples:
 *   plugins.three_pl, plugins.manufacturing, plugins.copack_ecom,
 *   plugins.kitforce, plugins.kitcost,
 *   addons.whitelabel, addons.kitforce, addons.kitcost,
 *   finance.journal_entries.enabled, finance.expenses,
 *   auth.sso_saml.
 */
export async function getFlag(
  orgId: string,
  flagKey: string,
): Promise<FlagValue> {
  const key = cacheKey(orgId, flagKey);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const { data, error } = await admin()
    .from('org_feature_flags')
    .select('is_enabled, config')
    .eq('org_id', orgId)
    .eq('flag_key', flagKey)
    .maybeSingle();

  let value: FlagValue;
  if (error || data === null) {
    value = { enabled: false, config: {} };
  } else {
    value = {
      enabled: data.is_enabled === true,
      config: (data.config as Record<string, unknown> | null) ?? {},
    };
  }
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}

/**
 * Test-only. Clear the in-memory cache. When `orgId` is omitted, clears all
 * entries; otherwise clears only entries for that org.
 */
export function invalidateFlagCache(orgId?: string): void {
  if (!orgId) {
    cache.clear();
    return;
  }
  const prefix = `${orgId}::`;
  for (const k of cache.keys()) {
    if (k.startsWith(prefix)) cache.delete(k);
  }
}
