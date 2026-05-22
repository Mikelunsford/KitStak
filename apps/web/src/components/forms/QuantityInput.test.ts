// PR A1: QuantityInput primitive — closes the E3-trap audit item for SPA
// forms. Test target is the pure parse/format pair; the React component
// is a thin wrapper.
//
// Constitutional invariants under test:
//   - Round-trip qty_e3 -> display -> qty_e3 stays integer.
//   - Half-even rounding matches `@/lib/money#roundHalfEven` (banker's).
//   - No "x1000" hint surfaces in the display string.
//   - Negative input rejected (no operator workflow asks for it).

import { describe, it, expect } from 'vitest';

import {
  parseQuantityToE3,
  formatE3ForDisplay,
} from './QuantityInput';

describe('QuantityInput / parseQuantityToE3', () => {
  it('parses a whole quantity into qty_e3', () => {
    expect(parseQuantityToE3('100')).toBe(100000);
    expect(parseQuantityToE3('1')).toBe(1000);
    expect(parseQuantityToE3('0')).toBe(0);
  });

  it('parses fractional quantities', () => {
    expect(parseQuantityToE3('100.5')).toBe(100500);
    expect(parseQuantityToE3('1.25')).toBe(1250);
    expect(parseQuantityToE3('0.001')).toBe(1);
  });

  it('returns null for an empty string', () => {
    expect(parseQuantityToE3('')).toBeNull();
    expect(parseQuantityToE3('   ')).toBeNull();
  });

  it('returns NaN for unparseable input', () => {
    expect(Number.isNaN(parseQuantityToE3('abc') as number)).toBe(true);
    expect(Number.isNaN(parseQuantityToE3('1.2.3') as number)).toBe(true);
    expect(Number.isNaN(parseQuantityToE3('.') as number)).toBe(true);
  });

  it('strips comma separators and whitespace', () => {
    expect(parseQuantityToE3('1,000')).toBe(1000000);
    expect(parseQuantityToE3('  100.5  ')).toBe(100500);
    expect(parseQuantityToE3('1, 0 0 0')).toBe(1000000);
  });

  it('rejects negative input', () => {
    expect(Number.isNaN(parseQuantityToE3('-1') as number)).toBe(true);
    expect(Number.isNaN(parseQuantityToE3('-100.5') as number)).toBe(true);
  });

  it('applies banker (half-even) rounding on the fourth fractional digit', () => {
    // 100.0005 units = 100000.5 qty_e3 -> 100000 (even)
    expect(parseQuantityToE3('100.0005')).toBe(100000);
    // 100.0015 units = 100001.5 qty_e3 -> 100002 (even)
    expect(parseQuantityToE3('100.0015')).toBe(100002);
    // 100.0025 units = 100002.5 qty_e3 -> 100002 (even)
    expect(parseQuantityToE3('100.0025')).toBe(100002);
  });

  it('truncates digits beyond the fourth fractional digit', () => {
    // 100.00059 -> takes first 4 frac digits ("0005") -> 100000 (half-even)
    expect(parseQuantityToE3('100.00059')).toBe(100000);
  });
});

describe('QuantityInput / formatE3ForDisplay', () => {
  it('returns empty string for null', () => {
    expect(formatE3ForDisplay(null)).toBe('');
  });

  it('formats integer qty_e3 without trailing zeros', () => {
    expect(formatE3ForDisplay(0)).toBe('0');
    expect(formatE3ForDisplay(1000)).toBe('1');
    expect(formatE3ForDisplay(100000)).toBe('100');
    expect(formatE3ForDisplay(100500)).toBe('100.5');
    expect(formatE3ForDisplay(1)).toBe('0.001');
  });

  it('does not render an "x1000" or "(e3)" hint', () => {
    expect(formatE3ForDisplay(100000)).not.toContain('x');
    expect(formatE3ForDisplay(100000)).not.toContain('e3');
    expect(formatE3ForDisplay(100000)).not.toContain('E3');
  });
});

describe('QuantityInput / round-trip', () => {
  it('qty_e3 -> display -> qty_e3 preserves integer value', () => {
    const cases: number[] = [0, 1, 999, 1000, 100000, 100500, 1234567];
    for (const e3 of cases) {
      const display = formatE3ForDisplay(e3);
      const roundTripped = parseQuantityToE3(display);
      expect(roundTripped).toBe(e3);
    }
  });
});
