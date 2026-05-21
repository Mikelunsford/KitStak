// F-Wave8-POSTHOG-FEATURE-FLAGS-01: precedence-rule coverage for the
// PostHog-on-top-of-useOrgFlags layering hook.
//
// The hook itself wraps React's useState + useEffect + useOrgFlags();
// the precedence logic that matters is the pure `resolveFeatureFlag`
// helper. Tests target that helper plus the thin analytics wrappers so
// the suite runs without a React renderer (the repo has no jsdom or
// testing-library dependency).
//
// Constitutional invariant under test: a server-side `false` is
// absolute. PostHog cannot override it, regardless of PostHog's value.

import { describe, it, expect, beforeEach } from 'vitest';

import { resolveFeatureFlag } from './featureFlagResolver';
import {
  getPostHogFlag,
  onPostHogFlagsLoaded,
  __setPostHogForTests,
} from '@/lib/analytics';

describe('resolveFeatureFlag precedence', () => {
  const KEY = 'new_quote_flow';

  it('server-true + posthog-true => enabled, source posthog', () => {
    const r = resolveFeatureFlag(KEY, { [KEY]: true }, false, true);
    expect(r.isEnabled).toBe(true);
    expect(r.source).toBe('posthog');
    expect(r.variant).toBeNull();
    expect(r.isLoading).toBe(false);
  });

  it('server-true + posthog-false => DISABLED (PostHog narrowed for rollout cohort)', () => {
    const r = resolveFeatureFlag(KEY, { [KEY]: true }, false, false);
    expect(r.isEnabled).toBe(false);
    expect(r.source).toBe('posthog');
    expect(r.variant).toBeNull();
  });

  it('server-true + posthog-undefined => enabled, source server (PostHog had no opinion)', () => {
    const r = resolveFeatureFlag(KEY, { [KEY]: true }, false, undefined);
    expect(r.isEnabled).toBe(true);
    expect(r.source).toBe('server');
    expect(r.variant).toBeNull();
  });

  it('server-FALSE + posthog-true => DISABLED (constitutional: server wins)', () => {
    // The critical guarantee. PostHog must NEVER be able to flip a
    // server-side false to true. This protects the 403 FEATURE_DISABLED
    // contract: the server is authoritative for access.
    const r = resolveFeatureFlag(KEY, { [KEY]: false }, false, true);
    expect(r.isEnabled).toBe(false);
    expect(r.source).toBe('server');
  });

  it('server-FALSE + posthog-string-variant => DISABLED (constitutional)', () => {
    // Variant strings cannot resurrect a server-false flag either.
    const r = resolveFeatureFlag(KEY, { [KEY]: false }, false, 'experiment_b');
    expect(r.isEnabled).toBe(false);
    expect(r.source).toBe('server');
    expect(r.variant).toBeNull();
  });

  it('server-flag-absent + posthog-true => DISABLED (absent key is off per useOrgFlags semantics)', () => {
    const r = resolveFeatureFlag(KEY, {}, false, true);
    expect(r.isEnabled).toBe(false);
    expect(r.source).toBe('server');
  });

  it('server-false + posthog-undefined => disabled, source server', () => {
    const r = resolveFeatureFlag(KEY, { [KEY]: false }, false, undefined);
    expect(r.isEnabled).toBe(false);
    expect(r.source).toBe('server');
  });

  it('server-loading + posthog-anything => isLoading true, default source', () => {
    const r = resolveFeatureFlag(KEY, {}, true, true);
    expect(r.isLoading).toBe(true);
    expect(r.source).toBe('default');
    expect(r.isEnabled).toBe(false);
  });

  it('server-true + posthog string variant => enabled, source posthog, variant captured', () => {
    const r = resolveFeatureFlag(KEY, { [KEY]: true }, false, 'experiment_b');
    expect(r.isEnabled).toBe(true);
    expect(r.source).toBe('posthog');
    expect(r.variant).toBe('experiment_b');
  });

  it('server-true + posthog empty-string variant => disabled (empty variant is off)', () => {
    const r = resolveFeatureFlag(KEY, { [KEY]: true }, false, '');
    expect(r.isEnabled).toBe(false);
    expect(r.source).toBe('posthog');
    expect(r.variant).toBeNull();
  });
});

describe('analytics PostHog flag wrappers (no DSN posture)', () => {
  beforeEach(() => {
    __setPostHogForTests(null);
  });

  it('getPostHogFlag returns undefined when PostHog is not initialised', () => {
    expect(getPostHogFlag('any_flag')).toBeUndefined();
  });

  it('onPostHogFlagsLoaded returns a no-op unsubscribe when PostHog is not initialised', () => {
    const unsubscribe = onPostHogFlagsLoaded(() => {
      throw new Error('callback must not fire without PostHog');
    });
    expect(typeof unsubscribe).toBe('function');
    // Calling it must not throw.
    expect(() => unsubscribe()).not.toThrow();
  });

  it('behaves identically to useOrgFlags() when PostHog is not initialised (server-true)', () => {
    // PostHog absent => posthogValue is undefined => server's truth holds.
    const r = resolveFeatureFlag('k', { k: true }, false, getPostHogFlag('k'));
    expect(r.isEnabled).toBe(true);
    expect(r.source).toBe('server');
  });

  it('behaves identically to useOrgFlags() when PostHog is not initialised (server-false)', () => {
    const r = resolveFeatureFlag('k', { k: false }, false, getPostHogFlag('k'));
    expect(r.isEnabled).toBe(false);
    expect(r.source).toBe('server');
  });
});

describe('analytics PostHog flag wrappers (stubbed PostHog)', () => {
  beforeEach(() => {
    __setPostHogForTests(null);
  });

  it('getPostHogFlag reads from posthog.getFeatureFlag when initialised', () => {
    const stub = {
      getFeatureFlag: (key: string) => (key === 'on' ? true : key === 'variant' ? 'b' : undefined),
      onFeatureFlags: () => () => {},
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    __setPostHogForTests(stub as any);
    expect(getPostHogFlag('on')).toBe(true);
    expect(getPostHogFlag('variant')).toBe('b');
    expect(getPostHogFlag('missing')).toBeUndefined();
  });

  it('onPostHogFlagsLoaded wires the callback through posthog.onFeatureFlags', () => {
    let registered: (() => void) | null = null;
    const stub = {
      getFeatureFlag: () => undefined,
      onFeatureFlags: (cb: () => void) => {
        registered = cb;
        return () => {
          registered = null;
        };
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    __setPostHogForTests(stub as any);

    let fired = 0;
    const unsubscribe = onPostHogFlagsLoaded(() => {
      fired++;
    });
    const captured = registered as (() => void) | null;
    expect(captured).not.toBeNull();
    captured?.();
    expect(fired).toBe(1);
    unsubscribe();
    expect(registered).toBeNull();
  });
});
