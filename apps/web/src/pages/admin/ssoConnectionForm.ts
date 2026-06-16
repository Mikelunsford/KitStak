// Pure helpers for the /admin/sso connection form. R-W13-AUTH-01.
//
// Kept out of SsoConnectionsPage.tsx so the provider options and the submit
// predicate can be tested under Vitest without a jsdom renderer (matches the
// repo no-jsdom convention; see membersInviteForm.ts).

import type { SsoProvider } from '@/lib/services/ssoService';

export interface SsoProviderOption {
  value: SsoProvider;
  label: string;
}

/**
 * The protocols a connection can use. SAML and OIDC mirror the
 * sso_connections.provider CHECK constraint in migration 0002.
 */
export const SSO_PROVIDER_OPTIONS: ReadonlyArray<SsoProviderOption> = [
  { value: 'saml', label: 'SAML' },
  { value: 'oidc', label: 'OIDC' },
] as const;

export const DEFAULT_SSO_PROVIDER: SsoProvider = 'saml';

export interface SsoFormSubmittableInput {
  displayName: string;
  isPending: boolean;
}

/**
 * True when the Add button should be enabled. A non-empty trimmed display
 * name is the only client gate; the unique (org_id, display_name) constraint
 * and RLS role check are the server authority.
 */
export function isSsoFormSubmittable(input: SsoFormSubmittableInput): boolean {
  if (input.isPending) return false;
  if (!input.displayName.trim()) return false;
  return true;
}

// F-Wave13-SSO-HANDSHAKE-01: per-protocol metadata form state and submit gates.
// The required fields mirror the settings-api request schemas; the server
// re-validates (URL shape, non-empty) and is the authority. attribute_mappings
// and the SAML signing options carry server-side defaults, so they are not
// gated here.
export interface SamlConfigFormState {
  idpEntityId: string;
  idpSsoUrl: string;
  idpX509Cert: string;
  spEntityId: string;
  spAcsUrl: string;
}

export function isSamlConfigSubmittable(
  state: SamlConfigFormState,
  isPending: boolean,
): boolean {
  if (isPending) return false;
  return (
    state.idpEntityId.trim() !== '' &&
    state.idpSsoUrl.trim() !== '' &&
    state.idpX509Cert.trim() !== '' &&
    state.spEntityId.trim() !== '' &&
    state.spAcsUrl.trim() !== ''
  );
}

export interface OidcConfigFormState {
  issuerUrl: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  userinfoEndpoint: string;
  clientId: string;
}

export function isOidcConfigSubmittable(
  state: OidcConfigFormState,
  isPending: boolean,
): boolean {
  if (isPending) return false;
  return (
    state.issuerUrl.trim() !== '' &&
    state.authorizationEndpoint.trim() !== '' &&
    state.tokenEndpoint.trim() !== '' &&
    state.userinfoEndpoint.trim() !== '' &&
    state.clientId.trim() !== ''
  );
}
