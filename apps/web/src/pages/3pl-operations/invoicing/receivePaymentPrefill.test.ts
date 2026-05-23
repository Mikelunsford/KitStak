// F-Wave9-AUDIT-V3-WAVE-F-01: unit tests for the Receive Payment
// modal's pure prefill + post-body helpers.

import { describe, it, expect } from 'vitest';

import {
  buildReceivePaymentDefaults,
  buildReceivePaymentPostBodies,
} from './receivePaymentPrefill';

const REF_NOW = new Date(2026, 4, 23, 12, 0, 0); // local 2026-05-23

describe('buildReceivePaymentDefaults', () => {
  it('prefills amount from a positive integer balance', () => {
    const out = buildReceivePaymentDefaults(12_345, REF_NOW);
    expect(out.amountCents).toBe(12_345);
    expect(out.receivedAt).toBe('2026-05-23');
  });

  it('prefills amount from a numeric-string balance', () => {
    const out = buildReceivePaymentDefaults('5000', REF_NOW);
    expect(out.amountCents).toBe(5000);
  });

  it('returns null amount when the balance is zero', () => {
    const out = buildReceivePaymentDefaults(0, REF_NOW);
    expect(out.amountCents).toBeNull();
  });

  it('returns null amount when the balance is negative', () => {
    const out = buildReceivePaymentDefaults(-100, REF_NOW);
    expect(out.amountCents).toBeNull();
  });

  it('returns null amount when the balance is null / undefined', () => {
    expect(buildReceivePaymentDefaults(null, REF_NOW).amountCents).toBeNull();
    expect(
      buildReceivePaymentDefaults(undefined, REF_NOW).amountCents,
    ).toBeNull();
  });

  it('returns null amount for an unparseable balance', () => {
    const out = buildReceivePaymentDefaults('not-a-number', REF_NOW);
    expect(out.amountCents).toBeNull();
  });

  it('uses the supplied `now` arg for receivedAt', () => {
    const out = buildReceivePaymentDefaults(100, new Date(2027, 0, 1));
    expect(out.receivedAt).toBe('2027-01-01');
  });
});

describe('buildReceivePaymentPostBodies', () => {
  const ctx = {
    invoiceId: 'inv-1',
    customerId: 'cust-1',
    currencyCode: 'USD',
  };

  it('builds the payment + allocation bodies with amount stringified', () => {
    const out = buildReceivePaymentPostBodies(
      {
        amountCents: 12_345,
        receivedAt: '2026-05-23',
        paymentMethod: 'wire',
        referenceNumber: 'wire-7',
      },
      ctx,
    );
    expect(out.payment).toEqual({
      amount_cents: '12345',
      currency_code: 'USD',
      customer_id: 'cust-1',
      payment_method: 'wire',
      reference_number: 'wire-7',
      received_at: '2026-05-23',
    });
    expect(out.allocation).toEqual({
      allocations: [{ invoice_id: 'inv-1', amount_cents: '12345' }],
    });
  });

  it('omits optional fields when empty', () => {
    const out = buildReceivePaymentPostBodies(
      {
        amountCents: 500,
        receivedAt: '2026-05-23',
        paymentMethod: '',
        referenceNumber: '',
      },
      { ...ctx, customerId: null },
    );
    expect(out.payment.customer_id).toBeUndefined();
    expect(out.payment.payment_method).toBeUndefined();
    expect(out.payment.reference_number).toBeUndefined();
    expect(out.payment.amount_cents).toBe('500');
    expect(out.allocation.allocations[0]?.amount_cents).toBe('500');
  });

  it('falls back to USD when currencyCode is empty', () => {
    const out = buildReceivePaymentPostBodies(
      {
        amountCents: 100,
        receivedAt: '2026-05-23',
        paymentMethod: '',
        referenceNumber: '',
      },
      { ...ctx, currencyCode: '' },
    );
    expect(out.payment.currency_code).toBe('USD');
  });

  it('serialises a null amount as "0"', () => {
    const out = buildReceivePaymentPostBodies(
      {
        amountCents: null,
        receivedAt: '',
        paymentMethod: '',
        referenceNumber: '',
      },
      { ...ctx, customerId: null },
    );
    expect(out.payment.amount_cents).toBe('0');
    expect(out.allocation.allocations[0]?.amount_cents).toBe('0');
  });
});
