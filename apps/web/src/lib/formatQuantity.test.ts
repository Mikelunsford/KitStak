// P1-5 unit tests for formatQuantity: trims trailing-zero noise so quote lines
// (thousandths) and project lines (2 decimals) render consistently.

import { describe, it, expect } from 'vitest';

import { formatQuantity } from './formatQuantity';

describe('formatQuantity', () => {
  it('renders whole numbers with no decimals', () => {
    expect(formatQuantity(25)).toBe('25');
    expect(formatQuantity(25.0)).toBe('25');
    expect(formatQuantity(1000)).toBe('1000');
    expect(formatQuantity(0)).toBe('0');
  });

  it('keeps meaningful decimals, trimming trailing zeros', () => {
    expect(formatQuantity(25.5)).toBe('25.5');
    expect(formatQuantity(25.125)).toBe('25.125');
    expect(formatQuantity(25.1)).toBe('25.1');
    expect(formatQuantity(25.12)).toBe('25.12');
    expect(formatQuantity(25.5)).toBe('25.5');
  });

  it('matches the old quote (3dp) and project (2dp) outputs once trimmed', () => {
    // quantity_e3 25000 -> 25.000 -> 25; 25500 -> 25.5; 25125 -> 25.125
    expect(formatQuantity(25000 / 1000)).toBe('25');
    expect(formatQuantity(25500 / 1000)).toBe('25.5');
    expect(formatQuantity(25125 / 1000)).toBe('25.125');
  });

  it('caps precision at maxDecimals (default 3) and rounds', () => {
    expect(formatQuantity(25.1259)).toBe('25.126');
  });

  it('falls back to 0 on a non-finite value', () => {
    expect(formatQuantity(Number.NaN)).toBe('0');
    expect(formatQuantity(Number.POSITIVE_INFINITY)).toBe('0');
  });
});
