// Unit tests for the pure helpers backing useSubscriptionGate. Matches
// the membersInviteForm / sendButtonFeedback / dashboardChecklistSteps
// shape: no React tree, no QueryClient.

import { describe, it, expect } from 'vitest';

// Imports from the pure-helper file, not the .tsx hook surface, so the
// test does not transitively load apiClient -> supabase (which throws at
// import time when VITE_ env vars are absent). Mirrors paymentInvalidation.
import {
  SUBSCRIPTION_ALLOWLIST,
  SUBSCRIPTION_ALLOWLIST_PREFIXES,
  isPathAllowlistedForGate,
  isSubscriptionExpired,
  trialDaysRemainingFor,
} from './subscriptionGateHelpers';

const NOW = new Date('2026-05-27T12:00:00.000Z');

describe('isSubscriptionExpired', () => {
  it('returns true when status is trialing and trial_ends_at is in the past', () => {
    expect(
      isSubscriptionExpired(
        'trialing',
        '2026-05-26T12:00:00.000Z',
        NOW,
      ),
    ).toBe(true);
  });

  it('returns false when status is trialing and trial_ends_at is in the future', () => {
    expect(
      isSubscriptionExpired(
        'trialing',
        '2026-06-10T12:00:00.000Z',
        NOW,
      ),
    ).toBe(false);
  });

  it('returns false when status is active even if trial_ends_at is past', () => {
    expect(
      isSubscriptionExpired(
        'active',
        '2026-05-01T12:00:00.000Z',
        NOW,
      ),
    ).toBe(false);
  });

  it('returns false when trial_ends_at is null', () => {
    expect(isSubscriptionExpired('trialing', null, NOW)).toBe(false);
  });

  it('returns false on a malformed timestamp', () => {
    expect(isSubscriptionExpired('trialing', 'not-a-date', NOW)).toBe(false);
  });
});

describe('trialDaysRemainingFor', () => {
  it('returns the correct day count while in the trial window', () => {
    // Trial ends 12 days out.
    expect(
      trialDaysRemainingFor('2026-06-08T12:00:00.000Z', NOW),
    ).toBe(12);
  });

  it('rounds up partial days so 2 hours left still shows 1 day', () => {
    expect(
      trialDaysRemainingFor('2026-05-27T14:00:00.000Z', NOW),
    ).toBe(1);
  });

  it('returns 0 when trial_ends_at is in the past', () => {
    expect(
      trialDaysRemainingFor('2026-05-20T12:00:00.000Z', NOW),
    ).toBe(0);
  });

  it('returns 0 when trial_ends_at is null', () => {
    expect(trialDaysRemainingFor(null, NOW)).toBe(0);
  });
});

describe('isPathAllowlistedForGate', () => {
  it('allowlists exact /admin/billing so the operator can pick a plan', () => {
    expect(isPathAllowlistedForGate('/admin/billing')).toBe(true);
  });

  it('allowlists /signin and /signout', () => {
    expect(isPathAllowlistedForGate('/signin')).toBe(true);
    expect(isPathAllowlistedForGate('/signout')).toBe(true);
  });

  it('allowlists any /account/* path (security, profile, etc.)', () => {
    expect(isPathAllowlistedForGate('/account/security')).toBe(true);
    expect(isPathAllowlistedForGate('/account/profile')).toBe(true);
  });

  it('does NOT allowlist gated pillar surfaces', () => {
    expect(isPathAllowlistedForGate('/dashboard')).toBe(false);
    expect(isPathAllowlistedForGate('/3pl-operations/items')).toBe(false);
    expect(isPathAllowlistedForGate('/manufacturing/runs')).toBe(false);
    expect(isPathAllowlistedForGate('/admin/settings')).toBe(false);
  });
});

describe('SUBSCRIPTION_ALLOWLIST surface', () => {
  it('exports the three exact-match paths', () => {
    expect(SUBSCRIPTION_ALLOWLIST).toEqual([
      '/admin/billing',
      '/signin',
      '/signout',
    ]);
  });

  it('exports /account/ as the prefix allowlist', () => {
    expect(SUBSCRIPTION_ALLOWLIST_PREFIXES).toEqual(['/account/']);
  });
});
