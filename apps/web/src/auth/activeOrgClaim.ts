/**
 * Pure helper to detect the NO_ACTIVE_ORG state from a Supabase user record.
 *
 * F-Wave9-COWORK-SMOKE-03. The Edge dispatcher in
 * supabase/functions/_shared/tenant.ts throws
 * `ERROR_CODES.NO_ACTIVE_ORG` (401) when the JWT decodes but carries no
 * `kitstak_org_id` claim. The SPA must mirror that gate at the auth-guard
 * layer so a fresh user whose JWT lacks the claim never sees the empty
 * dashboard (which silently renders no work cards and three pillar tiles
 * with no banner).
 *
 * SMOKE-02 (migration 0069) stamps the claim on provision_organization, so
 * the happy path is already covered. This helper is the SPA-side fail-safe
 * for legacy users, dev poking, or JWT desync mid-session.
 *
 * The claim lives on `user.app_metadata` (server-controlled), never on
 * `user.user_metadata` (caller-writable). Reading `app_metadata` keeps the
 * check synchronous and avoids a round-trip to /auth-api/me.
 *
 * Pure-TS so the test suite can exercise the predicate without rendering
 * React. Mirrors the precedent in sidebarGating.ts.
 */

interface UserLike {
  app_metadata?: Record<string, unknown> | null | undefined;
}

/**
 * Returns true when the user's JWT app_metadata carries a non-empty
 * string `kitstak_org_id` claim. Returns false for null, undefined,
 * missing metadata, missing key, non-string values, or empty strings.
 */
export function hasActiveOrgClaim(user: UserLike | null | undefined): boolean {
  if (!user) return false;
  const meta = user.app_metadata;
  if (!meta || typeof meta !== 'object') return false;
  const claim = (meta as Record<string, unknown>)['kitstak_org_id'];
  return typeof claim === 'string' && claim.length > 0;
}
