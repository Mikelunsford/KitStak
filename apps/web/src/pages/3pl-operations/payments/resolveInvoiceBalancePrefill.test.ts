// PR A3: PaymentCreatePage amount-from-balance pre-fill — pure helper
// contract. The page wraps this in a useEffect with a per-invoice-id
// "applied" ref so an operator's manual edit is never clobbered; this
// test pins the underlying decision so the page logic stays a thin
// dispatcher.

import { describe, it, expect } from 'vitest';

import { resolveInvoiceBalancePrefill } from './resolveInvoiceBalancePrefill';

describe('resolveInvoiceBalancePrefill', () => {
  it('returns the integer when balance arrives as a positive integer', () => {
    expect(resolveInvoiceBalancePrefill(15000)).toBe(15000);
    expect(resolveInvoiceBalancePrefill(1)).toBe(1);
  });

  it('coerces a numeric-string balance to integer cents', () => {
    expect(resolveInvoiceBalancePrefill('15000')).toBe(15000);
    expect(resolveInvoiceBalancePrefill('1')).toBe(1);
  });

  it('returns null for null / undefined balance', () => {
    expect(resolveInvoiceBalancePrefill(null)).toBeNull();
    expect(resolveInvoiceBalancePrefill(undefined)).toBeNull();
  });

  it('returns null when the balance is zero (nothing left to collect)', () => {
    expect(resolveInvoiceBalancePrefill(0)).toBeNull();
    expect(resolveInvoiceBalancePrefill('0')).toBeNull();
  });

  it('returns null when the balance is negative (defensive)', () => {
    expect(resolveInvoiceBalancePrefill(-1)).toBeNull();
    expect(resolveInvoiceBalancePrefill('-5000')).toBeNull();
  });

  it('returns null when the balance string is unparseable', () => {
    expect(resolveInvoiceBalancePrefill('not-a-number')).toBeNull();
    expect(resolveInvoiceBalancePrefill('')).toBeNull();
  });
});
