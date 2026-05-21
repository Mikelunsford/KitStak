// F-Wave8-POSTHOG-FEATURE-FLAGS-01.
//
// Pure precedence-resolution helper for the layered feature-flag
// pattern. Kept in its own module (no React, no Supabase, no
// apiClient imports) so the unit tests can exercise the constitutional
// precedence rule without spinning up jsdom or stubbing env vars.
//
// The constitutional invariant under test here:
//
//   Server-side useOrgFlags() is AUTHORITATIVE. PostHog flags layer on
//   top for gradual rollout and A/B-test experiments, but a server-side
//   `false` always wins. Routes return `403 FEATURE_DISABLED { flag }`
//   from the server; PostHog cannot override that.

export type FeatureFlagSource = 'server' | 'posthog' | 'default';

export interface FeatureFlagResult {
  /** Layered decision. */
  isEnabled: boolean;
  /** Provenance of the decision. */
  source: FeatureFlagSource;
  /** A/B variant key when PostHog returned a string; otherwise null. */
  variant: string | null;
  /** True while the server-side flag query is still in flight. */
  isLoading: boolean;
}

/**
 * Resolve a layered feature-flag decision from raw inputs.
 *
 * - `serverFlags`: the Record<string, boolean> from useOrgFlags().data.
 *   Absent keys are off (per existing useOrgFlags() semantics).
 * - `serverIsLoading`: useOrgFlags().isLoading.
 * - `posthogValue`: result of getPostHogFlag(key); `undefined` when
 *   PostHog is not initialised, the flag is not defined in PostHog,
 *   or /decide has not yet returned.
 */
export function resolveFeatureFlag(
  key: string,
  serverFlags: Record<string, boolean>,
  serverIsLoading: boolean,
  posthogValue: boolean | string | undefined,
): FeatureFlagResult {
  if (serverIsLoading) {
    return {
      isEnabled: false,
      source: 'default',
      variant: null,
      isLoading: true,
    };
  }

  const serverEnabled = serverFlags[key] === true;

  // Constitutional gate: server false is absolute. PostHog has no say.
  if (!serverEnabled) {
    return {
      isEnabled: false,
      source: 'server',
      variant: null,
      isLoading: false,
    };
  }

  if (posthogValue === undefined) {
    // Server said yes; PostHog has no opinion. Server's truth holds.
    return {
      isEnabled: true,
      source: 'server',
      variant: null,
      isLoading: false,
    };
  }

  if (typeof posthogValue === 'string') {
    // Multivariate flag. A non-empty variant key counts as enabled.
    const enabled = posthogValue.length > 0;
    return {
      isEnabled: enabled,
      source: 'posthog',
      variant: enabled ? posthogValue : null,
      isLoading: false,
    };
  }

  // Boolean PostHog value layered on top of server-true: PostHog can
  // narrow to false (gradual rollout cohort) but cannot flip a server-
  // false to true (handled above).
  return {
    isEnabled: posthogValue,
    source: 'posthog',
    variant: null,
    isLoading: false,
  };
}
