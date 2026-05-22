// PR A1: PercentInput primitive — closes the BPS-trap audit item for SPA
// forms. Test target is the pure parse/format pair; the React component is
// a thin wrapper.
//
// Constitutional invariants under test:
//   - Round-trip bps -> display -> bps stays integer.
//   - Half-even rounding matches `@/lib/money#roundHalfEven` (banker's).
//   - Whitespace, "%", and comma separators are accepted at input.
//   - Negative input is rejected.

import { describe, it, expect } from 'vitest';

import {
  parsePercentToBps,
  formatBpsForDisplay,
} from './PercentInput';

describe('PercentInput / parsePercentToBps', () => {
  it('parses a whole percent string into bps', () => {
    expect(parsePercentToBps('10')).toBe(1000);
    expect(parsePercentToBps('0')).toBe(0);
    expect(parsePercentToBps('100')).toBe(10000);
  });

  it('parses fractional percents', () => {
    expect(parsePercentToBps('10.5')).toBe(1050);
    expect(parsePercentToBps('0.25')).toBe(25);
    expect(parsePercentToBps('1.75')).toBe(175);
  });

  it('returns null for an empty string', () => {
    expect(parsePercentToBps('')).toBeNull();
    expect(parsePercentToBps('   ')).toBeNull();
  });

  it('returns NaN for unparseable input', () => {
    expect(Number.isNaN(parsePercentToBps('abc') as number)).toBe(true);
    expect(Number.isNaN(parsePercentToBps('1.2.3') as number)).toBe(true);
    expect(Number.isNaN(parsePercentToBps('.') as number)).toBe(true);
  });

  it('strips the "%" suffix', () => {
    expect(parsePercentToBps('10%')).toBe(1000);
    expect(parsePercentToBps('10 %')).toBe(1000);
  });

  it('strips comma separators and whitespace', () => {
    expect(parsePercentToBps('1,000')).toBe(100000);
    expect(parsePercentToBps('  10.5  ')).toBe(1050);
  });

  it('rejects negative input', () => {
    expect(Number.isNaN(parsePercentToBps('-5') as number)).toBe(true);
    expect(Number.isNaN(parsePercentToBps('-') as number)).toBe(true);
  });

  it('applies banker (half-even) rounding to fractional bps', () => {
    // 10.005% = 1000.5 bps -> 1000 (even)
    expect(parsePercentToBps('10.005')).toBe(1000);
    // 10.015% = 1001.5 bps -> 1002 (even)
    expect(parsePercentToBps('10.015')).toBe(1002);
    // 10.025% = 1002.5 bps -> 1002 (even)
    expect(parsePercentToBps('10.025')).toBe(1002);
  });
});

describe('PercentInput / formatBpsForDisplay', () => {
  it('returns empty string for null', () => {
    expect(formatBpsForDisplay(null)).toBe('');
  });

  it('formats integer bps without trailing zeros', () => {
    expect(formatBpsForDisplay(0)).toBe('0');
    expect(formatBpsForDisplay(1000)).toBe('10');
    expect(formatBpsForDisplay(1050)).toBe('10.5');
    expect(formatBpsForDisplay(1075)).toBe('10.75');
    expect(formatBpsForDisplay(25)).toBe('0.25');
  });
});

describe('PercentInput / round-trip', () => {
  it('bps -> display -> bps preserves integer value', () => {
    const cases: number[] = [0, 1, 25, 100, 1000, 1050, 1075, 10000];
    for (const bps of cases) {
      const display = formatBpsForDisplay(bps);
      const roundTripped = parsePercentToBps(display);
      expect(roundTripped).toBe(bps);
    }
  });
});
