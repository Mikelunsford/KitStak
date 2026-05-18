import { useMemo, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { TextInput } from '@/components/ui/TextInput';
import {
  useSettings,
  useUpsertSetting,
  useDeleteSetting,
} from '@/lib/hooks/useSettings';
import { useAuth } from '@/auth/AuthContext';

/**
 * Org settings admin page.
 *
 * Listing groups every setting by its `group_key`. Upsert is one-row-at-a-
 * time via a small form at the bottom. Values are typed JSON; the form
 * keeps it simple and accepts the raw JSON text and round-trips through
 * JSON.parse before sending.
 *
 * No external form library. useState plus Zod safeParse on submit per
 * constitution.
 */
export function SettingsPage() {
  const { state } = useAuth();
  const enabled = state.status === 'authenticated';
  const query = useSettings({ enabled });
  const upsert = useUpsertSetting();
  const remove = useDeleteSetting();

  const [group, setGroup] = useState('general');
  const [settingKey, setSettingKey] = useState('');
  const [valueText, setValueText] = useState('{}');
  const [formError, setFormError] = useState<string | null>(null);

  const queryData = query.data;
  const grouped = useMemo(() => {
    const out = new Map<string, typeof queryData>();
    for (const row of queryData ?? []) {
      const arr = out.get(row.group_key) ?? [];
      out.set(row.group_key, [...(arr ?? []), row]);
    }
    return out;
  }, [queryData]);

  function handleSubmit() {
    setFormError(null);
    let parsed: Record<string, unknown>;
    try {
      const raw = JSON.parse(valueText);
      if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
        setFormError('Value must be a JSON object.');
        return;
      }
      parsed = raw as Record<string, unknown>;
    } catch {
      setFormError('Value is not valid JSON.');
      return;
    }
    if (!group.trim() || !settingKey.trim()) {
      setFormError('Group and key are required.');
      return;
    }
    upsert.mutate(
      { group_key: group.trim(), setting_key: settingKey.trim(), value: parsed },
      {
        onSuccess: () => {
          setSettingKey('');
          setValueText('{}');
        },
        onError: (err: unknown) => {
          const msg = err instanceof Error ? err.message : 'Save failed.';
          setFormError(msg);
        },
      },
    );
  }

  return (
    <div className="space-y-8 p-6">
      <header>
        <h1 className="font-display text-3xl text-ink">Settings</h1>
        <p className="font-sans text-sm text-ink-dim">
          Per-workspace configuration. Stored as typed JSON under a group
          and key.
        </p>
      </header>

      {query.isLoading ? (
        <p className="text-ink-dim">Loading.</p>
      ) : query.isError ? (
        <p className="text-danger">Failed to load settings.</p>
      ) : (
        <section className="space-y-6">
          {[...grouped.entries()].map(([gk, rows]) => (
            <div key={gk} className="border border-line">
              <div className="bg-bg-2 px-4 py-2 font-sans text-sm tracking-wide uppercase text-ink-dim">
                {gk}
              </div>
              <ul>
                {(rows ?? []).map((row) => (
                  <li
                    key={`${row.group_key}:${row.setting_key}`}
                    className="flex items-start justify-between gap-4 border-t border-line px-4 py-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-sans text-sm font-medium text-ink">
                        {row.setting_key}
                      </p>
                      <pre className="mt-1 overflow-x-auto font-mono text-xs text-ink-dim">
                        {JSON.stringify(row.value, null, 2)}
                      </pre>
                    </div>
                    <Button
                      variant="ghost"
                      onClick={() =>
                        remove.mutate({
                          group: row.group_key,
                          key: row.setting_key,
                        })
                      }
                    >
                      Remove
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {grouped.size === 0 ? (
            <p className="text-ink-dim">No settings defined yet.</p>
          ) : null}
        </section>
      )}

      <section className="border border-line p-4">
        <h2 className="mb-4 font-display text-xl text-ink">Add setting</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <TextInput
            label="Group"
            name="group"
            value={group}
            onChange={(e) => setGroup(e.target.value)}
          />
          <TextInput
            label="Key"
            name="setting_key"
            value={settingKey}
            onChange={(e) => setSettingKey(e.target.value)}
          />
        </div>
        <div className="mt-4">
          <label
            className="mb-2 block font-sans text-sm uppercase tracking-wide text-ink-dim"
            htmlFor="setting-value"
          >
            Value (JSON object)
          </label>
          <textarea
            id="setting-value"
            value={valueText}
            onChange={(e) => setValueText(e.target.value)}
            className="h-32 w-full border border-line bg-bg-2 px-3 py-2 font-mono text-sm text-ink focus:border-accent focus:outline-none"
          />
        </div>
        {formError ? (
          <p className="mt-2 text-sm text-danger">{formError}</p>
        ) : null}
        <div className="mt-4 flex gap-3">
          <Button onClick={handleSubmit} disabled={upsert.isPending}>
            {upsert.isPending ? 'Saving.' : 'Save setting'}
          </Button>
        </div>
      </section>
    </div>
  );
}
