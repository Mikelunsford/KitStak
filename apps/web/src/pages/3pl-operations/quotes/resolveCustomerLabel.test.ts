// P0-2 regression: the quote detail header must never show the raw customer id
// while the name is loading. resolveCustomerLabel returns a neutral placeholder
// during the loading window and only defers to the id prefix once the query has
// settled (a genuinely nameless / missing customer stays diagnosable).

import { describe, it, expect } from 'vitest';

import {
  CUSTOMER_LOADING_LABEL,
  resolveCustomerLabel,
} from './resolveCustomerLabel';

const CUSTOMER_ID = 'c87e501c-0000-4000-8000-000000000001';

describe('resolveCustomerLabel', () => {
  it('shows a neutral placeholder, not the raw id, while loading with no name', () => {
    const label = resolveCustomerLabel(null, CUSTOMER_ID, true);
    expect(label).toBe(CUSTOMER_LOADING_LABEL);
    // The crux of P0-2: the raw id prefix must not leak into the header.
    expect(label).not.toContain('c87e501c');
  });

  it('shows the name as soon as it is present, even mid-load', () => {
    expect(resolveCustomerLabel('Acme Co', CUSTOMER_ID, true)).toBe('Acme Co');
  });

  it('shows the loaded name when settled', () => {
    expect(resolveCustomerLabel('Acme Co', CUSTOMER_ID, false)).toBe('Acme Co');
  });

  it('falls back to the id prefix for a settled nameless customer (diagnosable)', () => {
    // Not loading and no name: a deleted / cross-tenant / nameless record. The
    // short prefix is the existing acceptable fallback once the query is done.
    expect(resolveCustomerLabel(null, CUSTOMER_ID, false)).toBe('c87e501c');
  });

  it('returns an empty string when there is neither name nor id', () => {
    expect(resolveCustomerLabel(null, null, false)).toBe('');
  });
});
