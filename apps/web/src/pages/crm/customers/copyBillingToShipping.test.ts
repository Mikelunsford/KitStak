// F-Wave9-AUDIT-V3-WAVE-E-01 (item 3): regression suite for the
// "Same as billing" helper. Pure functions, no React, runs in vitest
// node environment.

import { describe, it, expect } from 'vitest';

import {
  copyBillingToShipping,
  addressesEqual,
  type AddressFields,
} from './copyBillingToShipping';

const blank: AddressFields = {
  line1: '',
  line2: '',
  city: '',
  region: '',
  postal: '',
  country: '',
};

const billing: AddressFields = {
  line1: '123 Pier Ave',
  line2: 'Suite 4',
  city: 'Long Beach',
  region: 'CA',
  postal: '90802',
  country: 'US',
};

describe('copyBillingToShipping', () => {
  it('returns the billing fields verbatim', () => {
    expect(copyBillingToShipping(billing)).toEqual(billing);
  });

  it('returns a new object (no shared reference)', () => {
    const copy = copyBillingToShipping(billing);
    expect(copy).not.toBe(billing);
  });

  it('copies blank fields without coercing to undefined', () => {
    expect(copyBillingToShipping(blank)).toEqual(blank);
  });
});

describe('addressesEqual', () => {
  it('returns true for byte-equal field bundles', () => {
    expect(addressesEqual(billing, copyBillingToShipping(billing))).toBe(true);
  });

  it('returns false when any single field drifts', () => {
    const drifted: AddressFields = { ...billing, line2: 'Suite 5' };
    expect(addressesEqual(billing, drifted)).toBe(false);
  });

  it('returns false when an empty field is filled on one side', () => {
    const filled: AddressFields = { ...blank, country: 'US' };
    expect(addressesEqual(blank, filled)).toBe(false);
  });

  it('returns true when both sides are blank', () => {
    expect(addressesEqual(blank, blank)).toBe(true);
  });
});
