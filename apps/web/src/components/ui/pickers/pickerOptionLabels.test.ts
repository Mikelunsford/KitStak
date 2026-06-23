// P1-2 unit tests for the reference-picker option-label formatters. Locks the
// rate/discount formatting and the org-default marker so the tax / payment /
// pricing dropdowns read clearly instead of exposing raw UUIDs.

import { describe, it, expect } from 'vitest';

import {
  paymentMethodOptionLabel,
  pricingTierOptionLabel,
  taxOptionLabel,
} from './pickerOptionLabels';
import type { PaymentMethod, PricingTier, Tax } from '@/lib/types/sales';

// Minimal fixtures: the formatters read only a few fields, so a narrowed cast
// is enough to assert the label contract.
function tax(partial: Partial<Tax>): Tax {
  return {
    name: 'Standard',
    rate_bps: 825,
    default_for_org: false,
    ...partial,
  } as unknown as Tax;
}
function method(partial: Partial<PaymentMethod>): PaymentMethod {
  return { label: 'Card', default_for_org: false, ...partial } as unknown as PaymentMethod;
}
function tier(partial: Partial<PricingTier>): PricingTier {
  return { name: 'Wholesale', discount_bps: 1000, ...partial } as unknown as PricingTier;
}

describe('taxOptionLabel', () => {
  it('formats name and rate as a percentage', () => {
    expect(taxOptionLabel(tax({}))).toBe('Standard (8.25%)');
  });

  it('marks the org default with a middle dot (no em dash)', () => {
    const label = taxOptionLabel(tax({ default_for_org: true }));
    expect(label).toBe('Standard (8.25%) · default');
    expect(label).not.toContain('—');
  });
});

describe('paymentMethodOptionLabel', () => {
  it('uses the payment method label', () => {
    expect(paymentMethodOptionLabel(method({}))).toBe('Card');
  });

  it('marks the org default', () => {
    expect(paymentMethodOptionLabel(method({ default_for_org: true }))).toBe(
      'Card · default',
    );
  });
});

describe('pricingTierOptionLabel', () => {
  it('formats name and discount (tiers have no org default)', () => {
    expect(pricingTierOptionLabel(tier({}))).toBe('Wholesale (10.00% off)');
  });
});
