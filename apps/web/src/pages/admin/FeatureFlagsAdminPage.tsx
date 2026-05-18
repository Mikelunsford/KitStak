import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { useAuth } from '@/auth/AuthContext';
import { useFlags, useUpsertFlag } from '@/lib/hooks/useFlags';

/**
 * Feature-flag admin page.
 *
 * Read-only listing of every flag row for the active org with a toggle that
 * upserts the row through settings-api. Optimistic UI is intentionally
 * absent; flag flips are infrequent and audit-relevant, so we wait for the
 * server round-trip before painting the new state.
 */
export function FeatureFlagsAdminPage() {
  const { state } = useAuth();
  const enabled = state.status === 'authenticated';
  const query = useFlags({ enabled });
  const upsert = useUpsertFlag();
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  function toggle(flagKey: string, current: boolean) {
    setPendingKey(flagKey);
    upsert.mutate(
      { flag_key: flagKey, is_enabled: !current, config: {} },
      {
        onSettled: () => {
          setPendingKey(null);
        },
      },
    );
  }

  return (
    <div className="space-y-6 p-6">
      <header>
        <h1 className="font-display text-3xl text-ink">Feature flags</h1>
        <p className="font-sans text-sm text-ink-dim">
          Per-workspace feature toggles. Bundle-level flags hide a plugin
          entirely; per-route flags surface a feature-unavailable page when
          off.
        </p>
      </header>

      {query.isLoading ? (
        <p className="text-ink-dim">Loading.</p>
      ) : query.isError ? (
        <p className="text-danger">Failed to load flags.</p>
      ) : (
        <table className="w-full border border-line">
          <thead>
            <tr className="bg-bg-2 text-left">
              <th className="px-4 py-2 font-sans text-sm uppercase tracking-wide text-ink-dim">
                Flag key
              </th>
              <th className="px-4 py-2 font-sans text-sm uppercase tracking-wide text-ink-dim">
                State
              </th>
              <th className="px-4 py-2 text-right" />
            </tr>
          </thead>
          <tbody>
            {(query.data ?? []).map((row) => (
              <tr key={row.flag_key} className="border-t border-line">
                <td className="px-4 py-3 font-mono text-sm text-ink">
                  {row.flag_key}
                </td>
                <td className="px-4 py-3 font-sans text-sm text-ink-dim">
                  {row.is_enabled ? 'Enabled' : 'Disabled'}
                </td>
                <td className="px-4 py-3 text-right">
                  <Button
                    variant="secondary"
                    onClick={() => toggle(row.flag_key, row.is_enabled)}
                    disabled={pendingKey === row.flag_key}
                  >
                    {pendingKey === row.flag_key
                      ? 'Saving.'
                      : row.is_enabled
                        ? 'Disable'
                        : 'Enable'}
                  </Button>
                </td>
              </tr>
            ))}
            {(query.data ?? []).length === 0 ? (
              <tr>
                <td colSpan={3} className="px-4 py-6 text-ink-dim">
                  No flags configured for this workspace.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      )}
    </div>
  );
}
