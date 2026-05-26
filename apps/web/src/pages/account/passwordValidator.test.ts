// Unit tests for the SecurityPage password-pair validator.
//
// The validator gates the SecurityPage submit button. It is pure: same
// inputs always yield the same message. We pin the contract here so any
// future change to the rules (minimum length, mismatch wording) is an
// intentional edit not a regression.

import { describe, it, expect } from 'vitest';

import { validatePasswordPair } from './passwordValidator';

describe('validatePasswordPair', () => {
  it('flags an empty password prompt before any keystroke', () => {
    expect(validatePasswordPair({ password: '', confirm: '' })).toBe(
      'Enter a new password.',
    );
  });

  it('rejects passwords shorter than 8 characters', () => {
    expect(
      validatePasswordPair({ password: 'short', confirm: 'short' }),
    ).toMatch(/at least 8/);
  });

  it('asks for confirmation when only the first field is filled', () => {
    expect(
      validatePasswordPair({ password: 'longenough1', confirm: '' }),
    ).toBe('Confirm the new password.');
  });

  it('flags a mismatch when the two fields differ', () => {
    expect(
      validatePasswordPair({ password: 'longenough1', confirm: 'longenough2' }),
    ).toBe('Passwords do not match.');
  });

  it('returns null when both passwords are equal and long enough', () => {
    expect(
      validatePasswordPair({ password: 'longenough1', confirm: 'longenough1' }),
    ).toBeNull();
  });

  it('treats exactly 8 characters as the minimum (inclusive)', () => {
    expect(
      validatePasswordPair({ password: '12345678', confirm: '12345678' }),
    ).toBeNull();
  });
});
