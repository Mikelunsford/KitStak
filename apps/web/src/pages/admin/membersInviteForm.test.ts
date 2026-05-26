// Unit tests for the /admin/members invite-form pure helpers.
//
// Pure (no React, no jsdom) per the repo convention. Matches the shape of
// dashboardChecklistSteps.test.ts and sendButtonFeedback.test.ts.

import { describe, it, expect } from 'vitest';

import {
  INVITE_ROLE_OPTIONS,
  DEFAULT_INVITE_ROLE,
  isInviteFormSubmittable,
} from './membersInviteForm';

describe('INVITE_ROLE_OPTIONS', () => {
  it('offers exactly five staff role choices', () => {
    expect(INVITE_ROLE_OPTIONS).toHaveLength(5);
  });

  it('lists org_admin, sales, ops, accounting, viewer in scope-descending order', () => {
    expect(INVITE_ROLE_OPTIONS.map((o) => o.value)).toEqual([
      'org_admin',
      'sales',
      'ops',
      'accounting',
      'viewer',
    ]);
  });

  it('never offers org_owner (privilege-escalation guard mirrors the backend)', () => {
    const codes = INVITE_ROLE_OPTIONS.map((o) => o.value);
    expect(codes).not.toContain('org_owner');
  });

  it('never offers customer_user or vendor_user (portal codes, not staff)', () => {
    const codes = INVITE_ROLE_OPTIONS.map((o) => o.value);
    expect(codes).not.toContain('customer_user');
    expect(codes).not.toContain('vendor_user');
  });

  it('uses operator-readable labels (no em dash, no double hyphen, no emoji)', () => {
    for (const option of INVITE_ROLE_OPTIONS) {
      expect(option.label).not.toMatch(/—|--/);
      expect(option.label).not.toMatch(
        /[\u{1F300}-\u{1FAFF}]|[\u{2600}-\u{27BF}]/u,
      );
      expect(option.label.length).toBeGreaterThan(0);
    }
  });
});

describe('DEFAULT_INVITE_ROLE', () => {
  it('is one of the offered options', () => {
    const codes = INVITE_ROLE_OPTIONS.map((o) => o.value);
    expect(codes).toContain(DEFAULT_INVITE_ROLE);
  });

  it('matches the first option in the dropdown (visual cue and bound value agree)', () => {
    expect(DEFAULT_INVITE_ROLE).toBe(INVITE_ROLE_OPTIONS[0]?.value);
  });
});

describe('isInviteFormSubmittable', () => {
  it('returns false while the mutation is pending', () => {
    expect(
      isInviteFormSubmittable({
        email: 'alice@example.com',
        role: 'sales',
        isPending: true,
      }),
    ).toBe(false);
  });

  it('returns false when the email is blank or whitespace', () => {
    expect(
      isInviteFormSubmittable({ email: '', role: 'sales', isPending: false }),
    ).toBe(false);
    expect(
      isInviteFormSubmittable({
        email: '   ',
        role: 'sales',
        isPending: false,
      }),
    ).toBe(false);
  });

  it('returns false when role is empty', () => {
    expect(
      isInviteFormSubmittable({
        email: 'alice@example.com',
        role: '',
        isPending: false,
      }),
    ).toBe(false);
  });

  it('returns true with non-empty email, a role, and not pending', () => {
    expect(
      isInviteFormSubmittable({
        email: 'alice@example.com',
        role: 'sales',
        isPending: false,
      }),
    ).toBe(true);
  });
});
