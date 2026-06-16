// Unit coverage for the /admin/sso form helpers. R-W13-AUTH-01.
// Node-only, no jsdom (matches membersInviteForm.test.ts).

import { describe, it, expect } from 'vitest';

import {
  SSO_PROVIDER_OPTIONS,
  DEFAULT_SSO_PROVIDER,
  isSsoFormSubmittable,
  isSamlConfigSubmittable,
  isOidcConfigSubmittable,
  type SamlConfigFormState,
  type OidcConfigFormState,
} from './ssoConnectionForm';

const FULL_SAML: SamlConfigFormState = {
  idpEntityId: 'https://idp.example.com/entity',
  idpSsoUrl: 'https://idp.example.com/sso',
  idpX509Cert: 'MIIC...cert...',
  spEntityId: 'https://app.kitstak.com/sp',
  spAcsUrl: 'https://app.kitstak.com/acs',
};

const FULL_OIDC: OidcConfigFormState = {
  issuerUrl: 'https://idp.example.com',
  authorizationEndpoint: 'https://idp.example.com/authorize',
  tokenEndpoint: 'https://idp.example.com/token',
  userinfoEndpoint: 'https://idp.example.com/userinfo',
  clientId: 'client-123',
};

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

describe('isSamlConfigSubmittable', () => {
  it('is true when every required SAML field is set and not pending', () => {
    expect(isSamlConfigSubmittable(FULL_SAML, false)).toBe(true);
  });

  it('is false while a request is pending', () => {
    expect(isSamlConfigSubmittable(FULL_SAML, true)).toBe(false);
  });

  it('is false when any required SAML field is empty or whitespace', () => {
    expect(isSamlConfigSubmittable({ ...FULL_SAML, idpX509Cert: '' }, false)).toBe(false);
    expect(isSamlConfigSubmittable({ ...FULL_SAML, spAcsUrl: '   ' }, false)).toBe(false);
  });
});

describe('isOidcConfigSubmittable', () => {
  it('is true when every required OIDC field is set and not pending', () => {
    expect(isOidcConfigSubmittable(FULL_OIDC, false)).toBe(true);
  });

  it('is false while a request is pending', () => {
    expect(isOidcConfigSubmittable(FULL_OIDC, true)).toBe(false);
  });

  it('is false when any required OIDC field is empty or whitespace', () => {
    expect(isOidcConfigSubmittable({ ...FULL_OIDC, clientId: '' }, false)).toBe(false);
    expect(isOidcConfigSubmittable({ ...FULL_OIDC, issuerUrl: '  ' }, false)).toBe(false);
  });
});
