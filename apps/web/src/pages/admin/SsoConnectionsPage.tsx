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
} from '@/lib/hooks/useSso';
import { INVITE_ROLE_OPTIONS } from './membersInviteForm';
import {
  SSO_PROVIDER_OPTIONS,
  DEFAULT_SSO_PROVIDER,
  isSsoFormSubmittable,
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

  const [provider, setProvider] = useState<SsoProvider>(DEFAULT_SSO_PROVIDER);
  const [displayName, setDisplayName] = useState('');
  const [defaultRole, setDefaultRole] = useState<RoleCode>('viewer');
  const [formError, setFormError] = useState<string | null>(null);

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
    update.mutate({ id: row.id, patch: { is_active: !row.is_active } });
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
                  <StatusBadge status={row.is_active ? 'active' : 'inactive'} />
                  {canWrite ? (
                    <>
                      <Button
                        variant="secondary"
                        onClick={() => handleToggleActive(row)}
                        disabled={update.isPending}
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
    </section>
  );
}
