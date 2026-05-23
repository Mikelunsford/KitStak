// F-Wave9-AUDIT-V3-WAVE-E-01 (item 5): regression suite for the
// stock-movement quantity formatter. Pure function, no React, no
// network.

import { describe, it, expect } from 'vitest';

import {
  formatStockMovementQty,
  signForMovementType,
} from './formatStockMovementQty';

describe('signForMovementType', () => {
  it('returns +1 for inbound flows', () => {
    expect(signForMovementType('receipt')).toBe(1);
    expect(signForMovementType('production_produced')).toBe(1);
    expect(signForMovementType('transfer_in')).toBe(1);
  });

  it('returns -1 for outbound flows', () => {
    expect(signForMovementType('shipment')).toBe(-1);
    expect(signForMovementType('production_consumed')).toBe(-1);
    expect(signForMovementType('transfer_out')).toBe(-1);
  });

  it('returns 0 for adjustments (sign is already stored)', () => {
    expect(signForMovementType('adjustment')).toBe(0);
  });
});

describe('formatStockMovementQty', () => {
  it('prefixes + on a receipt', () => {
    expect(
      formatStockMovementQty({ movement_type: 'receipt', quantity: '50' }),
    ).toBe('+50');
  });

  it('prefixes - on a shipment', () => {
    expect(
      formatStockMovementQty({ movement_type: 'shipment', quantity: '50' }),
    ).toBe('-50');
  });

  it('prefixes + on production_produced', () => {
    expect(
      formatStockMovementQty({
        movement_type: 'production_produced',
        quantity: '12.5',
      }),
    ).toBe('+12.5');
  });

  it('prefixes - on production_consumed', () => {
    expect(
      formatStockMovementQty({
        movement_type: 'production_consumed',
        quantity: '12.5',
      }),
    ).toBe('-12.5');
  });

  it('prefixes + on transfer_in and - on transfer_out', () => {
    expect(
      formatStockMovementQty({ movement_type: 'transfer_in', quantity: '7' }),
    ).toBe('+7');
    expect(
      formatStockMovementQty({ movement_type: 'transfer_out', quantity: '7' }),
    ).toBe('-7');
  });

  it('passes adjustment through unchanged (negative stays negative)', () => {
    expect(
      formatStockMovementQty({ movement_type: 'adjustment', quantity: '-3' }),
    ).toBe('-3');
    expect(
      formatStockMovementQty({ movement_type: 'adjustment', quantity: '3' }),
    ).toBe('3');
  });

  it('never produces a double-negative when storage holds a negative value', () => {
    // Defensive: triggers may store outbound flows as positive magnitudes,
    // but if a future migration ever stores a signed value we should not
    // emit "--50". The helper strips a leading minus before prefixing.
    expect(
      formatStockMovementQty({ movement_type: 'shipment', quantity: '-50' }),
    ).toBe('-50');
  });

  it('handles a numeric quantity (not just string)', () => {
    expect(
      formatStockMovementQty({
        movement_type: 'receipt',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        quantity: 50 as any,
      }),
    ).toBe('+50');
  });
});
