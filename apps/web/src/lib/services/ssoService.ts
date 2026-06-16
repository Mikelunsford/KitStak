// SSO connections service. R-W13-AUTH-01.
//
// Reads and writes public.sso_connections through the Supabase PostgREST
// client. The table has Pattern A RLS from migration 0002: SELECT is scoped
// to the caller's org, and INSERT/UPDATE require org_owner or org_admin. The
// SPA route is admin-guarded and the org.sso.read / org.sso.write caps gate
// the buttons, but RLS on the table is the authority. No Edge endpoint is
// needed: this is org-scoped configuration data, not a workflow that mints a
// document number or touches money, so a direct RLS-scoped client read/write
// is the same pattern the settings and branding admin surfaces use.
//
// SCOPE NOTE (deferred, see blockers): this manages the Kitstak-side
// connection record (provider kind, display name, default role, active flag).
// The actual SAML handshake (IdP metadata exchange, ACS endpoint, assertion
// validation) is a Supabase Auth provider concern configured in the Supabase
// project, not something the SPA can complete on its own. The saml_configs
// child table (idp_sso_url, x509 cert, ACS url) is intentionally NOT edited
// here yet.

import { z } from 'zod';

import { supabase } from '@/lib/supabase';
import { apiRequest } from '@/lib/apiClient';
import {
  SsoConnectionSchema as CanonSsoConnectionSchema,
  SsoProviderSchema,
  SamlConfigSchema,
  OidcConfigResponseSchema,
  type SsoProvider,
  type SamlConfig,
  type OidcConfig,
  type OidcConfigResponse,
  type RoleCode,
} from '@/lib/types';

export { SsoProviderSchema };
export type { SsoProvider, SamlConfig, OidcConfig };

// The canonical SSO connection shape lives in lib/types (mirrored byte-for-byte
// with the edge _shared/types via the Zod canon). The connection list and detail
// surface also shows the row timestamps, so extend the canonical schema with the
// two read-only audit columns rather than redefining the core fields here, which
// would drift from the canon. default_role_code keeps the canon RoleCode enum, so
// an invalid role can never round-trip through this service.
export const SsoConnectionSchema = CanonSsoConnectionSchema.extend({
  created_at: z.string(),
  updated_at: z.string(),
});
export type SsoConnection = z.infer<typeof SsoConnectionSchema>;

export interface CreateSsoConnectionInput {
  provider: SsoProvider;
  display_name: string;
  default_role_code: RoleCode;
}

export interface UpdateSsoConnectionInput {
  display_name?: string;
  default_role_code?: RoleCode;
  is_active?: boolean;
  // F-Wave13-SSO-HANDSHAKE-01: the operator attestation that the IdP handshake
  // is wired in the Supabase project. The DB CHECK
  // (sso_connections_active_requires_validation) blocks is_active=true until
  // this is non-null. Set to an ISO timestamp to validate, null to revoke.
  provider_validated_at?: string | null;
}

// F-Wave13-SSO-HANDSHAKE-01 (MVP store-metadata): the IdP secrets
// (cert / endpoints / client secret) are written through settings-api, not
// directly via RLS, so the write is flag-gated (auth.sso_saml), cap-gated
// (org.sso.write), idempotent, and validated server-side. The connection
// record itself stays a direct RLS write (above). Storing metadata does not
// activate the connection: the operator wires the Supabase Auth provider, then
// marks the connection validated and activates it.
export interface ConfigureSamlMetadataInput {
  sso_connection_id: string;
  idp_entity_id: string;
  idp_sso_url: string;
  idp_metadata_url?: string | null;
  idp_x509_cert: string;
  sp_entity_id: string;
  sp_acs_url: string;
  attribute_mappings?: Record<string, unknown>;
  signature_algorithm?: string;
  want_assertions_signed?: boolean;
}

