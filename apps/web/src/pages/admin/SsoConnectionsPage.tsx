// /admin/sso. Single sign-on connection management. R-W13-AUTH-01.
//
// Surfaces the sso_connections table (Pattern A RLS, migration 0002) so an
// org_owner or org_admin can register, activate, deactivate, and remove the
// org's SSO providers. The route is admin-guarded; the org.sso.read /
// org.sso.write caps mirror the button visibility, and RLS on the table is
// the server authority.
//
// SCOPE NOTE (deferred, see unit blockers): this manages the connection
// record only (protocol kind, display name, default role, active flag). The
// full SAML / OIDC handshake (IdP metadata exchange, ACS endpoint, assertion
// signing) is a Supabase Auth provider concern configured in the Supabase
// project, so a new connection defaults to inactive and a banner explains
// that the identity-provider handshake is configured separately. The
// saml_configs child table is intentionally not edited here yet.
//
// Copy discipline: brand voice, no em dash, no double hyphen, no emoji.

import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { TextInput } from '@/components/ui/TextInput';
import { Select } from '@/components/ui/Select';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { RelativeTime } from '@/components/ui/RelativeTime';
import { ListEmptyState } from '@/components/shell/ListEmptyState';
import { destructiveConfirm } from '@/lib/destructiveConfirm';
import { useAuth } from '@/auth/AuthContext';
import { useCapabilities } from '@/lib/hooks/useCapabilities';
import {
  useSsoConnections,
  useCreateSsoConnection,
  useUpdateSsoConnection,
  useDeleteSsoConnection,
  useConfigureSamlMetadata,
  useConfigureOidcMetadata,
} from '@/lib/hooks/useSso';
import { INVITE_ROLE_OPTIONS } from './membersInviteForm';
import {
  SSO_PROVIDER_OPTIONS,
  DEFAULT_SSO_PROVIDER,
  isSsoFormSubmittable,
  isSamlConfigSubmittable,
  isOidcConfigSubmittable,
  type SamlConfigFormState,
  type OidcConfigFormState,
} from './ssoConnectionForm';
import type { SsoProvider, SsoConnection } from '@/lib/services/ssoService';
import type { RoleCode } from '@/lib/types';

