// F-UIUX-CREDIT-NOTE-APPLY-CTA-01: pin the Apply-CTA gate. Pure-TS suite, no
// React renderer (mirrors resolveInvoiceBalancePrefill.test.ts).

import { describe, it, expect } from 'vitest';

import {
  creditNoteRemainingCents,
  canApplyCreditNote,
} from './creditNoteApplyGate';

describe('creditNoteRemainingCents', () => {
  it('subtracts applied from amount (number inputs)', () => {
    expect(creditNoteRemainingCents(10_000, 3_000)).toBe(7_000);
  });

  it('coerces numeric-string cents (FinanceCentsSchema string form)', () => {
    expect(creditNoteRemainingCents('10000', '2500')).toBe(7_500);
  });

  it('treats null / undefined / unparseable as zero', () => {
    expect(creditNoteRemainingCents(5_000, null)).toBe(5_000);
    expect(creditNoteRemainingCents(undefined, 1_000)).toBe(-1_000);
    expect(creditNoteRemainingCents('abc', 0)).toBe(0);
  });

  it('returns zero when fully applied', () => {
    expect(creditNoteRemainingCents(4_200, 4_200)).toBe(0);
  });
});

describe('canApplyCreditNote', () => {
  it('is true for an issued note with a positive remaining balance', () => {
    expect(canApplyCreditNote('issued', 10_000, 3_000)).toBe(true);
    expect(canApplyCreditNote('issued', '10000', '0')).toBe(true);
  });

  it('is false when the note is not issued', () => {
    expect(canApplyCreditNote('draft', 10_000, 0)).toBe(false);
    expect(canApplyCreditNote('voided', 10_000, 0)).toBe(false);
    expect(canApplyCreditNote('applied', 10_000, 0)).toBe(false);
  });

  it('is false when the note is fully applied (zero remaining)', () => {
    expect(canApplyCreditNote('issued', 4_200, 4_200)).toBe(false);
  });

  it('is false when applied exceeds amount (negative remaining)', () => {
    expect(canApplyCreditNote('issued', 1_000, 2_000)).toBe(false);
  });
});
