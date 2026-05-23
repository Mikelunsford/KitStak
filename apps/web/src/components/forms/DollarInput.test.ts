// PR A1: DollarInput primitive — closes the cents-trap audit item for SPA
// forms. Test target is the pure parse/format pair; the React component is
// a thin wrapper around them (the repo has no jsdom or testing-library
// dependency — see featureFlagResolver.test.ts and LineItemsEditor.test.ts
// for the same pattern).
//
// Constitutional invariants under test:
//   - Round-trip cents -> display -> cents stays integer.
//   - Half-even rounding matches `@/lib/money#roundHalfEven` (banker's).
//   - Whitespace, "$", and comma separators are accepted at input.
//   - Negative input rejected unless `allowNegative` is true.

import { describe, it, expect } from 'vitest';

import {
  parseDollarsToCents,
  formatCentsForDisplay,
} from './DollarInput';

describe('DollarInput / parseDollarsToCents', () => {
  it('parses a plain dollar string into integer cents', () => {
    expect(parseDollarsToCents('5')).toBe(500);
    expect(parseDollarsToCents('5.00')).toBe(500);
    expect(parseDollarsToCents('5.25')).toBe(525);
  });

  it('returns null for an empty string', () => {
    expect(parseDollarsToCents('')).toBeNull();
    expect(parseDollarsToCents('   ')).toBeNull();
  });

  it('returns NaN for unparseable input', () => {
    expect(Number.isNaN(parseDollarsToCents('abc') as number)).toBe(true);
    expect(Number.isNaN(parseDollarsToCents('5.2.3') as number)).toBe(true);
    expect(Number.isNaN(parseDollarsToCents('.') as number)).toBe(true);
    expect(Number.isNaN(parseDollarsToCents('-') as number)).toBe(true);
  });

  it('strips the "$" prefix', () => {
    expect(parseDollarsToCents('$5.00')).toBe(500);
    expect(parseDollarsToCents('$ 5.00')).toBe(500);
  });

  it('strips comma separators', () => {
    expect(parseDollarsToCents('1,234.56')).toBe(123456);
    expect(parseDollarsToCents('$1,234.56')).toBe(123456);
  });

  it('strips whitespace inside the value', () => {
    expect(parseDollarsToCents('  5.00  ')).toBe(500);
    expect(parseDollarsToCents('5 . 00')).toBe(500);
  });

  it('rejects negative input by default', () => {
    expect(Number.isNaN(parseDollarsToCents('-5.00') as number)).toBe(true);
  });

  it('accepts negative input when allowNegative is true', () => {
    expect(parseDollarsToCents('-5.00', { allowNegative: true })).toBe(-500);
    expect(parseDollarsToCents('-$5.00', { allowNegative: true })).toBe(-500);
  });

  it('applies banker (half-even) rounding to fractional cents', () => {
    // 0.5 cents -> rounds to even
    // 5.005 dollars = 500.5 cents -> 500 (even)
    expect(parseDollarsToCents('5.005')).toBe(500);
    // 5.015 dollars = 501.5 cents -> 502 (even)
    expect(parseDollarsToCents('5.015')).toBe(502);
    // 5.025 dollars = 502.5 cents -> 502 (even)
    expect(parseDollarsToCents('5.025')).toBe(502);
    // 5.035 dollars = 503.5 cents -> 504 (even)
    expect(parseDollarsToCents('5.035')).toBe(504);
  });

  it('rounds normal mid-bucket fractional dollars up', () => {
    expect(parseDollarsToCents('5.006')).toBe(501);
    expect(parseDollarsToCents('5.004')).toBe(500);
  });
});

describe('DollarInput / formatCentsForDisplay', () => {
  it('returns empty string for null', () => {
    expect(formatCentsForDisplay(null)).toBe('');
  });

  it('formats integer cents with two decimals', () => {
    expect(formatCentsForDisplay(0)).toBe('0.00');
    expect(formatCentsForDisplay(500)).toBe('5.00');
    expect(formatCentsForDisplay(525)).toBe('5.25');
    expect(formatCentsForDisplay(123456)).toBe('1234.56');
  });

  it('renders negative cents with leading minus', () => {
    expect(formatCentsForDisplay(-500)).toBe('-5.00');
    expect(formatCentsForDisplay(-1)).toBe('-0.01');
  });
});

describe('DollarInput / round-trip', () => {
  it('cents -> display -> cents preserves integer value', () => {
    const cases: number[] = [0, 1, 99, 100, 500, 12345, 999999, -500];
    for (const cents of cases) {
      const display = formatCentsForDisplay(cents);
      const roundTripped = parseDollarsToCents(display, { allowNegative: cents < 0 });
      expect(roundTripped).toBe(cents);
    }
  });
});
