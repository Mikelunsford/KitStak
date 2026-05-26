// setupCelebrationState. Pure persistence helper for the one-shot
// "Setup complete" celebration banner.
//
// F-Wave9-CHECKLIST-CELEBRATION-01: the first time an operator transitions
// from the SetupChecklist to the work-card grid we want to acknowledge the
// milestone with a brief, dismissible banner. The banner must appear once
// per org and never come back, even if the operator reloads or the org is
// briefly knocked back to incomplete (a soft-delete that flips
// isSetupComplete back to false then forward again should not re-trigger
// the celebration).
//
// Storage is intentionally per-org, keyed by `<STORAGE_KEY_PREFIX>:<org_id>`
// so a user with two memberships can experience the celebration once for
// each org they bring to completion. The helper is pure (no React) so it
// can be vitest-tested without jsdom, matching the dashboardChecklistSteps
// pattern.
//
// Defensive posture: every storage read or write is guarded. SSR, private
// browsing, locked-down embedded webviews, and quota-exceeded scenarios
// must NOT throw out of these helpers. When localStorage is unreachable
// `hasSetupCelebrationBeenShown` returns false (we assume "not yet shown")
// and `markSetupCelebrationShown` becomes a no-op. The worst-case
// degradation is the banner re-appearing on subsequent visits in an
// unstorable environment, which is acceptable for the SSR/private-browsing
// long tail and far better than throwing out of the dashboard render.

const STORAGE_KEY_PREFIX = 'kitstak:setup-celebration-shown';

/**
 * Builds the per-org storage key. Exported so tests can assert the exact
 * key shape, and so the dashboard never has to hand-build it.
 */
export function setupCelebrationStorageKey(orgId: string): string {
  return `${STORAGE_KEY_PREFIX}:${orgId}`;
}

/**
 * Returns true if the celebration banner has already been shown and
 * dismissed for this org.
 *
 * Defensive: returns false when localStorage is unavailable (SSR, private
 * browsing) or when no orgId is supplied yet. The dashboard caller is
 * already gated on `isSetupComplete(summary)` so a false here only matters
 * once the operator has actually finished setup; in the unstorable case
 * the banner may re-appear on a subsequent visit but never crashes.
 */
export function hasSetupCelebrationBeenShown(orgId: string): boolean {
  if (!orgId) return false;
  const storage = safeLocalStorage();
  if (!storage) return false;
  try {
    return storage.getItem(setupCelebrationStorageKey(orgId)) === '1';
  } catch {
    return false;
  }
}

/**
 * Marks the celebration as shown for this org. Subsequent calls to
 * hasSetupCelebrationBeenShown return true. Silent no-op on storage error.
 */
export function markSetupCelebrationShown(orgId: string): void {
  if (!orgId) return;
  const storage = safeLocalStorage();
  if (!storage) return;
  try {
    storage.setItem(setupCelebrationStorageKey(orgId), '1');
  } catch {
    // Quota exceeded, storage disabled mid-session, etc. Swallow.
  }
}

/**
 * Returns the window.localStorage handle if it is reachable and usable;
 * otherwise null. Guarded against:
 *   - SSR (no window).
 *   - Browsers that expose `window.localStorage` but throw on access
 *     (Safari private mode historically, embedded webviews).
 */
function safeLocalStorage(): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    const storage = window.localStorage;
    if (!storage) return null;
    return storage;
  } catch {
    return null;
  }
}
