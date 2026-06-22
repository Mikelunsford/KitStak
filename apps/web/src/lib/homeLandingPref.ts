// homeLandingPref. Per-user default landing (Personalization).
//
// Lets each user pick which surface "/" resolves to after sign-in: the global
// dashboard (default) or any section home (/sell, /money, ...). Stored per
// browser in localStorage; landing is an inherently per-device preference, so
// no backend is involved. A DB-backed, cross-device version would be a later
// upgrade.
//
// Pure module (no React). Guarded against SSR / private browsing / quota the
// same way setupCelebrationState does: an unreachable store degrades to the
// default landing rather than throwing out of IndexRoute.

const STORAGE_KEY = 'kitstak.home.landing';

/** The fallback landing when no valid preference is stored. */
export const DEFAULT_LANDING = '/dashboard';

/**
 * Section home paths. Hardcoded on purpose: importing SIDEBAR_MODES here pulls
 * sidebarModes (and its ~50 lucide icons) into the eager IndexRoute path, which
 * blows the index-chunk size-limit budget. homeLandingPref.test.ts asserts this
 * list stays in sync with SIDEBAR_MODES, so drift is caught at test time.
 */
const SECTION_HOME_PATHS: ReadonlyArray<string> = [
  '/sell',
  '/buy',
  '/inventory',
  '/production',
  '/money',
  '/workforce',
  '/insights',
  '/settings',
];

/**
 * The set of landings a user may choose: the global dashboard plus every
 * section home. A stored value outside this set is ignored (self-heals if a
 * section is renamed or retired).
 */
export function validLandings(): string[] {
  return [DEFAULT_LANDING, ...SECTION_HOME_PATHS];
}

export function isValidLanding(path: string): boolean {
  return validLandings().includes(path);
}

function safeLocalStorage(): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * The user's chosen landing path, or DEFAULT_LANDING when unset, invalid, or
 * storage is unreachable. Always returns a path that is safe to navigate to;
 * if the chosen section later becomes unavailable to the role, SectionHomePage
 * bounces it back to the dashboard.
 */
export function getHomeLanding(): string {
  const storage = safeLocalStorage();
  if (!storage) return DEFAULT_LANDING;
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw && isValidLanding(raw)) return raw;
  } catch {
    // fall through
  }
  return DEFAULT_LANDING;
}

/**
 * Persist the chosen landing. Setting the default clears the key (so the user
 * tracks any future default change). Invalid paths are ignored. Silent no-op
 * when storage is unreachable.
 */
export function setHomeLanding(path: string): void {
  const storage = safeLocalStorage();
  if (!storage) return;
  try {
    if (path === DEFAULT_LANDING) {
      storage.removeItem(STORAGE_KEY);
    } else if (isValidLanding(path)) {
      storage.setItem(STORAGE_KEY, path);
    }
  } catch {
    // Quota / disabled storage. Swallow.
  }
}
