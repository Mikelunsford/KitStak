// Unit coverage for the /admin/sso form helpers. R-W13-AUTH-01.
// Node-only, no jsdom (matches membersInviteForm.test.ts).

import { describe, it, expect } from 'vitest';

import {
  SSO_PROVIDER_OPTIONS,
  DEFAULT_SSO_PROVIDER,
  isSsoFormSubmittable,
} from './ssoConnectionForm';

describe('SSO_PROVIDER_OPTIONS', () => {
  it('offers exactly saml and oidc, matching the table CHECK constraint', () => {
    expect(SSO_PROVIDER_OPTIONS.map((o) => o.value)).toEqual(['saml', 'oidc']);
  });

  it('defaults to saml', () => {
    expect(DEFAULT_SSO_PROVIDER).toBe('saml');
  });
});

describe('isSsoFormSubmittable', () => {
  it('is true for a non-empty display name when not pending', () => {
    expect(
      isSsoFormSubmittable({ displayName: 'Okta', isPending: false }),
    ).toBe(true);
  });

  it('is false while a request is pending', () => {
    expect(
      isSsoFormSubmittable({ displayName: 'Okta', isPending: true }),
    ).toBe(false);
  });

  it('is false for an empty or whitespace-only display name', () => {
    expect(
      isSsoFormSubmittable({ displayName: '', isPending: false }),
    ).toBe(false);
    expect(
      isSsoFormSubmittable({ displayName: '   ', isPending: false }),
    ).toBe(false);
  });
});
