// Unit tests for the customer-portal status label humaniser.
//
// F-Wave9-PORTAL-STATUS-LABEL-HUMANIZE-01: lock down two contracts the
// production smoke walk surfaced as broken.
//
//   1. Every status string the four /portal/* endpoints can emit maps to
//      a humane, customer-readable label.
//   2. No mapped label leaks engineering speak: no underscores, no
//      ALL_CAPS, no `Project_Pending` Pascal-snake-case artifacts.
//
// The status set below is the union of every state the four bundles
// (invoices, quotes, projects) write to their state column today. Add new
// entries here AND in the LABEL_MAP at the same time when a new status
// lands in the database state machine.

import { describe, it, expect } from 'vitest';

import { humaniseStatus } from './StatusBadge';

// The full vocabulary the customer portal can render today.
const PORTAL_VISIBLE_STATUSES = [
  // Invoice
  'draft',
  'pending',
  'sent',
  'paid',
  'partial',
  'partially_paid',
  'overdue',
  'void',
  'on_hold',
  'cancelled',
  // Quote
  'approved',
  'declined',
  'expired',
  'converted',
  'project_pending',
  'rejected',
  // Project
  'lead',
  'ready_to_build',
  'in_production',
  'ready_to_ship',
  'shipped',
  'completed',
  'on_track',
  'delayed',
] as const;

describe('humaniseStatus — every portal status maps to a humane label', () => {
  for (const status of PORTAL_VISIBLE_STATUSES) {
    it(`humanises "${status}" without leaking engineering speak`, () => {
      const label = humaniseStatus(status);
      // Must not be empty.
      expect(label.length).toBeGreaterThan(0);
      // Must not contain an underscore (the original bug).
      expect(label).not.toContain('_');
      // Must not be the raw enum value (the StatusBadge previously rendered
      // the raw string when the LABEL_MAP missed an entry).
      expect(label).not.toBe(status);
      // Must be sentence-case: first character uppercase, no all-caps.
      const firstChar = label.charAt(0);
      expect(firstChar).toBe(firstChar.toUpperCase());
      expect(label).not.toBe(label.toUpperCase());
      // No em dashes, no double hyphens, no emoji (constitutional ban).
      expect(label).not.toMatch(/—/);
      expect(label).not.toMatch(/--/);
    });
  }
});

describe('humaniseStatus — explicit spot checks for the production smoke bugs', () => {
  it('renders project_pending as "Converted to project" (customer-facing language)', () => {
    expect(humaniseStatus('project_pending')).toBe('Converted to project');
  });

  it('renders Project_pending (Pascal-snake-case) as the same humanised label', () => {
    // The 2026-05-26 prod smoke walk caught the badge showing the raw
    // Pascal-snake-case value because the lookup was case-sensitive.
    expect(humaniseStatus('Project_pending')).toBe('Converted to project');
  });

  it('renders paid as "Paid"', () => {
    expect(humaniseStatus('paid')).toBe('Paid');
  });

  it('renders draft as "Draft"', () => {
    expect(humaniseStatus('draft')).toBe('Draft');
  });

  it('renders approved as "Approved"', () => {
    expect(humaniseStatus('approved')).toBe('Approved');
  });

  it('renders in_production as "In production" (sentence case, no underscore)', () => {
    expect(humaniseStatus('in_production')).toBe('In production');
  });
});

describe('humaniseStatus — defensive fallback for unmapped values', () => {
  it('strips underscores and sentence-cases an unmapped value', () => {
    // If a brand new database state ever lands in production before the
    // LABEL_MAP is updated, the fallback transform must still hide the
    // underscores from the customer.
    expect(humaniseStatus('some_brand_new_state')).toBe('Some brand new state');
  });

  it('returns the empty string when the input is empty', () => {
    expect(humaniseStatus('')).toBe('');
  });
});
