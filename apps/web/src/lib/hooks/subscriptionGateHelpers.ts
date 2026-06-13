// Pure helpers backing useSubscriptionGate. Lives in its own file so unit
// tests can import without transitively pulling apiClient / supabase
// (which throws at import time when VITE_ env vars are absent — the
// vitest unit environment is exactly that case). Same shape as
// paymentInvalidation.ts and other BNEW-* pure helpers.

export type SubscriptionStatus =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'incomplete'
  | 'incomplete_expired'
  | 'unpaid'
  | 'paused';

/**
 * Org feature-flag key that ENABLES trial-gate enforcement. Absent or false
 * (the default for every org) means the trial wall and the trial banner never
 * fire, so pre-revenue dogfooding and demos are never interrupted. Flip it on
 * per org from /admin/flags when ready to monetize. SPA-only: no edge bundle
 * reads it, so it stays out of the cross-boundary FEATURE_FLAGS canon.
 */
export const TRIAL_GATE_FLAG = 'billing.trial_gate.enabled';

export const SUBSCRIPTION_ALLOWLIST: ReadonlyArray<string> = [
  '/admin/billing',
  '/signin',
  '/signout',
];

/**
 * Path-prefix allowlist. /account/* covers /account/security and any
 * future /account/profile etc. SUBSCRIPTION_ALLOWLIST handles exact-
 * match paths.
 */
export const SUBSCRIPTION_ALLOWLIST_PREFIXES: ReadonlyArray<string> = [
  '/account/',
];

/**
 * True when the caller is allowed to render the surface even after the
 * trial has lapsed. /admin/billing must be reachable so the operator can
 * choose a plan; /account/security so they can finish password setup;
 * /signin and /signout so they can leave or come back.
 */
export function isPathAllowlistedForGate(pathname: string): boolean {
  if (SUBSCRIPTION_ALLOWLIST.includes(pathname)) return true;
  for (const prefix of SUBSCRIPTION_ALLOWLIST_PREFIXES) {
    if (pathname.startsWith(prefix)) return true;
  }
  return false;
}

/**
 * Whole-day countdown to the trial end. Day 14 (the trial-end timestamp)
 * returns 0; anything past that returns 0 too (the caller treats 0 + a
 * past timestamp as "expired"). The math uses Math.ceil so a trial with
 * ~2 hours left still shows "1 day".
 */
export function trialDaysRemainingFor(
  trialEndsAt: string | null,
  now: Date = new Date(),
): number {
  if (!trialEndsAt) return 0;
  const end = new Date(trialEndsAt).getTime();
  if (!Number.isFinite(end)) return 0;
  const diffMs = end - now.getTime();
  if (diffMs <= 0) return 0;
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;
  return Math.ceil(diffMs / ONE_DAY_MS);
}

/**
 * True when status is 'trialing' AND the trial_ends_at timestamp is in
 * the past. This is the day-14-with-no-card state per the constitution.
 * Any other status that needs gating (past_due, unpaid, etc.) is up to
 * the Stripe wiring follow-up; this PR only walls off lapsed trials.
 */
export function isSubscriptionExpired(
  status: SubscriptionStatus,
  trialEndsAt: string | null,
  now: Date = new Date(),
): boolean {
  if (status !== 'trialing') return false;
  if (!trialEndsAt) return false;
  const end = new Date(trialEndsAt).getTime();
  if (!Number.isFinite(end)) return false;
  return end <= now.getTime();
}

/**
 * Single decision point for the trial wall. Returns true only when the org has
 * trial-gate enforcement turned on AND the trial has lapsed AND the current
 * path is not allowlisted. Enforcement defaults off (TRIAL_GATE_FLAG absent),
 * so this returns false for every org until the operator opts in. Pure so the
 * SubscriptionGate component stays a thin wrapper and the policy is unit-tested
 * without a React tree.
 */
export function shouldBlockForTrial(
  enforcementEnabled: boolean,
  status: SubscriptionStatus | null,
  trialEndsAt: string | null,
  pathname: string,
  now: Date = new Date(),
): boolean {
  if (!enforcementEnabled) return false;
  if (!status) return false;
  if (!isSubscriptionExpired(status, trialEndsAt, now)) return false;
  if (isPathAllowlistedForGate(pathname)) return false;
  return true;
}
