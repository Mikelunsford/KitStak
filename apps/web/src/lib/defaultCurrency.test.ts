import { describe, it, expect } from 'vitest';

import { resolveDefaultCurrency, FALLBACK_CURRENCY } from './defaultCurrency';

describe('resolveDefaultCurrency', () => {
  it('returns the configured three-letter code', () => {
    expect(
      resolveDefaultCurrency([
        { group_key: 'general', setting_key: 'default_currency', value: { code: 'EUR' } },
      ]),
    ).toBe('EUR');
  });

  it('uppercases a lowercase code', () => {
    expect(
      resolveDefaultCurrency([
        { group_key: 'general', setting_key: 'default_currency', value: { code: 'gbp' } },
      ]),
    ).toBe('GBP');
  });

  it('falls back to USD while settings are loading (undefined)', () => {
    expect(resolveDefaultCurrency(undefined)).toBe(FALLBACK_CURRENCY);
  });

  it('falls back to USD when the setting row is absent', () => {
    expect(
      resolveDefaultCurrency([
        { group_key: 'sales', setting_key: 'something_else', value: { code: 'EUR' } },
      ]),
    ).toBe(FALLBACK_CURRENCY);
  });

  it('falls back to USD on a malformed value', () => {
    const malformed: unknown[] = [
      { code: 'EURO' }, // too long
      { code: 'E' }, // too short
      'EUR', // not an object
      null, // null
      { notCode: 'EUR' }, // missing code
    ];
    for (const value of malformed) {
      expect(
        resolveDefaultCurrency([
          { group_key: 'general', setting_key: 'default_currency', value },
        ]),
      ).toBe(FALLBACK_CURRENCY);
    }
  });
});
