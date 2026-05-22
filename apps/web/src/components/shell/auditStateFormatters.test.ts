// BNEW-7: regression tests for the AuditTimeline state-label formatter
// registry. The DB enum stays unchanged (`submitted` etc.); the UI must
// route quote entity rows through formatQuoteStateLabel and pass other
// entity types through the default Title-Case formatter.

import { describe, it, expect } from 'vitest';

import {
  defaultStateLabel,
  formatStateLabel,
} from './auditStateFormatters';

describe('auditStateFormatters', () => {
  describe('defaultStateLabel', () => {
    it('Title-Cases a single word', () => {
      expect(defaultStateLabel('draft')).toBe('Draft');
    });

    it('expands underscores to spaces and Title-Cases', () => {
      expect(defaultStateLabel('partially_paid')).toBe('Partially Paid');
    });

    it('handles an empty string', () => {
      expect(defaultStateLabel('')).toBe('');
    });
  });

  describe('formatStateLabel', () => {
    it('routes the quote entity through formatQuoteStateLabel', () => {
      // submitted is the DB enum; the operator-facing copy is "Sent for
      // approval" per PR #103 / B7.
      expect(formatStateLabel('quote', 'submitted')).toBe('Sent for approval');
    });

    it('passes other quote enum values through the Title-Case path', () => {
      expect(formatStateLabel('quote', 'draft')).toBe('Draft');
      expect(formatStateLabel('quote', 'revise_requested')).toBe(
        'Revise Requested',
      );
    });

    it('falls back to Title-Case for unknown entity types', () => {
      expect(formatStateLabel('shipment', 'picking')).toBe('Picking');
      expect(formatStateLabel('invoice', 'partially_paid')).toBe(
        'Partially Paid',
      );
      expect(formatStateLabel('manufacturing_run', 'started')).toBe('Started');
    });

    it('does not alter the input value the DB writes', () => {
      // Display-only: the registry must never mutate the input enum.
      const before = 'submitted';
      formatStateLabel('quote', before);
      expect(before).toBe('submitted');
    });
  });
});
