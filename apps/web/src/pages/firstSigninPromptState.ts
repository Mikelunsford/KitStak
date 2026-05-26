// firstSigninPromptState. Pure persistence helper for the one-shot
// "set your password" prompt shown on a new operator's first dashboard
// arrival after a magic-link invite.
//
// F-Wave9-INVITE-PASSWORD-PROMPT-01: PR F shipped /account/security and
// the recovery flow but did not nudge invitees toward setting a password.
// An invitee who lands on /dashboard via the magic link has no password
// set; if they sign out they cannot sign back in via /signin without
// going through the recovery loop. This helper backs a per-user "have we
// already prompted you" flag so DashboardPage can redirect to
// /account/security?welcome=1 exactly once per user, then never again.
//
// Storage is keyed per user (`<STORAGE_KEY_PREFIX>:<user_id>`) so a shared
// device with two distinct users each get their own one-shot.
//
// Defensive posture mirrors setupCelebrationState.ts exactly: every
// storage read or write is guarded against SSR (no window), private
// browsing, locked-down embedded webviews, and quota-exceeded writes. In
// the unstorable case `hasSeenPasswordPrompt` returns false (we assume
// "not yet seen") and `markPasswordPromptSeen` becomes a no-op. The
// worst-case degradation is the prompt re-appearing on subsequent visits
// in an unstorable environment, which is acceptable and far better than
// throwing out of the dashboard render.

const STORAGE_KEY_PREFIX = 'kitstak:password-prompt-seen';

/**
 * Builds the per-user storage key. Exported so tests can assert the exact
 * key shape, and so callers never have to hand-build it.
 */
export function passwordPromptStorageKey(userId: string): string {
  return `${STORAGE_KEY_PREFIX}:${userId}`;
}

/**
 * Returns true if the operator has already been redirected to (or skipped
 * past) the welcome password prompt for this user id.
 *
 * Defensive: returns false when localStorage is unavailable (SSR, private
 * browsing) or when no userId is supplied yet. The dashboard caller is
 * already gated on `me.data?.user_id` so a false here only matters once
 * the identity payload has resolved; in the unstorable case the prompt
 * may re-appear on a subsequent visit but never crashes.
 */
export function hasSeenPasswordPrompt(userId: string): boolean {
  if (!userId) return false;
  const storage = safeLocalStorage();
  if (!storage) return false;
  try {
    return storage.getItem(passwordPromptStorageKey(userId)) === 'true';
  } catch {
    return false;
  }
}

/**
 * Marks the prompt as seen for this user. Subsequent calls to
 * hasSeenPasswordPrompt return true. Silent no-op on storage error.
 */
export function markPasswordPromptSeen(userId: string): void {
  if (!userId) return;
  const storage = safeLocalStorage();
  if (!storage) return;
  try {
    storage.setItem(passwordPromptStorageKey(userId), 'true');
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
