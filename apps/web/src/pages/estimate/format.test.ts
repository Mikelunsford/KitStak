import { describe, it, expect } from 'vitest';

import { centsWhole, centsExact, microsDisplay, addDays } from './format';

describe('estimate format helpers', () => {
  it('centsWhole renders whole-dollar, comma-grouped', () => {
    expect(centsWhole(0)).toBe('$0');
    expect(centsWhole(125_500)).toBe('$1,255');
    expect(centsWhole(50_000)).toBe('$500');
  });

  it('centsExact renders two-decimal USD', () => {
    expect(centsExact(0)).toBe('$0.00');
    expect(centsExact(1_806)).toBe('$18.06');
  });

  it('microsDisplay shows the sub-cent per-unit rate without trailing zeros', () => {
    expect(microsDisplay(250_000)).toBe('$0.25'); // $0.25/pc
    expect(microsDisplay(180_600)).toBe('$0.1806'); // sub-cent precision survives
    expect(microsDisplay(25_000_000)).toBe('$25.00');
  });

  it('addDays advances an ISO date', () => {
    expect(addDays('2026-06-29', 30)).toBe('2026-07-29');
  });
});
