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
import {
  SsoConnectionSchema as CanonSsoConnectionSchema,
  SsoProviderSchema,
  type SsoProvider,
  type RoleCode,
} from '@/lib/types';

export { SsoProviderSchema };
export type { SsoProvider };

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
}

/** List the active org's SSO connections (RLS scopes to the org). */
export async function listSsoConnections(): Promise<SsoConnection[]> {
  const { data, error } = await supabase
    .from('sso_connections')
    .select(
      'id, org_id, provider, display_name, is_active, default_role_code, created_at, updated_at',
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
      'id, org_id, provider, display_name, is_active, default_role_code, created_at, updated_at',
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
      'id, org_id, provider, display_name, is_active, default_role_code, created_at, updated_at',
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
