// Pure default-currency helpers. No React, no supabase client, so the resolver
// is unit-testable without env vars or a renderer (the repo runs Vitest without
// jsdom). The org-wide default transaction currency lives in the settings store
// under general/default_currency = { code: 'USD' }; settings are readable by
// every staff role, so create forms can seed from it. organizations.
// default_currency_code stays the per-record default the API may set elsewhere.

export const DEFAULT_CURRENCY_GROUP = 'general';
export const DEFAULT_CURRENCY_KEY = 'default_currency';
export const FALLBACK_CURRENCY = 'USD';

interface SettingRowLike {
  group_key: string;
  setting_key: string;
  value: unknown;
}

/**
 * Pull the three-letter currency code out of the general/default_currency
 * setting row. Returns the fallback when the row is missing or malformed.
 */
export function resolveDefaultCurrency(
  settings: ReadonlyArray<SettingRowLike> | undefined,
): string {
  const row = settings?.find(
    (s) =>
      s.group_key === DEFAULT_CURRENCY_GROUP &&
      s.setting_key === DEFAULT_CURRENCY_KEY,
  );
  const value = row?.value;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const code = (value as Record<string, unknown>).code;
    if (typeof code === 'string' && /^[A-Za-z]{3}$/.test(code)) {
      return code.toUpperCase();
    }
  }
  return FALLBACK_CURRENCY;
}
