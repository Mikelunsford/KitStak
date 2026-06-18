// Pure quote-expiration helpers. No React, no supabase client, so the resolver
// and date math are unit-testable without env vars or a renderer. The org-wide
// default quote expiration lives in the settings store under
// quotes/default_expiration = { unit, amount }; settings are readable by every
// staff role, so the quote create form can seed from it. Mirrors the
// default-currency methodology (see `lib/defaultCurrency.ts`).

import { addDaysIso, todayIsoDate } from './dates';

export const QUOTE_EXPIRATION_GROUP = 'quotes';
export const QUOTE_EXPIRATION_KEY = 'default_expiration';

export type ExpirationUnit = 'day' | 'month' | 'year';

export interface ExpirationDuration {
  unit: ExpirationUnit;
  amount: number;
}

export interface ExpirationPreset {
  id: string;
  label: string;
  duration: ExpirationDuration;
}

// The operator-facing preset choices, in order. "Custom" (a typed number of
// days) and "No default" are handled by the Settings control, not listed here.
export const EXPIRATION_PRESETS: ReadonlyArray<ExpirationPreset> = [
  { id: '1d', label: '1 Day', duration: { unit: 'day', amount: 1 } },
  { id: '5d', label: '5 Days', duration: { unit: 'day', amount: 5 } },
  { id: '7d', label: '7 Days', duration: { unit: 'day', amount: 7 } },
  { id: '14d', label: '14 Days', duration: { unit: 'day', amount: 14 } },
  { id: '30d', label: '30 Days', duration: { unit: 'day', amount: 30 } },
  { id: '60d', label: '60 Days', duration: { unit: 'day', amount: 60 } },
  { id: '90d', label: '90 Days', duration: { unit: 'day', amount: 90 } },
  { id: '6mo', label: '6 Months', duration: { unit: 'month', amount: 6 } },
  { id: '1y', label: '1 Year', duration: { unit: 'year', amount: 1 } },
];

const UNITS: ReadonlyArray<ExpirationUnit> = ['day', 'month', 'year'];

function isValidDuration(value: unknown): value is ExpirationDuration {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.unit === 'string' &&
    UNITS.includes(v.unit as ExpirationUnit) &&
    typeof v.amount === 'number' &&
    Number.isInteger(v.amount) &&
    v.amount > 0
  );
}

interface SettingRowLike {
  group_key: string;
  setting_key: string;
  value: unknown;
}

/**
 * Pull the default expiration duration out of the quotes/default_expiration
 * setting row. Returns null when the row is absent or malformed (no default,
 * the operator sets the date per quote).
 */
export function resolveDefaultExpiration(
  settings: ReadonlyArray<SettingRowLike> | undefined,
): ExpirationDuration | null {
  const row = settings?.find(
    (s) =>
      s.group_key === QUOTE_EXPIRATION_GROUP &&
      s.setting_key === QUOTE_EXPIRATION_KEY,
  );
  if (row && isValidDuration(row.value)) {
    return { unit: row.value.unit, amount: row.value.amount };
  }
  return null;
}

/**
 * Add a duration to a YYYY-MM-DD date string and return YYYY-MM-DD. Days reuse
 * the TZ-safe addDaysIso; months and years use calendar math (so 6 Months from
 * the 15th lands on the 15th, with JS's standard end-of-month rollover).
 * Returns null on an unparseable input so callers can fall back.
 */
export function addExpiration(
  isoDate: string,
  duration: ExpirationDuration,
): string | null {
  if (duration.unit === 'day') return addDaysIso(isoDate, duration.amount);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!m) return null;
  const [, y, mo, d] = m;
  const base = new Date(Number(y), Number(mo) - 1, Number(d));
  if (Number.isNaN(base.getTime())) return null;
  if (duration.unit === 'month') {
    base.setMonth(base.getMonth() + duration.amount);
  } else {
    base.setFullYear(base.getFullYear() + duration.amount);
  }
  return todayIsoDate(base);
}

/**
 * Map a stored duration back to a Settings-dropdown value: 'none' when null,
 * a preset id when it matches one, otherwise 'custom'.
 */
export function presetIdForDuration(
  duration: ExpirationDuration | null,
): string {
  if (!duration) return 'none';
  const preset = EXPIRATION_PRESETS.find(
    (p) => p.duration.unit === duration.unit && p.duration.amount === duration.amount,
  );
  return preset ? preset.id : 'custom';
}

/**
 * The inverse: turn a Settings-dropdown value (plus the custom day count) into a
 * duration to store. 'none' clears the default; 'custom' is a day count.
 */
export function durationForPresetId(
  id: string,
  customDays: number,
): ExpirationDuration | null {
  if (id === 'none') return null;
  if (id === 'custom') {
    const amount = Number.isFinite(customDays) ? Math.max(1, Math.round(customDays)) : 1;
    return { unit: 'day', amount };
  }
  const preset = EXPIRATION_PRESETS.find((p) => p.id === id);
  return preset ? { ...preset.duration } : null;
}
