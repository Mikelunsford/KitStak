// PR-6 / B5: regression tests for the `?entity_type=` URL param
// validator on ActivityCreatePage. The full component renders inside
// react-router and TanStack Query; this file targets the pure helper
// that decides which entity type to pre-fill from the URL so the test
// stays a unit and matches the existing convention (logic units only).

import { describe, it, expect } from 'vitest';

import { parseEntityTypeParam } from './ActivityCreatePage';

describe('parseEntityTypeParam', () => {
  it('returns customer when the param is missing', () => {
    expect(parseEntityTypeParam(null)).toBe('customer');
  });

  it('returns customer when the param is empty', () => {
    expect(parseEntityTypeParam('')).toBe('customer');
  });

  it('returns customer for a valid customer param', () => {
    expect(parseEntityTypeParam('customer')).toBe('customer');
  });

  it('returns contact for a valid contact param', () => {
    expect(parseEntityTypeParam('contact')).toBe('contact');
  });

  it('returns lead for a valid lead param', () => {
    expect(parseEntityTypeParam('lead')).toBe('lead');
  });

  it('returns opportunity for a valid opportunity param', () => {
    expect(parseEntityTypeParam('opportunity')).toBe('opportunity');
  });

  it('falls back to customer for an invalid value', () => {
    expect(parseEntityTypeParam('invoice')).toBe('customer');
  });

  it('falls back to customer for an attacker payload', () => {
    expect(parseEntityTypeParam('"); drop table activities;--')).toBe('customer');
  });
});
