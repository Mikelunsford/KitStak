import { useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { TextInput } from '@/components/ui/TextInput';
import {
  useSettings,
  useUpsertSetting,
  useDeleteSetting,
} from '@/lib/hooks/useSettings';
import { useAuth } from '@/auth/AuthContext';
import { useCurrenciesList } from '@/lib/hooks/useCurrencies';
import {
  resolveDefaultCurrency,
  DEFAULT_CURRENCY_GROUP,
  DEFAULT_CURRENCY_KEY,
} from '@/lib/defaultCurrency';
import {
  resolveDefaultExpiration,
  presetIdForDuration,
  durationForPresetId,
  EXPIRATION_PRESETS,
  QUOTE_EXPIRATION_GROUP,
  QUOTE_EXPIRATION_KEY,
} from '@/lib/quoteExpiration';

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

  // Default-currency control: a dedicated dropdown over the general/
  // default_currency setting. Settings are readable by every staff role, so the
  // create forms can seed their currency from it; saving needs settings.write.
  const { data: currencies } = useCurrenciesList();
  const currentDefaultCurrency = resolveDefaultCurrency(queryData);
  const [currencyChoice, setCurrencyChoice] = useState(currentDefaultCurrency);
  useEffect(() => {
    setCurrencyChoice(currentDefaultCurrency);
  }, [currentDefaultCurrency]);

  // Default quote-expiration control: a duration-preset dropdown plus a custom
  // day count, over the quotes/default_expiration setting.
  const currentDefaultExpiration = useMemo(
    () => resolveDefaultExpiration(queryData),
    [queryData],
  );
  const currentExpId = presetIdForDuration(currentDefaultExpiration);
  const [expChoice, setExpChoice] = useState(currentExpId);
  const [customDays, setCustomDays] = useState(
    currentExpId === 'custom' && currentDefaultExpiration
      ? currentDefaultExpiration.amount
      : 30,
  );
  useEffect(() => {
    setExpChoice(currentExpId);
    if (currentExpId === 'custom' && currentDefaultExpiration) {
      setCustomDays(currentDefaultExpiration.amount);
    }
  }, [currentExpId, currentDefaultExpiration]);

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

      <section className="border border-line p-4">
        <h2 className="mb-1 font-display text-xl text-ink">Default currency</h2>
        <p className="mb-4 font-sans text-sm text-ink-dim">
          The system-wide currency new quotes, invoices, and other documents
          start with. Operators can still override it per document under
          Advanced.
        </p>
        <div className="flex items-end gap-3">
          <label className="flex flex-col gap-2">
            <span className="font-sans text-sm uppercase tracking-wide text-ink-dim">
              Currency
            </span>
            <select
              value={currencyChoice}
              onChange={(e) => setCurrencyChoice(e.target.value)}
              className="border border-line bg-bg-2 px-4 py-3 font-sans text-ink focus:border-accent focus:outline-none"
            >
              {(currencies && currencies.length > 0
                ? currencies
                : [{ code: currencyChoice }]
              ).map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code}
                </option>
              ))}
            </select>
          </label>
          <Button
            onClick={() =>
              upsert.mutate({
                group_key: DEFAULT_CURRENCY_GROUP,
                setting_key: DEFAULT_CURRENCY_KEY,
                value: { code: currencyChoice },
              })
            }
            disabled={upsert.isPending || currencyChoice === currentDefaultCurrency}
          >
            {upsert.isPending ? 'Saving.' : 'Save default'}
          </Button>
        </div>
      </section>

      <section className="border border-line p-4">
        <h2 className="mb-1 font-display text-xl text-ink">
          Default quote expiration
        </h2>
        <p className="mb-4 font-sans text-sm text-ink-dim">
          New quotes start with this expiration (today plus the duration).
          Operators can still override the date per quote under Advanced.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-2">
            <span className="font-sans text-sm uppercase tracking-wide text-ink-dim">
              Expiration
            </span>
            <select
              value={expChoice}
              onChange={(e) => setExpChoice(e.target.value)}
              className="border border-line bg-bg-2 px-4 py-3 font-sans text-ink focus:border-accent focus:outline-none"
            >
              <option value="none">No default</option>
              {EXPIRATION_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
              <option value="custom">Custom (days)</option>
            </select>
          </label>
          {expChoice === 'custom' && (
            <label className="flex flex-col gap-2">
              <span className="font-sans text-sm uppercase tracking-wide text-ink-dim">
                Days
              </span>
              <input
                type="number"
                min={1}
                value={customDays}
                onChange={(e) => setCustomDays(Number(e.target.value))}
                className="w-28 border border-line bg-bg-2 px-4 py-3 font-sans text-ink focus:border-accent focus:outline-none"
              />
            </label>
          )}
          <Button
            onClick={() => {
              const duration = durationForPresetId(expChoice, customDays);
              if (duration === null) {
                remove.mutate({
                  group: QUOTE_EXPIRATION_GROUP,
                  key: QUOTE_EXPIRATION_KEY,
                });
              } else {
                upsert.mutate({
                  group_key: QUOTE_EXPIRATION_GROUP,
                  setting_key: QUOTE_EXPIRATION_KEY,
                  value: { unit: duration.unit, amount: duration.amount },
                });
              }
            }}
            disabled={upsert.isPending || remove.isPending}
          >
            {upsert.isPending || remove.isPending ? 'Saving.' : 'Save default'}
          </Button>
        </div>
      </section>

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
