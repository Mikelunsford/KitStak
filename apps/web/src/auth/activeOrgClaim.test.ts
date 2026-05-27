// F-Wave9-COWORK-SMOKE-03: pin the NO_ACTIVE_ORG predicate behaviour.
//
// Pure-TS suite, no React renderer (mirrors sidebarGating.test.ts).

import { describe, it, expect } from 'vitest';

import { hasActiveOrgClaim } from './activeOrgClaim';

describe('hasActiveOrgClaim (SMOKE-03)', () => {
  it('returns false for null', () => {
    expect(hasActiveOrgClaim(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(hasActiveOrgClaim(undefined)).toBe(false);
  });

  it('returns false when app_metadata is absent', () => {
    expect(hasActiveOrgClaim({})).toBe(false);
  });

  it('returns false when app_metadata is null', () => {
    expect(hasActiveOrgClaim({ app_metadata: null })).toBe(false);
  });

  it('returns false when kitstak_org_id key is missing', () => {
    expect(hasActiveOrgClaim({ app_metadata: { other: 'value' } })).toBe(false);
  });

  it('returns false when kitstak_org_id is an empty string', () => {
    expect(hasActiveOrgClaim({ app_metadata: { kitstak_org_id: '' } })).toBe(
      false,
    );
  });

  it('returns false when kitstak_org_id is not a string', () => {
    expect(hasActiveOrgClaim({ app_metadata: { kitstak_org_id: 42 } })).toBe(
      false,
    );
    expect(
      hasActiveOrgClaim({ app_metadata: { kitstak_org_id: null } }),
    ).toBe(false);
  });

  it('returns true for a non-empty kitstak_org_id string', () => {
    expect(
      hasActiveOrgClaim({
        app_metadata: { kitstak_org_id: '05cb1eac-dd7e-4393-b4a4-d4a0dd2aba8c' },
      }),
    ).toBe(true);
  });
});
