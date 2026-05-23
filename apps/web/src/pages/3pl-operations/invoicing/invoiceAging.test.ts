// Unit tests for the F-Wave9-SMOKE-2026-05-23-02 humanized invoice aging
// helper. All cases pin "today" to a deterministic clock so the suite stays
// timezone-agnostic and does not drift over time.

import { describe, it, expect } from 'vitest';

import { formatInvoiceAging } from './invoiceAging';

// 2026-05-23 UTC midnight. The clock used by the SPA at follow-up landing.
const TODAY = new Date(Date.UTC(2026, 4, 23, 12, 0, 0));

describe('formatInvoiceAging', () => {
  it('returns "Paid" for paid invoices regardless of dates', () => {
    expect(
      formatInvoiceAging(
        { status: 'paid', issue_date: '2026-01-01', due_date: '2026-01-31' },
        TODAY,
      ),
    ).toBe('Paid');
  });

  it('returns "." for cancelled invoices', () => {
    expect(
      formatInvoiceAging(
        { status: 'cancelled', issue_date: '2026-01-01', due_date: '2026-01-31' },
        TODAY,
      ),
    ).toBe('.');
  });

  it('returns "." for draft invoices regardless of dates', () => {
    expect(
      formatInvoiceAging(
        { status: 'draft', issue_date: '2026-05-01', due_date: '2026-05-31' },
        TODAY,
      ),
    ).toBe('.');
    expect(
      formatInvoiceAging(
        { status: 'draft', issue_date: null, due_date: null },
        TODAY,
      ),
    ).toBe('.');
  });

  it('returns "N days late" when the invoice is past due (plural)', () => {
    // due 2026-05-11, today 2026-05-23 -> 12 days late.
    expect(
      formatInvoiceAging(
        { status: 'sent', issue_date: '2026-04-11', due_date: '2026-05-11' },
        TODAY,
      ),
    ).toBe('12 days late');
  });

  it('returns "1 day late" at the singular past-due boundary', () => {
    // due 2026-05-22, today 2026-05-23 -> 1 day late.
    expect(
      formatInvoiceAging(
        { status: 'sent', issue_date: null, due_date: '2026-05-22' },
        TODAY,
      ),
    ).toBe('1 day late');
  });

  it('returns "Due today" on the due date itself', () => {
    expect(
      formatInvoiceAging(
        { status: 'sent', issue_date: null, due_date: '2026-05-23' },
        TODAY,
      ),
    ).toBe('Due today');
  });

  it('returns "Due in N days" when the invoice is not yet due (plural)', () => {
    // due 2026-06-22, today 2026-05-23 -> due in 30 days.
    expect(
      formatInvoiceAging(
        { status: 'sent', issue_date: '2026-05-23', due_date: '2026-06-22' },
        TODAY,
      ),
    ).toBe('Due in 30 days');
  });

  it('returns "Due in 1 day" at the singular future boundary', () => {
    // due 2026-05-24, today 2026-05-23 -> due in 1 day.
    expect(
      formatInvoiceAging(
        { status: 'sent', issue_date: null, due_date: '2026-05-24' },
        TODAY,
      ),
    ).toBe('Due in 1 day');
  });

  it('returns "." when status is sent/unpaid but due_date is null', () => {
    expect(
      formatInvoiceAging(
        { status: 'sent', issue_date: '2026-05-22', due_date: null },
        TODAY,
      ),
    ).toBe('.');
    expect(
      formatInvoiceAging(
        { status: 'partially_paid', issue_date: '2026-05-22', due_date: null },
        TODAY,
      ),
    ).toBe('.');
    expect(
      formatInvoiceAging(
        { status: 'overdue', issue_date: null, due_date: null },
        TODAY,
      ),
    ).toBe('.');
  });

  it('returns "." for an unparseable due_date string', () => {
    expect(
      formatInvoiceAging(
        { status: 'sent', issue_date: null, due_date: '2026/05/22' },
        TODAY,
      ),
    ).toBe('.');
    expect(
      formatInvoiceAging(
        { status: 'sent', issue_date: null, due_date: 'not-a-date' },
        TODAY,
      ),
    ).toBe('.');
  });

  it('returns "." for null or undefined invoice input', () => {
    expect(formatInvoiceAging(null, TODAY)).toBe('.');
    expect(formatInvoiceAging(undefined, TODAY)).toBe('.');
  });

  it('does not use em-dashes, en-dashes, or double-hyphens in any output (brand discipline)', () => {
    const cases: Array<Parameters<typeof formatInvoiceAging>[0]> = [
      { status: 'paid', issue_date: '2026-05-01', due_date: '2026-05-31' },
      { status: 'cancelled', issue_date: '2026-05-01', due_date: '2026-05-31' },
      { status: 'draft', issue_date: '2026-05-01', due_date: '2026-05-31' },
      { status: 'sent', issue_date: null, due_date: '2026-05-11' }, // late
      { status: 'sent', issue_date: null, due_date: '2026-05-23' }, // today
      { status: 'sent', issue_date: null, due_date: '2026-05-24' }, // future
      { status: 'sent', issue_date: null, due_date: null }, // inert
      { status: 'sent', issue_date: null, due_date: 'invalid' }, // inert
    ];
    for (const inv of cases) {
      const out = formatInvoiceAging(inv, TODAY);
      expect(out).not.toMatch(/—|–/); // em-dash, en-dash
      expect(out).not.toMatch(/--/); // double-hyphen
      // The string "-" alone should also never appear in aging copy; either
      // we emit a positive integer or we emit "." as the inert placeholder.
      expect(out).not.toMatch(/^-/);
    }
  });
});
