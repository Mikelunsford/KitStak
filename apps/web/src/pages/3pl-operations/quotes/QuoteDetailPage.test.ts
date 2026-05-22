// PR-6 / B7: regression tests for the quote-state label formatter.
// The DB enum keeps the value `submitted` (forward-only migrations),
// but the operator-facing verb is "Sent for approval" in the pre-
// approval phase. This test pins both halves of that contract.

import { describe, it, expect } from 'vitest';

import { formatQuoteStateLabel } from './formatQuoteStateLabel';

describe('formatQuoteStateLabel', () => {
  it('relabels submitted as "Sent for approval"', () => {
    expect(formatQuoteStateLabel('submitted')).toBe('Sent for approval');
  });

  it('Title-Cases draft', () => {
    expect(formatQuoteStateLabel('draft')).toBe('Draft');
  });

  it('Title-Cases approved', () => {
    expect(formatQuoteStateLabel('approved')).toBe('Approved');
  });

  it('Title-Cases cancelled', () => {
    expect(formatQuoteStateLabel('cancelled')).toBe('Cancelled');
  });

  it('expands underscores to spaces (revise_requested)', () => {
    expect(formatQuoteStateLabel('revise_requested')).toBe('Revise Requested');
  });

  it('expands underscores to spaces (project_pending)', () => {
    expect(formatQuoteStateLabel('project_pending')).toBe('Project Pending');
  });
});