export async function configureSamlMetadata(
  input: ConfigureSamlMetadataInput,
): Promise<SamlConfig> {
  const data = await apiRequest<unknown>('/settings-api/sso/saml-metadata', {
    method: 'POST',
    body: input,
  });
  const parsed = SamlConfigSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error('Unexpected response while saving SAML metadata. Please retry.');
  }
  return parsed.data;
}

export interface ConfigureOidcMetadataInput {
  sso_connection_id: string;
  issuer_url: string;
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint: string;
  client_id: string;
  client_secret: string;
  scopes?: string[];
  attribute_mappings?: Record<string, unknown>;
}

export async function configureOidcMetadata(
  input: ConfigureOidcMetadataInput,
): Promise<OidcConfigResponse> {
  const data = await apiRequest<unknown>('/settings-api/sso/oidc-metadata', {
    method: 'POST',
    body: input,
  });
  // The response omits client_secret (write-only); parse with the response shape.
  const parsed = OidcConfigResponseSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error('Unexpected response while saving OIDC metadata. Please retry.');
  }
  return parsed.data;
}

/** List the active org's SSO connections (RLS scopes to the org). */
export async function listSsoConnections(): Promise<SsoConnection[]> {
  const { data, error } = await supabase
    .from('sso_connections')
    .select(
      'id, org_id, provider, display_name, is_active, default_role_code, provider_validated_at, created_at, updated_at',
    )
    .order('created_at', { ascending: true });
  if (error) {
    throw new Error(error.message || 'Could not load SSO connections.');
  }
  return z.array(SsoConnectionSchema).parse(data ?? []);
}

/**
 * Create a connection. org_id is stamped by current_org_id() via the RLS
 * WITH CHECK; we do not set it from the client. The row defaults to
 * is_active = false so a new connection never silently routes sign-ins
 * before the IdP handshake is wired in the Supabase project.
 */
export async function createSsoConnection(
  input: CreateSsoConnectionInput,
): Promise<SsoConnection> {
  const orgId = await resolveOrgId();
  const { data, error } = await supabase
    .from('sso_connections')
    .insert({
      org_id: orgId,
      provider: input.provider,
      display_name: input.display_name,
      default_role_code: input.default_role_code,
      is_active: false,
    })
    .select(
      'id, org_id, provider, display_name, is_active, default_role_code, provider_validated_at, created_at, updated_at',
    )
    .single();
  if (error) {
    throw new Error(error.message || 'Could not create the SSO connection.');
  }
  return SsoConnectionSchema.parse(data);
}

/** Update a connection (RLS enforces org + role). */
export async function updateSsoConnection(
  id: string,
  patch: UpdateSsoConnectionInput,
): Promise<SsoConnection> {
  const { data, error } = await supabase
    .from('sso_connections')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select(
      'id, org_id, provider, display_name, is_active, default_role_code, provider_validated_at, created_at, updated_at',
    )
    .single();
  if (error) {
    throw new Error(error.message || 'Could not update the SSO connection.');
  }
  return SsoConnectionSchema.parse(data);
}

/** Delete a connection (RLS enforces org + role). */
export async function deleteSsoConnection(id: string): Promise<void> {
  const { error } = await supabase
    .from('sso_connections')
    .delete()
    .eq('id', id);
  if (error) {
    throw new Error(error.message || 'Could not delete the SSO connection.');
  }
}

// The insert needs org_id for the WITH CHECK predicate. current_org_id()
// reads the JWT app_metadata claim; we read the same claim client side so the
// inserted row matches the RLS scope. A missing claim is a hard error: the
// admin route guard already requires an active org.
async function resolveOrgId(): Promise<string> {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) {
    throw new Error('No active session.');
  }
  const claim = (data.session.user.app_metadata as { kitstak_org_id?: unknown })
    ?.kitstak_org_id;
  if (typeof claim !== 'string' || claim.length === 0) {
    throw new Error('No active workspace. Switch into a workspace and retry.');
  }
  return claim;
}
