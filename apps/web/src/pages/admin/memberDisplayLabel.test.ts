// Unit tests for the /admin/members Name-column label helper.
//
// Pure (no React, no jsdom) per the repo convention. Matches the shape of
// membersInviteForm.test.ts.
//
// F-Wave9-COWORK-SMOKE-08: the operator-visible bug was the Name column
// showing the organization's display_name. These tests pin the behaviour
// the SPA falls back to once migration 0072 NULLs the offending
// profiles.display_name rows: display_name when set, then email, then a
// UUID short prefix as a final guard.

import { describe, it, expect } from 'vitest';

import { memberDisplayLabel } from './memberDisplayLabel';

const USER_ID = 'abcdef12-3456-7890-abcd-ef1234567890';

describe('memberDisplayLabel', () => {
  it('returns display_name when present (the member name, not the org name)', () => {
    expect(
      memberDisplayLabel({
        user_id: USER_ID,
        email: 'alice@example.com',
        display_name: 'Alice Anderson',
      }),
    ).toBe('Alice Anderson');
  });

  it('falls back to email when display_name is null (post-0072 owner profile)', () => {
    expect(
      memberDisplayLabel({
        user_id: USER_ID,
        email: 'alice@example.com',
        display_name: null,
      }),
    ).toBe('alice@example.com');
  });

  it('falls back to email when display_name is undefined', () => {
    expect(
      memberDisplayLabel({
        user_id: USER_ID,
        email: 'alice@example.com',
        display_name: undefined,
      }),
    ).toBe('alice@example.com');
  });

  it('treats a blank/whitespace display_name as missing', () => {
    expect(
      memberDisplayLabel({
        user_id: USER_ID,
        email: 'alice@example.com',
        display_name: '   ',
      }),
    ).toBe('alice@example.com');
  });

  it('trims display_name before returning', () => {
    expect(
      memberDisplayLabel({
        user_id: USER_ID,
        email: 'alice@example.com',
        display_name: '  Alice Anderson  ',
      }),
    ).toBe('Alice Anderson');
  });

  it('falls back to the UUID short prefix when both display_name and email are missing', () => {
    expect(
      memberDisplayLabel({
        user_id: USER_ID,
        email: null,
        display_name: null,
      }),
    ).toBe('abcdef12...');
  });

  it('falls back to the UUID short prefix when both are blank strings', () => {
    expect(
      memberDisplayLabel({
        user_id: USER_ID,
        email: '   ',
        display_name: '',
      }),
    ).toBe('abcdef12...');
  });

  it('never returns the literal organization name when the regression shape is supplied (defence in depth)', () => {
    // Pre-0072 regression shape: profile.display_name accidentally seeded
    // with the org's display_name. After 0072 backfill this row would have
    // display_name = null and the email fallback fires. We assert the
    // helper does not invent the org name from anywhere.
    const label = memberDisplayLabel({
      user_id: USER_ID,
      email: 'owner@acme.test',
      display_name: null,
    });
    expect(label).not.toBe('Acme Logistics');
    expect(label).toBe('owner@acme.test');
  });
});
