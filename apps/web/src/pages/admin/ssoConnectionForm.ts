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
