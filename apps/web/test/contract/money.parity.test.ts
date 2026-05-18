import { describe, expect, it } from 'vitest';
import * as spa from '@/lib/money';
import * as shared from '../../../../supabase/functions/_shared/money';

// Behavior parity beyond byte-identity. If the two copies ever diverge in a
// way the byte check misses (e.g. environment-specific branch), this catches it.

const ROUNDING_INPUTS = [
  -3.5, -2.5, -1.5, -0.5, 0, 0.5, 1.4, 1.5, 1.6, 2.5, 3.5, 4.5,
];

const FORMAT_INPUTS: ReadonlyArray<[number, string]> = [
  [0, 'USD'],
  [1, 'USD'],
  [12345, 'USD'],
  [-12345, 'USD'],
  [99, 'USD'],
  [100, 'USD'],
  [12345, 'JPY'],
  [12345, 'KRW'],
];

describe('money helpers behaviour parity', () => {
  it('roundHalfEven matches across SPA and _shared for the canonical inputs', () => {
    for (const n of ROUNDING_INPUTS) {
      expect(spa.roundHalfEven(n)).toBe(shared.roundHalfEven(n));
    }
  });

  it('formatCents matches across SPA and _shared for the canonical inputs', () => {
    for (const [cents, currency] of FORMAT_INPUTS) {
      expect(spa.formatCents(cents, currency)).toBe(
        shared.formatCents(cents, currency),
      );
    }
  });

  it('ZERO_DECIMAL_CURRENCIES set matches', () => {
    expect([...spa.ZERO_DECIMAL_CURRENCIES].sort()).toEqual(
      [...shared.ZERO_DECIMAL_CURRENCIES].sort(),
    );
  });
});
