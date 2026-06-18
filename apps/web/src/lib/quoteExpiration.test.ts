import { describe, it, expect } from 'vitest';

import {
  resolveDefaultExpiration,
  addExpiration,
  presetIdForDuration,
  durationForPresetId,
  EXPIRATION_PRESETS,
} from './quoteExpiration';

const row = (value: unknown) => ({
  group_key: 'quotes',
  setting_key: 'default_expiration',
  value,
});

describe('resolveDefaultExpiration', () => {
  it('returns a valid day duration', () => {
    expect(resolveDefaultExpiration([row({ unit: 'day', amount: 30 })])).toEqual({
      unit: 'day',
      amount: 30,
    });
  });

  it('returns a valid month duration', () => {
    expect(resolveDefaultExpiration([row({ unit: 'month', amount: 6 })])).toEqual({
      unit: 'month',
      amount: 6,
    });
  });

  it('returns null while loading (undefined)', () => {
    expect(resolveDefaultExpiration(undefined)).toBeNull();
  });

  it('returns null when the row is absent', () => {
    expect(
      resolveDefaultExpiration([
        { group_key: 'general', setting_key: 'other', value: { unit: 'day', amount: 5 } },
      ]),
    ).toBeNull();
  });

  it('returns null on malformed values', () => {
    const bad: unknown[] = [
      { unit: 'week', amount: 2 }, // bad unit
      { unit: 'day', amount: 0 }, // not positive
      { unit: 'day', amount: -5 }, // negative
      { unit: 'day', amount: 1.5 }, // not integer
      { unit: 'day' }, // missing amount
      { amount: 5 }, // missing unit
      'day', // not an object
      null,
    ];
    for (const value of bad) {
      expect(resolveDefaultExpiration([row(value)])).toBeNull();
    }
  });
});

describe('addExpiration', () => {
  it('adds days (TZ-safe local date)', () => {
    expect(addExpiration('2026-06-18', { unit: 'day', amount: 30 })).toBe('2026-07-18');
  });

  it('adds months by calendar math', () => {
    expect(addExpiration('2026-06-15', { unit: 'month', amount: 6 })).toBe('2026-12-15');
  });

  it('adds a year', () => {
    expect(addExpiration('2026-06-15', { unit: 'year', amount: 1 })).toBe('2027-06-15');
  });

  it('rolls over an end-of-month overflow (Jan 31 + 1 month)', () => {
    // JS Date rolls Feb 31 into early March; documented behavior, acceptable
    // for a quote expiration default.
    expect(addExpiration('2026-01-31', { unit: 'month', amount: 1 })).toBe('2026-03-03');
  });

  it('returns null on an unparseable date', () => {
    expect(addExpiration('not-a-date', { unit: 'month', amount: 6 })).toBeNull();
  });
});

describe('preset id mapping', () => {
  it('maps null to "none" and back', () => {
    expect(presetIdForDuration(null)).toBe('none');
    expect(durationForPresetId('none', 30)).toBeNull();
  });

  it('round-trips every preset', () => {
    for (const p of EXPIRATION_PRESETS) {
      expect(presetIdForDuration(p.duration)).toBe(p.id);
      expect(durationForPresetId(p.id, 30)).toEqual(p.duration);
    }
  });

  it('treats a non-preset day count as custom', () => {
    expect(presetIdForDuration({ unit: 'day', amount: 45 })).toBe('custom');
    expect(durationForPresetId('custom', 45)).toEqual({ unit: 'day', amount: 45 });
  });

  it('clamps a bad custom day count to at least 1', () => {
    expect(durationForPresetId('custom', 0)).toEqual({ unit: 'day', amount: 1 });
    expect(durationForPresetId('custom', -3)).toEqual({ unit: 'day', amount: 1 });
  });
});
