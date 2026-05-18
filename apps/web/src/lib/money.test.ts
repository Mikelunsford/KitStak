import { describe, it, expect } from 'vitest';
import { roundHalfEven, formatCents } from './money';

describe('roundHalfEven', () => {
  it('rounds 0.5 to nearest even', () => {
    expect(roundHalfEven(0.5)).toBe(0);
    expect(roundHalfEven(1.5)).toBe(2);
    expect(roundHalfEven(2.5)).toBe(2);
    expect(roundHalfEven(3.5)).toBe(4);
  });

  it('rounds normally below and above 0.5', () => {
    expect(roundHalfEven(1.4)).toBe(1);
    expect(roundHalfEven(1.6)).toBe(2);
  });
});

describe('formatCents', () => {
  it('formats USD with two decimals', () => {
    expect(formatCents(12345)).toBe('$123.45');
  });

  it('handles zero-decimal currencies', () => {
    expect(formatCents(12345, 'JPY')).toBe('¥12,345');
  });

  it('accepts string cents', () => {
    expect(formatCents('1000')).toBe('$10.00');
  });
});
