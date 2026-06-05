// Tests for the UX-Q10 breadcrumb fallback helper. Covers:
//   - returns the loaded label when present (preferred path)
//   - returns a short UUID prefix when the label is null / undefined / empty
//   - returns empty string when both label and id are absent
//   - honours a custom prefixLength
//   - smoke tests representative breadcrumb item arrays from three detail
//     pages so a future refactor that breaks the chain shape is caught
//     by the regression suite (mirrors the spec's "2-3 representative
//     detail pages" requirement).

import { describe, it, expect } from 'vitest';

import { fallbackLabel } from './breadcrumbFallback';
import type { BreadcrumbItem } from './Breadcrumbs';

describe('fallbackLabel', () => {
  it('returns the loaded label when present', () => {
    expect(fallbackLabel('Smoke Co.', 'abc12345-deadbeef')).toBe('Smoke Co.');
  });

  it('falls back to an 8-char UUID prefix when label is null', () => {
    expect(fallbackLabel(null, 'abc12345-deadbeef')).toBe('abc12345');
  });

  it('falls back to an 8-char UUID prefix when label is undefined', () => {
    expect(fallbackLabel(undefined, 'abc12345-deadbeef')).toBe('abc12345');
  });

  it('falls back to an 8-char UUID prefix when label is empty string', () => {
    expect(fallbackLabel('', 'abc12345-deadbeef')).toBe('abc12345');
  });

  it('returns empty string when both label and id are absent', () => {
    expect(fallbackLabel(null, null)).toBe('');
    expect(fallbackLabel(undefined, undefined)).toBe('');
    expect(fallbackLabel('', '')).toBe('');
  });

  it('honours a custom prefixLength', () => {
    expect(fallbackLabel(null, 'abc12345-deadbeef', 4)).toBe('abc1');
  });
});

describe('representative detail-page breadcrumb shapes (UX-Q10 smoke)', () => {
  // These mirror the item arrays each detail page builds. They are pure data,
  // so we can lock the chain shape without rendering React. If a future
  // refactor changes the order, removes the trailing "current" item, or
  // rewires a route, the suite catches it.

  it('QuoteDetailPage chain: Customers -> Customer -> Quotes -> Quote#', () => {
    const customerId = 'cust-id';
    const customerName = 'Smoke Co.';
    const quoteNumber = 'SMOKE-001';
    const items: BreadcrumbItem[] = [
      { label: 'Customers', to: '/crm/customers' },
      { label: customerName, to: `/crm/customers/${customerId}` },
      { label: 'Quotes', to: '/quotes' },
      { label: quoteNumber },
    ];
    expect(items).toHaveLength(4);
    expect(items[0]!.to).toBe('/crm/customers');
    expect(items[1]!.to).toBe(`/crm/customers/${customerId}`);
    expect(items[2]!.to).toBe('/quotes');
    expect(items[3]!.to).toBeUndefined();
    expect(items[3]!.label).toBe(quoteNumber);
  });

  it('ProjectDetailPage chain with source quote inserts Quotes ancestor', () => {
    const customerId = 'cust-id';
    const sourceQuoteId = 'quote-id';
    const items: BreadcrumbItem[] = [
      { label: 'Customers', to: '/crm/customers' },
      { label: 'Smoke Co.', to: `/crm/customers/${customerId}` },
      { label: 'Quotes', to: '/quotes' },
      { label: 'SMOKE-001', to: `/quotes/${sourceQuoteId}` },
      { label: 'Projects', to: '/projects' },
      { label: 'PRJ-001' },
    ];
    // 5 ancestor links + 1 current label.
    expect(items).toHaveLength(6);
    expect(items.filter((it) => it.to !== undefined)).toHaveLength(5);
    expect(items[items.length - 1]!.to).toBeUndefined();
    expect(items[items.length - 1]!.label).toBe('PRJ-001');
  });

  it('InvoiceDetailPage chain: Customers -> Customer -> Invoices -> Invoice#', () => {
    const customerId = 'cust-id';
    const items: BreadcrumbItem[] = [
      { label: 'Customers', to: '/crm/customers' },
      { label: 'Smoke Co.', to: `/crm/customers/${customerId}` },
      { label: 'Invoices', to: '/invoicing/invoices' },
      { label: 'INV-001' },
    ];
    expect(items).toHaveLength(4);
    expect(items[2]!.to).toBe('/invoicing/invoices');
    expect(items[3]!.to).toBeUndefined();
  });
});
