// Pin the Tabs pure resolution helpers (active-key resolution + keyboard index
// math). The component itself is exercised via these helpers because it uses
// hooks; the repo tests components by element-tree walk, which cannot call a
// hook-using function directly.

import { describe, it, expect } from 'vitest';

import { resolveActiveTabKey, nextTabIndex } from './Tabs';

describe('resolveActiveTabKey', () => {
  const keys = ['overview', 'quotes', 'invoices'];

  it('returns the param value when it names a real tab', () => {
    expect(resolveActiveTabKey(keys, 'quotes')).toBe('quotes');
  });

  it('falls back to the default key when the param is missing', () => {
    expect(resolveActiveTabKey(keys, null, 'invoices')).toBe('invoices');
  });

  it('falls back to the default key when the param is unknown', () => {
    expect(resolveActiveTabKey(keys, 'bogus', 'invoices')).toBe('invoices');
  });

  it('falls back to the first tab when param and default are both absent', () => {
    expect(resolveActiveTabKey(keys, null)).toBe('overview');
  });

  it('falls back to the first tab when the default is also unknown', () => {
    expect(resolveActiveTabKey(keys, null, 'nope')).toBe('overview');
  });

  it('returns an empty string for an empty tab set', () => {
    expect(resolveActiveTabKey([], 'anything', 'x')).toBe('');
  });
});

describe('nextTabIndex', () => {
  it('moves right and wraps at the end', () => {
    expect(nextTabIndex('ArrowRight', 0, 3)).toBe(1);
    expect(nextTabIndex('ArrowRight', 2, 3)).toBe(0);
  });

  it('moves left and wraps at the start', () => {
    expect(nextTabIndex('ArrowLeft', 2, 3)).toBe(1);
    expect(nextTabIndex('ArrowLeft', 0, 3)).toBe(2);
  });

  it('jumps to the first tab on Home and the last on End', () => {
    expect(nextTabIndex('Home', 2, 3)).toBe(0);
    expect(nextTabIndex('End', 0, 3)).toBe(2);
  });

  it('returns null for keys that should not move focus', () => {
    expect(nextTabIndex('Enter', 0, 3)).toBeNull();
    expect(nextTabIndex('a', 1, 3)).toBeNull();
  });

  it('returns null when there are no tabs', () => {
    expect(nextTabIndex('ArrowRight', 0, 0)).toBeNull();
  });
});
