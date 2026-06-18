import { describe, it, expect } from 'vitest';

import {
  SUPPLY_SOURCE_LABEL,
  SUPPLY_SOURCE_OPTIONS,
  isZeroCostSupplySource,
} from './supplySource';

describe('SUPPLY_SOURCE_OPTIONS', () => {
  it('lists all four sources in display order', () => {
    expect(SUPPLY_SOURCE_OPTIONS.map((o) => o.value)).toEqual([
      'in_house',
      'customer_supplied',
      'vendor_consigned',
      'third_party_consigned',
    ]);
  });

  it('labels every option from the shared label map', () => {
    for (const opt of SUPPLY_SOURCE_OPTIONS) {
      expect(opt.label).toBe(SUPPLY_SOURCE_LABEL[opt.value]);
    }
  });
});

describe('isZeroCostSupplySource', () => {
  it('treats customer_supplied and third_party_consigned as zero org cost', () => {
    expect(isZeroCostSupplySource('customer_supplied')).toBe(true);
    expect(isZeroCostSupplySource('third_party_consigned')).toBe(true);
  });

  it('treats in_house and vendor_consigned as normal cost', () => {
    expect(isZeroCostSupplySource('in_house')).toBe(false);
    expect(isZeroCostSupplySource('vendor_consigned')).toBe(false);
  });
});
