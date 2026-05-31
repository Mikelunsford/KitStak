// Unit tests for the date helpers added in B3 (Wave B): todayIsoDate
// and addDaysIso. These back the auto-default behaviour for the
// invoice issue / due date and the payment received-at fields.

import { describe, it, expect } from 'vitest';

import {
  addDaysIso,
  formatDateMedium,
  formatDateShort,
  formatDateTimeMedium,
  NULL_DATE_PLACEHOLDER,
  todayIsoDate,
} from './dates';

describe('todayIsoDate', () => {
  it('formats a date in YYYY-MM-DD with zero-padded month and day', () => {
    // Date constructor's month is 0-based.
    expect(todayIsoDate(new Date(2026, 0, 1))).toBe('2026-01-01');
    expect(todayIsoDate(new Date(2026, 11, 31))).toBe('2026-12-31');
  });

  it('zero-pads single-digit components', () => {
    expect(todayIsoDate(new Date(2026, 4, 5))).toBe('2026-05-05');
  });

  it('uses local-clock year so a UTC string is not consulted', () => {
    // The function should not stringify via toISOString — that would
    // convert local 2026-05-22 23:30 to UTC 2026-05-23 in negative-UTC
    // timezones. This test asserts the local-clock contract by passing
    // a Date whose .getDate() is explicit.
    const d = new Date(2026, 4, 22, 23, 30, 0);
    expect(todayIsoDate(d)).toBe('2026-05-22');
  });
});

describe('addDaysIso', () => {
  it('adds N days to a YYYY-MM-DD string', () => {
    expect(addDaysIso('2026-05-22', 30)).toBe('2026-06-21');
  });

  it('handles month rollover', () => {
    expect(addDaysIso('2026-05-31', 1)).toBe('2026-06-01');
  });

  it('handles year rollover', () => {
    expect(addDaysIso('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('handles leap-year boundary', () => {
    expect(addDaysIso('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDaysIso('2024-02-29', 1)).toBe('2024-03-01');
    expect(addDaysIso('2025-02-28', 1)).toBe('2025-03-01');
  });

  it('accepts zero and negative offsets', () => {
    expect(addDaysIso('2026-05-22', 0)).toBe('2026-05-22');
    expect(addDaysIso('2026-05-22', -1)).toBe('2026-05-21');
  });

  it('returns null when the input is empty', () => {
    expect(addDaysIso('', 30)).toBeNull();
  });

  it('returns null when the input is not in YYYY-MM-DD form', () => {
    expect(addDaysIso('2026/05/22', 30)).toBeNull();
    expect(addDaysIso('not-a-date', 30)).toBeNull();
    expect(addDaysIso('2026-5-22', 30)).toBeNull();
  });
});

// F-Wave9-PORTAL-NULL-PLACEHOLDER-01: the customer portal smoke walk caught
// empty dates rendering as a literal period (".") because the formatters
// returned "." for null. The replacement placeholder is the centered dot
// `·` (U+00B7) — visually distinct from a period, and constitutional (em
// dashes and double hyphens are banned on disk).
describe('formatDateMedium null handling', () => {
  it('renders the NULL_DATE_PLACEHOLDER for null', () => {
    expect(formatDateMedium(null)).toBe(NULL_DATE_PLACEHOLDER);
  });

  it('renders the NULL_DATE_PLACEHOLDER for undefined', () => {
    expect(formatDateMedium(undefined)).toBe(NULL_DATE_PLACEHOLDER);
  });

  it('renders the NULL_DATE_PLACEHOLDER for the empty string', () => {
    expect(formatDateMedium('')).toBe(NULL_DATE_PLACEHOLDER);
  });

  it('renders the NULL_DATE_PLACEHOLDER for an unparseable date string', () => {
    expect(formatDateMedium('not-a-real-date')).toBe(NULL_DATE_PLACEHOLDER);
  });

  it('does not return a literal period', () => {
    // Regression: the old implementation returned "." which was visually
    // mistaken for stray punctuation in the customer portal data tables.
    expect(formatDateMedium(null)).not.toBe('.');
    expect(formatDateMedium(null)).not.toBe('');
  });

  it('formats a valid date in the medium en-US form', () => {
    // The exact rendering depends on the runtime ICU build. Assert the
    // shape (contains the 4-digit year) rather than a brittle equality.
    const out = formatDateMedium('2026-05-26T12:00:00Z');
    expect(out).toMatch(/2026/);
    expect(out).not.toBe(NULL_DATE_PLACEHOLDER);
  });
});

describe('formatDateShort null handling', () => {
  it('renders the NULL_DATE_PLACEHOLDER for null', () => {
    expect(formatDateShort(null)).toBe(NULL_DATE_PLACEHOLDER);
  });

  it('renders the NULL_DATE_PLACEHOLDER for an unparseable date string', () => {
    expect(formatDateShort('whatever')).toBe(NULL_DATE_PLACEHOLDER);
  });
});

// R-W10-AUDIT-01 smoke follow-up: detail pages used to render raw ISO strings
// (e.g. "2026-05-31T22:39:28.58+00:00") for actual event timestamps.
// formatDateTimeMedium converts to a readable local date+time.
describe('formatDateTimeMedium', () => {
  it('renders the NULL_DATE_PLACEHOLDER for null / undefined / empty', () => {
    expect(formatDateTimeMedium(null)).toBe(NULL_DATE_PLACEHOLDER);
    expect(formatDateTimeMedium(undefined)).toBe(NULL_DATE_PLACEHOLDER);
    expect(formatDateTimeMedium('')).toBe(NULL_DATE_PLACEHOLDER);
  });

  it('renders the NULL_DATE_PLACEHOLDER for an unparseable date string', () => {
    expect(formatDateTimeMedium('2026-05-31T99:99')).toBe(NULL_DATE_PLACEHOLDER);
  });

  it('does not leak the raw ISO string', () => {
    const iso = '2026-05-31T22:39:28.58+00:00';
    const out = formatDateTimeMedium(iso);
    expect(out).not.toBe(iso);
    expect(out).not.toMatch(/T\d{2}:\d{2}/);
    expect(out).not.toMatch(/\+00:00/);
  });

  it('includes the year and a time component for a valid timestamp', () => {
    // ICU build governs exact output, so assert shape: year present plus an
    // AM/PM marker from the en-US numeric hour.
    const out = formatDateTimeMedium('2026-05-31T22:39:28Z');
    expect(out).toMatch(/2026/);
    expect(out).toMatch(/\b(AM|PM)\b/);
  });
});
