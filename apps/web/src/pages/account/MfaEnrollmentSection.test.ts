// Unit coverage for the two-factor (TOTP) enrollment surface. R-W13-AUTH-01.
//
// Mirrors the FirstSigninWelcomeBanner test style: no jsdom, no testing-
// library. The pure isTotpCodeComplete predicate is exercised directly, and
// the module's rendered copy is locked against the constitutional voice via a
// source-text scan (the component itself uses React hooks, so calling it as a
// function is not safe; we lock its visible strings at the source level
// instead, the same outcome the element-tree copy-discipline checks give).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { isTotpCodeComplete } from './mfaCode';

describe('isTotpCodeComplete', () => {
  it('accepts exactly six digits', () => {
    expect(isTotpCodeComplete('123456')).toBe(true);
  });

  it('trims surrounding whitespace before checking', () => {
    expect(isTotpCodeComplete('  123456  ')).toBe(true);
  });

  it('rejects fewer than six digits', () => {
    expect(isTotpCodeComplete('12345')).toBe(false);
  });

  it('rejects more than six digits', () => {
    expect(isTotpCodeComplete('1234567')).toBe(false);
  });

  it('rejects non-digit characters', () => {
    expect(isTotpCodeComplete('12a456')).toBe(false);
    expect(isTotpCodeComplete('')).toBe(false);
  });
});

describe('MfaEnrollmentSection copy discipline', () => {
  // Constitutional invariant: no em dash, en dash, double hyphen, or emoji
  // in the source strings of the rendered surface. Locks the brand voice.
  const EM_DASH = /—/;
  const EN_DASH = /–/;
  const DOUBLE_HYPHEN = /--/;
  const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

  const source = readFileSync(
    join(__dirname, 'MfaEnrollmentSection.tsx'),
    'utf8',
  );
  // Pull every single- or double-quoted string literal from the source.
  const literals = source.match(/'[^']*'|"[^"]*"/g) ?? [];

  it('has no forbidden punctuation or emoji in any string literal', () => {
    for (const lit of literals) {
      expect(lit).not.toMatch(EM_DASH);
      expect(lit).not.toMatch(EN_DASH);
      expect(lit).not.toMatch(DOUBLE_HYPHEN);
      expect(lit).not.toMatch(EMOJI);
    }
  });

  it('surfaces the two-factor heading and the set-up call to action', () => {
    expect(source).toContain('TWO-FACTOR AUTHENTICATION');
    expect(source).toContain('Set up authenticator app');
    expect(source).toContain('Verify and enable');
  });
});
