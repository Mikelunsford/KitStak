// F-Wave8-POSTHOG-FEATURE-FLAGS-01.
//
// useFeatureFlag layers PostHog feature flags on top of the existing
// server-side `useOrgFlags()` pattern. The precedence rule is fixed and
// constitutionally grounded:
//
//   Server-side flags via useOrgFlags() are AUTHORITATIVE. PostHog
//   flags layer on top for gradual rollout and A/B-test experiments,
//   but a server-side `false` always wins.
//
// Rationale: per the constitution, capability gates and per-route
// feature flag misses MUST return `403 FEATURE_DISABLED { flag }`. The
// server is the authority on access. PostHog cannot override a
// server-side `false` because PostHog is a client-side cache and the
// server enforces the actual route. PostHog's role is narrowing a
// server-side `true` to a `false` for a specific rollout cohort
// (gradual rollout) or splitting a server-side `true` across variants
// (A/B test).
//
// Use this hook for experiments and gradual rollouts that the feature
// team explicitly opts into. Keep using `useOrgFlags()` directly for
// route guards, Sidebar pillar gates, and any other surface where the
// server's authoritative truth must not be PostHog-influenced.

import { useEffect, useState } from 'react';

import { getPostHogFlag, onPostHogFlagsLoaded } from '@/lib/analytics';
import {
  resolveFeatureFlag,
  type FeatureFlagResult,
} from './featureFlagResolver';
import { useOrgFlags } from './useOrgFlags';

export type { FeatureFlagResult, FeatureFlagSource } from './featureFlagResolver';
export { resolveFeatureFlag } from './featureFlagResolver';

/**
 * Layered feature-flag read. Server-side useOrgFlags() is the source
 * of truth; PostHog narrows or selects a variant on top.
 *
 * Example use:
 *   const { isEnabled, variant } = useFeatureFlag('new_quote_flow');
 *   if (!isEnabled) return null;
 *   return variant === 'experiment_b' ? <FlowB /> : <FlowA />;
 *
 * Do NOT use this hook for route guards, Sidebar pillar gates, or
 * anywhere the constitutional 403 FEATURE_DISABLED contract applies.
 * Those surfaces must read `useOrgFlags()` directly so a PostHog
 * outage or misconfiguration cannot change route-level access.
 */
export function useFeatureFlag(key: string): FeatureFlagResult {
  const orgFlags = useOrgFlags();

  // Re-render when PostHog's flag cache updates so a flag that was not
  // yet loaded at first paint can flip the decision once /decide returns.
  const [, setPostHogTick] = useState(0);
  useEffect(() => {
    const unsubscribe = onPostHogFlagsLoaded(() => {
      setPostHogTick((n) => n + 1);
    });
    return unsubscribe;
  }, []);

  return resolveFeatureFlag(
    key,
    orgFlags.data,
    orgFlags.isLoading,
    getPostHogFlag(key),
  );
}