export function SsoConnectionsPage() {
  const { state } = useAuth();
  const enabled = state.status === 'authenticated';
  const { can } = useCapabilities();
  const canWrite = can('org.sso.write');

  const connections = useSsoConnections({ enabled });
  const create = useCreateSsoConnection();
  const update = useUpdateSsoConnection();
  const remove = useDeleteSsoConnection();
  const configureSaml = useConfigureSamlMetadata();
  const configureOidc = useConfigureOidcMetadata();

  const [provider, setProvider] = useState<SsoProvider>(DEFAULT_SSO_PROVIDER);
  const [displayName, setDisplayName] = useState('');
  const [defaultRole, setDefaultRole] = useState<RoleCode>('viewer');
  const [formError, setFormError] = useState<string | null>(null);

  // F-Wave13-SSO-HANDSHAKE-01: the connection whose IdP metadata is being
  // configured, plus the per-protocol field state and the config notices.
  const [configId, setConfigId] = useState<string | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [configNotice, setConfigNotice] = useState<string | null>(null);
  const [saml, setSaml] = useState<SamlConfigFormState>({
    idpEntityId: '',
    idpSsoUrl: '',
    idpX509Cert: '',
    spEntityId: '',
    spAcsUrl: '',
  });
  const [oidc, setOidc] = useState<OidcConfigFormState>({
    issuerUrl: '',
    authorizationEndpoint: '',
    tokenEndpoint: '',
    userinfoEndpoint: '',
    clientId: '',
    clientSecret: '',
  });

  const configConn =
    (connections.data ?? []).find((c) => c.id === configId) ?? null;

  const canSubmit =
    canWrite &&
    isSsoFormSubmittable({ displayName, isPending: create.isPending });

  function handleCreate() {
    setFormError(null);
    if (!canSubmit) return;
    create.mutate(
      {
        provider,
        display_name: displayName.trim(),
        default_role_code: defaultRole,
      },
      {
        onSuccess: () => {
          setDisplayName('');
          setProvider(DEFAULT_SSO_PROVIDER);
          setDefaultRole('viewer');
        },
        onError: (err: unknown) => {
          setFormError(err instanceof Error ? err.message : 'Create failed.');
        },
      },
    );
  }

  function handleToggleActive(row: SsoConnection) {
    if (update.isPending) return;
    // Deactivating is always allowed. Activating requires the operator to have
    // marked the provider validated first; the DB CHECK enforces this too, but
    // gating here surfaces a clear message instead of a constraint error.
    if (!row.is_active && row.provider_validated_at === null) {
      setConfigId(row.id);
      setConfigNotice(null);
      setConfigError(
        'Mark the provider validated before activating. Wire the IdP handshake in Supabase, then use Mark validated.',
      );
      return;
    }
    update.mutate({ id: row.id, patch: { is_active: !row.is_active } });
  }

  function handleConfigure(row: SsoConnection) {
    setConfigError(null);
    setConfigNotice(null);
    setConfigId(row.id);
  }

  function handleMarkValidated(row: SsoConnection) {
    // Only fire when the open panel still reflects this live connection (guards
    // a refetch that deleted the row mid-interaction).
    if (update.isPending || !configConn || configConn.id !== row.id) return;
    setConfigError(null);
    setConfigNotice(null);
    update.mutate(
      { id: row.id, patch: { provider_validated_at: new Date().toISOString() } },
      {
        onSuccess: () =>
          setConfigNotice('Provider marked validated. You can activate the connection now.'),
        onError: (err: unknown) =>
          setConfigError(err instanceof Error ? err.message : 'Mark validated failed.'),
      },
    );
  }

  function handleSaveSaml() {
    setConfigError(null);
    setConfigNotice(null);
    if (!configConn) return;
    configureSaml.mutate(
      {
        sso_connection_id: configConn.id,
        idp_entity_id: saml.idpEntityId.trim(),
        idp_sso_url: saml.idpSsoUrl.trim(),
        idp_x509_cert: saml.idpX509Cert.trim(),
        sp_entity_id: saml.spEntityId.trim(),
        sp_acs_url: saml.spAcsUrl.trim(),
      },
      {
        onSuccess: () =>
          setConfigNotice('SAML metadata saved. Wire the provider in Supabase, then mark it validated.'),
        onError: (err: unknown) =>
          setConfigError(err instanceof Error ? err.message : 'Save failed.'),
      },
    );
  }

  function handleSaveOidc() {
    setConfigError(null);
    setConfigNotice(null);
    if (!configConn) return;
    configureOidc.mutate(
      {
        sso_connection_id: configConn.id,
        issuer_url: oidc.issuerUrl.trim(),
        authorization_endpoint: oidc.authorizationEndpoint.trim(),
        token_endpoint: oidc.tokenEndpoint.trim(),
        userinfo_endpoint: oidc.userinfoEndpoint.trim(),
        client_id: oidc.clientId.trim(),
        client_secret: oidc.clientSecret.trim(),
      },
      {
        onSuccess: () =>
          setConfigNotice('OIDC metadata saved. Wire the provider in Supabase, then mark it validated.'),
        onError: (err: unknown) =>
          setConfigError(err instanceof Error ? err.message : 'Save failed.'),
      },
    );
  }

  async function handleDelete(row: SsoConnection) {
    const ok = await destructiveConfirm({
      action: `Delete the ${row.display_name} SSO connection`,
      consequence:
        'Members who sign in through this provider will lose that path until it is set up again.',
      irreversible: true,
    });
    if (!ok) return;
    remove.mutate(row.id);
  }

  return (
    <section className="px-8 py-10 max-w-4xl mx-auto flex flex-col gap-10">
      <header className="flex flex-col gap-2">
        <h1 className="text-4xl font-display tracking-wide text-ink">
          SINGLE SIGN-ON
        </h1>
        <p className="font-sans text-sm text-ink-dim max-w-2xl">
          Register the identity providers your team uses to sign in. A new
          connection stays inactive until the provider handshake is configured
          for your workspace. Reach out to support to finish wiring a provider.
        </p>
      </header>

      <section className="flex flex-col gap-4" data-testid="sso-list-section">
        <h2 className="font-display text-2xl tracking-wide text-ink">
          CONNECTIONS
        </h2>

        {connections.isLoading ? (
          <p className="font-sans text-sm text-ink-dim" data-testid="sso-loading">
            Loading.
          </p>
        ) : connections.isError ? (
          <p
            role="alert"
            className="font-sans text-sm text-accent border-l-2 border-accent pl-3 py-2 bg-accent/5"
            data-testid="sso-load-error"
          >
            Could not load SSO connections.
          </p>
        ) : (connections.data ?? []).length === 0 ? (
          <ListEmptyState
            entity="SSO connection"
            explainer="Add a provider below to let your team sign in with single sign-on."
            addLabel="Add connection"
            addTo="/admin/sso"
            canAdd={false}
          />
        ) : (
          <ul className="flex flex-col gap-2" data-testid="sso-list">
            {(connections.data ?? []).map((row) => (
              <li
                key={row.id}
                className="flex items-center justify-between gap-4 border border-line px-4 py-3"
                data-testid="sso-row"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <ShieldCheck
                    size={20}
                    strokeWidth={2}
                    className={row.is_active ? 'text-success' : 'text-ink-faint'}
                    aria-hidden="true"
                  />
                  <div className="flex flex-col min-w-0">
                    <span className="font-sans text-sm text-ink truncate">
                      {row.display_name}
                    </span>
                    <span className="font-sans text-xs text-ink-faint uppercase tracking-wide">
                      {row.provider} · default role {row.default_role_code}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <RelativeTime value={row.created_at} />
                  <span
                    className={`font-sans text-xs uppercase tracking-wide ${
                      row.provider_validated_at ? 'text-success' : 'text-ink-faint'
                    }`}
                    data-testid="sso-validated-badge"
                  >
                    {row.provider_validated_at ? 'Validated' : 'Not validated'}
                  </span>
                  <StatusBadge status={row.is_active ? 'active' : 'inactive'} />
                  {canWrite ? (
                    <>
                      <Button
                        variant="secondary"
                        onClick={() => handleConfigure(row)}
                        data-testid="sso-configure-button"
                      >
                        Configure
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() => handleToggleActive(row)}
                        disabled={
                          update.isPending ||
                          (!row.is_active && row.provider_validated_at === null)
                        }
                        title={
                          !row.is_active && row.provider_validated_at === null
                            ? 'Mark the provider validated before activating.'
                            : undefined
                        }
                        data-testid="sso-toggle-button"
                      >
                        {row.is_active ? 'Deactivate' : 'Activate'}
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => void handleDelete(row)}
                        disabled={remove.isPending}
                        data-testid="sso-delete-button"
                      >
                        Delete
                      </Button>
                    </>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {canWrite ? (
        <section
          className="border border-line bg-bg-2 p-5 flex flex-col gap-4"
          data-testid="sso-create-section"
        >
          <h2 className="font-display text-2xl tracking-wide text-ink">
            ADD A CONNECTION
          </h2>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="flex flex-col gap-2">
              <span className="font-sans text-sm text-ink-dim tracking-wide uppercase">
                Protocol
              </span>
              <Select
                value={provider}
                onChange={(e) => setProvider(e.target.value as SsoProvider)}
                data-testid="sso-provider-select"
              >
                {SSO_PROVIDER_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </Select>
            </label>
            <TextInput
              label="Display name"
              name="sso_display_name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              data-testid="sso-display-name-input"
            />
            <label className="flex flex-col gap-2">
              <span className="font-sans text-sm text-ink-dim tracking-wide uppercase">
                Default role for new users
              </span>
              <Select
                value={defaultRole}
                onChange={(e) => setDefaultRole(e.target.value as RoleCode)}
                data-testid="sso-default-role-select"
              >
                {INVITE_ROLE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </Select>
            </label>
          </div>

          {formError ? (
            <p
              role="alert"
              className="font-sans text-sm text-accent border-l-2 border-accent pl-3 py-2 bg-accent/5"
              data-testid="sso-create-error"
            >
              {formError}
            </p>
          ) : null}

          <div>
            <Button
              onClick={handleCreate}
              disabled={!canSubmit}
              data-testid="sso-create-button"
            >
              {create.isPending ? 'Adding...' : 'Add connection'}
            </Button>
          </div>
        </section>
      ) : null}

      {canWrite && configConn ? (
        <section
          className="border border-line bg-bg-2 p-5 flex flex-col gap-4"
          data-testid="sso-config-section"
        >
          <div className="flex items-center justify-between gap-4">
            <h2 className="font-display text-2xl tracking-wide text-ink">
              CONFIGURE PROVIDER
            </h2>
            <Button
              variant="ghost"
              onClick={() => setConfigId(null)}
              data-testid="sso-config-close"
            >
              Close
            </Button>
          </div>
          <p className="font-sans text-sm text-ink-dim">
            {configConn.display_name} · {configConn.provider.toUpperCase()}. Store
            the identity-provider metadata, then wire the matching provider in the
            Supabase project. Mark the connection validated once the handshake is
            confirmed. Only a validated connection can be activated.
          </p>

          {configConn.provider === 'saml' ? (
            <div className="grid gap-4 md:grid-cols-2">
              <TextInput
                label="IdP entity ID"
                name="saml_idp_entity_id"
                value={saml.idpEntityId}
                onChange={(e) => setSaml({ ...saml, idpEntityId: e.target.value })}
                data-testid="saml-idp-entity-id"
              />
              <TextInput
                label="IdP SSO URL"
                name="saml_idp_sso_url"
                value={saml.idpSsoUrl}
                onChange={(e) => setSaml({ ...saml, idpSsoUrl: e.target.value })}
                data-testid="saml-idp-sso-url"
              />
              <TextInput
                label="SP entity ID"
                name="saml_sp_entity_id"
                value={saml.spEntityId}
                onChange={(e) => setSaml({ ...saml, spEntityId: e.target.value })}
                data-testid="saml-sp-entity-id"
              />
              <TextInput
                label="SP ACS URL"
                name="saml_sp_acs_url"
                value={saml.spAcsUrl}
                onChange={(e) => setSaml({ ...saml, spAcsUrl: e.target.value })}
                data-testid="saml-sp-acs-url"
              />
              <label className="flex flex-col gap-2 md:col-span-2">
                <span className="font-sans text-sm text-ink-dim tracking-wide uppercase">
                  IdP x509 certificate
                </span>
                <textarea
                  className="bg-bg-2 border border-line text-ink px-4 py-3 font-mono text-xs focus:outline-none focus:border-accent min-h-[8rem]"
                  value={saml.idpX509Cert}
                  onChange={(e) => setSaml({ ...saml, idpX509Cert: e.target.value })}
                  data-testid="saml-idp-x509-cert"
                />
              </label>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              <TextInput
                label="Issuer URL"
                name="oidc_issuer_url"
                value={oidc.issuerUrl}
                onChange={(e) => setOidc({ ...oidc, issuerUrl: e.target.value })}
                data-testid="oidc-issuer-url"
              />
              <TextInput
                label="Authorization endpoint"
                name="oidc_authorization_endpoint"
                value={oidc.authorizationEndpoint}
                onChange={(e) =>
                  setOidc({ ...oidc, authorizationEndpoint: e.target.value })
                }
                data-testid="oidc-authorization-endpoint"
              />
              <TextInput
                label="Token endpoint"
                name="oidc_token_endpoint"
                value={oidc.tokenEndpoint}
                onChange={(e) => setOidc({ ...oidc, tokenEndpoint: e.target.value })}
                data-testid="oidc-token-endpoint"
              />
              <TextInput
                label="Userinfo endpoint"
                name="oidc_userinfo_endpoint"
                value={oidc.userinfoEndpoint}
                onChange={(e) => setOidc({ ...oidc, userinfoEndpoint: e.target.value })}
                data-testid="oidc-userinfo-endpoint"
              />
              <TextInput
                label="Client ID"
                name="oidc_client_id"
                value={oidc.clientId}
                onChange={(e) => setOidc({ ...oidc, clientId: e.target.value })}
                data-testid="oidc-client-id"
              />
              <TextInput
                label="Client secret"
                name="oidc_client_secret"
                type="password"
                value={oidc.clientSecret}
                onChange={(e) => setOidc({ ...oidc, clientSecret: e.target.value })}
                data-testid="oidc-client-secret"
              />
            </div>
          )}

          {configError ? (
            <p
              role="alert"
              className="font-sans text-sm text-accent border-l-2 border-accent pl-3 py-2 bg-accent/5"
              data-testid="sso-config-error"
            >
              {configError}
            </p>
          ) : null}
          {configNotice ? (
            <p
              className="font-sans text-sm text-success border-l-2 border-success pl-3 py-2 bg-success/5"
              data-testid="sso-config-notice"
            >
              {configNotice}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            {configConn.provider === 'saml' ? (
              <Button
                onClick={handleSaveSaml}
                disabled={!isSamlConfigSubmittable(saml, configureSaml.isPending)}
                data-testid="sso-save-saml"
              >
                {configureSaml.isPending ? 'Saving...' : 'Save SAML metadata'}
              </Button>
            ) : (
              <Button
                onClick={handleSaveOidc}
                disabled={!isOidcConfigSubmittable(oidc, configureOidc.isPending)}
                data-testid="sso-save-oidc"
              >
                {configureOidc.isPending ? 'Saving...' : 'Save OIDC metadata'}
              </Button>
            )}
            <Button
              variant="secondary"
              onClick={() => handleMarkValidated(configConn)}
              disabled={update.isPending || configConn.provider_validated_at !== null}
              title={
                configConn.provider_validated_at !== null ? 'Already validated.' : undefined
              }
              data-testid="sso-mark-validated"
            >
              {configConn.provider_validated_at !== null ? 'Validated' : 'Mark validated'}
            </Button>
          </div>
        </section>
      ) : null}
    </section>
  );
}
