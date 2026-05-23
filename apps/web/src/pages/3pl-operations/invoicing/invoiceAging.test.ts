// Unit tests for the F-Wave9-AUDIT-V3-WAVE-D-01 invoice aging helper.
// All cases pin "today" to a deterministic clock so the suite stays
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

  it('returns "." when both issue_date and due_date are null', () => {
    expect(
      formatInvoiceAging({ status: 'draft', issue_date: null, due_date: null }, TODAY),
    ).toBe('.');
  });

  it('uses due_date when present (days since due)', () => {
    // due 2026-05-11, today 2026-05-23 -> 12 days overdue.
    expect(
      formatInvoiceAging(
        { status: 'sent', issue_date: '2026-04-11', due_date: '2026-05-11' },
        TODAY,
      ),
    ).toBe('12 days');
  });

  it('falls back to issue_date when due_date is null', () => {
    // issued 2026-05-22, today 2026-05-23 -> 1 day.
    expect(
      formatInvoiceAging(
        { status: 'draft', issue_date: '2026-05-22', due_date: null },
        TODAY,
      ),
    ).toBe('1 day');
  });

  it('uses singular unit at exactly 1 day in either direction', () => {
    expect(
      formatInvoiceAging(
        { status: 'sent', issue_date: null, due_date: '2026-05-22' },
        TODAY,
      ),
    ).toBe('1 day');
    expect(
      formatInvoiceAging(
        { status: 'sent', issue_date: null, due_date: '2026-05-24' },
        TODAY,
      ),
    ).toBe('-1 day');
  });

  it('returns "0 days" on the due date itself', () => {
    expect(
      formatInvoiceAging(
        { status: 'sent', issue_date: null, due_date: '2026-05-23' },
        TODAY,
      ),
    ).toBe('0 days');
  });

  it('returns negative days when due_date is in the future (credit-side aging)', () => {
    // due 2026-06-22, today 2026-05-23 -> -30 days (30 days until due).
    expect(
      formatInvoiceAging(
        { status: 'sent', issue_date: '2026-05-23', due_date: '2026-06-22' },
        TODAY,
      ),
    ).toBe('-30 days');
  });

  it('returns "." for an unparseable date string', () => {
    expect(
      formatInvoiceAging(
        { status: 'draft', issue_date: '2026/05/22', due_date: null },
        TODAY,
      ),
    ).toBe('.');
    expect(
      formatInvoiceAging(
        { status: 'draft', issue_date: 'not-a-date', due_date: null },
        TODAY,
      ),
    ).toBe('.');
  });

  it('does not use em-dashes or double-hyphens in any output (brand discipline)', () => {
    const cases: Array<Parameters<typeof formatInvoiceAging>[0]> = [
      { status: 'paid', issue_date: '2026-05-01', due_date: '2026-05-31' },
      { status: 'cancelled', issue_date: '2026-05-01', due_date: '2026-05-31' },
      { status: 'sent', issue_date: '2026-05-22', due_date: '2026-05-24' },
      { status: 'draft', issue_date: null, due_date: null },
      { status: 'sent', issue_date: null, due_date: 'invalid' },
    ];
    for (const inv of cases) {
      const out = formatInvoiceAging(inv, TODAY);
      expect(out).not.toMatch(/—|–/); // em-dash, en-dash
      expect(out).not.toMatch(/--/);  // double-hyphen
    }
  });
});
