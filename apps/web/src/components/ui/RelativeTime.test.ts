// F-Wave9-AUDIT-V3-WAVE-F-01: unit tests for `formatRelativeLabel`,
// the pure helper underneath the <RelativeTime> component.
//
// The SPA test suite is node-only (no jsdom), so we test the pure
// label-computation function exhaustively rather than mounting the
// component. The component itself is a thin createElement wrapper
// whose only logic is "render label inside chosen element with a title
// attribute" — that shape is locked by TypeScript and the component
// JSDoc.

import { describe, it, expect } from 'vitest';

import { formatRelativeLabel } from './RelativeTime';

const REF = new Date('2026-05-23T12:00:00.000Z');

describe('formatRelativeLabel', () => {
  describe('null / undefined / empty inputs', () => {
    it('returns empty string for null', () => {
      expect(formatRelativeLabel(null, REF)).toBe('');
    });

    it('returns empty string for undefined', () => {
      expect(formatRelativeLabel(undefined, REF)).toBe('');
    });

    it('returns empty string for empty string', () => {
      expect(formatRelativeLabel('', REF)).toBe('');
    });

    it('returns empty string for unparseable ISO', () => {
      expect(formatRelativeLabel('not-a-date', REF)).toBe('');
    });
  });

  describe('seconds ago', () => {
    it('renders seconds when under one minute', () => {
      const then = new Date(REF.getTime() - 30_000).toISOString();
      const out = formatRelativeLabel(then, REF);
      // Intl.RelativeTimeFormat with numeric: 'auto' may pick
      // "30 seconds ago" or similar; the assertion locks the unit
      // boundary, not the exact phrasing.
      expect(out).toMatch(/second/);
      expect(out).toMatch(/ago|now/);
    });
  });

  describe('minutes ago', () => {
    it('renders minutes when between one minute and one hour', () => {
      const then = new Date(REF.getTime() - 5 * 60_000).toISOString();
      const out = formatRelativeLabel(then, REF);
      expect(out).toMatch(/minute/);
      expect(out).toMatch(/5/);
    });
  });

  describe('hours ago', () => {
    it('renders hours when between one hour and one day', () => {
      const then = new Date(REF.getTime() - 2 * 60 * 60_000).toISOString();
      const out = formatRelativeLabel(then, REF);
      expect(out).toMatch(/hour/);
      expect(out).toMatch(/2/);
    });
  });

  describe('days ago', () => {
    it('renders days when between one day and one week', () => {
      const then = new Date(REF.getTime() - 3 * 24 * 60 * 60_000).toISOString();
      const out = formatRelativeLabel(then, REF);
      expect(out).toMatch(/day/);
      expect(out).toMatch(/3/);
    });
  });

  describe('weeks ago', () => {
    it('renders weeks when between one week and ~30 days', () => {
      const then = new Date(
        REF.getTime() - 2 * 7 * 24 * 60 * 60_000,
      ).toISOString();
      const out = formatRelativeLabel(then, REF);
      expect(out).toMatch(/week/);
      expect(out).toMatch(/2/);
    });
  });

  describe('months ago', () => {
    it('renders months when between ~30 days and ~1 year', () => {
      const then = new Date(
        REF.getTime() - 90 * 24 * 60 * 60_000,
      ).toISOString();
      const out = formatRelativeLabel(then, REF);
      expect(out).toMatch(/month/);
    });
  });

  describe('older than ~1 year', () => {
    it('falls back to an absolute medium date', () => {
      const then = new Date('2024-05-23T12:00:00.000Z').toISOString();
      const out = formatRelativeLabel(then, REF);
      // Absolute medium date for May 23, 2024 contains the year as
      // its long form, which is unambiguous regardless of locale
      // formatting quirks.
      expect(out).toMatch(/2024/);
      // Defends against an accidental regression to RelativeTimeFormat
      // for old timestamps; "year"/"month" should not appear in the
      // absolute-date fallback.
      expect(out).not.toMatch(/ago/);
    });
  });

  describe('future timestamps', () => {
    it('renders "in N <unit>" via the same RelativeTimeFormat path', () => {
      const then = new Date(REF.getTime() + 5 * 60_000).toISOString();
      const out = formatRelativeLabel(then, REF);
      expect(out).toMatch(/minute/);
      expect(out).toMatch(/in 5|5 minute/);
    });

    it('handles future days', () => {
      const then = new Date(
        REF.getTime() + 3 * 24 * 60 * 60_000,
      ).toISOString();
      const out = formatRelativeLabel(then, REF);
      expect(out).toMatch(/day/);
    });
  });

  describe('determinism', () => {
    it('uses the supplied `now` arg, not the system clock', () => {
      const then = new Date('2026-05-23T11:00:00.000Z').toISOString();
      // 1 hour before REF.
      const out = formatRelativeLabel(then, REF);
      expect(out).toMatch(/hour/);
      expect(out).toMatch(/1|an/);
    });
  });
});
