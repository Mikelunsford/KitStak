// F-Wave9-AUDIT-V3-WAVE-E-01 (item 4): regression suite for the
// PDF gating predicate. Pure function, no React.

import { describe, it, expect } from 'vitest';

import { isPdfDisabledForDraft } from './pdfGating';

describe('isPdfDisabledForDraft', () => {
  it('returns true for draft state', () => {
    expect(isPdfDisabledForDraft('draft')).toBe(true);
  });

  it('returns true for revise_requested (quote pre-customer state)', () => {
    expect(isPdfDisabledForDraft('revise_requested')).toBe(true);
  });

  it('returns false for invoice sent state', () => {
    expect(isPdfDisabledForDraft('sent')).toBe(false);
  });

  it('returns false for quote submitted state', () => {
    expect(isPdfDisabledForDraft('submitted')).toBe(false);
  });

  it('returns false for quote approved state', () => {
    expect(isPdfDisabledForDraft('approved')).toBe(false);
  });

  it('returns false for invoice paid state', () => {
    expect(isPdfDisabledForDraft('paid')).toBe(false);
  });

  it('returns false for cancelled (gating is about drafts, not terminal)', () => {
    expect(isPdfDisabledForDraft('cancelled')).toBe(false);
  });

  it('returns false for null or undefined state (no signal yet)', () => {
    expect(isPdfDisabledForDraft(null)).toBe(false);
    expect(isPdfDisabledForDraft(undefined)).toBe(false);
  });

  it('returns false for an unknown state value', () => {
    expect(isPdfDisabledForDraft('made_up_state')).toBe(false);
  });
});
