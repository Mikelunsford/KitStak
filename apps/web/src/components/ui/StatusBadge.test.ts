// Unit tests for the shared StatusBadge helpers (F-Wave10-UI-KIT-01).
// The full portal vocabulary is locked by pages/portal/components/
// StatusBadge.test.ts (which now imports through the re-export). This suite
// covers the operator quote states added during the kit promotion.

import { describe, it, expect } from 'vitest';

import { humaniseStatus, statusColorClass } from './StatusBadge';

describe('humaniseStatus - operator quote states', () => {
  it('humanises submitted', () => {
    expect(humaniseStatus('submitted')).toBe('Submitted');
  });

  it('humanises revise_requested without leaking the underscore', () => {
    const label = humaniseStatus('revise_requested');
    expect(label).toBe('Revision requested');
    expect(label).not.toContain('_');
  });

  it('keeps project_pending customer-facing language', () => {
    expect(humaniseStatus('project_pending')).toBe('Converted to project');
  });

  it('humanises every quote state to a non-empty sentence-case label', () => {
    const states = [
      'draft',
      'submitted',
      'revise_requested',
      'approved',
      'project_pending',
      'cancelled',
    ];
    for (const s of states) {
      const label = humaniseStatus(s);
      expect(label.length).toBeGreaterThan(0);
      expect(label).not.toContain('_');
      expect(label.charAt(0)).toBe(label.charAt(0).toUpperCase());
      expect(label).not.toBe(label.toUpperCase());
    }
  });
});

describe('humaniseStatus - 3PL finance states (credit note, expense, vendor bill)', () => {
  it('humanises the credit note states', () => {
    expect(humaniseStatus('issued')).toBe('Issued');
    expect(humaniseStatus('applied')).toBe('Applied');
    expect(humaniseStatus('voided')).toBe('Voided');
  });

  it('humanises the expense reimbursed state', () => {
    expect(humaniseStatus('reimbursed')).toBe('Reimbursed');
  });

  it('humanises vendor bill partial_paid without leaking the underscore', () => {
    const label = humaniseStatus('partial_paid');
    expect(label).toBe('Partially paid');
    expect(label).not.toContain('_');
  });
});

describe('statusColorClass', () => {
  it('maps known states to brand color tokens', () => {
    expect(statusColorClass('approved')).toBe('bg-green-500');
    expect(statusColorClass('submitted')).toBe('bg-accent');
    expect(statusColorClass('revise_requested')).toBe('bg-yellow-500');
    expect(statusColorClass('draft')).toBe('bg-ink-dim');
  });

  it('maps the 3PL finance states to brand tokens', () => {
    expect(statusColorClass('issued')).toBe('bg-accent');
    expect(statusColorClass('applied')).toBe('bg-green-500');
    expect(statusColorClass('voided')).toBe('bg-ink-dim');
    expect(statusColorClass('reimbursed')).toBe('bg-green-500');
    expect(statusColorClass('partial_paid')).toBe('bg-yellow-500');
  });

  it('falls back to neutral for an unknown state', () => {
    expect(statusColorClass('totally_new_state')).toBe('bg-ink-dim');
  });

  it('is case tolerant', () => {
    expect(statusColorClass('Approved')).toBe('bg-green-500');
  });

  it('maps customer statuses', () => {
    expect(statusColorClass('active')).toBe('bg-green-500');
    expect(statusColorClass('inactive')).toBe('bg-ink-dim');
    expect(statusColorClass('new')).toBe('bg-yellow-500');
    expect(humaniseStatus('active')).toBe('Active');
    expect(humaniseStatus('inactive')).toBe('Inactive');
    expect(humaniseStatus('new')).toBe('New');
  });
});
