// Spine plus add-ons re-route: redirect resolver coverage.
//
// The component itself is a two-line wrapper over useLocation + Navigate, so
// the logic worth locking in lives in the pure helpers. These tests assert the
// prefix rewrite preserves dynamic segments, query, and hash, matches on
// segment boundaries, and leaves unmapped paths (receiving, shipments,
// production) untouched.

import { describe, expect, it } from 'vitest';

import {
  REDIRECT_PREFIX_MAP,
  rewriteSpinePath,
  resolveSpineRedirect,
} from './SpineMoveRedirect';

describe('rewriteSpinePath', () => {
  it('rewrites a moved base path to its new spine home', () => {
    expect(rewriteSpinePath('/3pl-operations/quotes')).toBe('/quotes');
    expect(rewriteSpinePath('/3pl-operations/projects')).toBe('/projects');
    expect(rewriteSpinePath('/3pl-operations/items')).toBe('/catalog/items');
    expect(rewriteSpinePath('/3pl-operations/warehouses')).toBe(
      '/inventory/warehouses',
    );
  });

  it('preserves a dynamic :id segment', () => {
    expect(rewriteSpinePath('/3pl-operations/quotes/abc-123')).toBe(
      '/quotes/abc-123',
    );
    expect(rewriteSpinePath('/3pl-operations/vendors/9f/edit')).toBe(
      '/purchasing/vendors/9f/edit',
    );
  });

  it('preserves nested action segments', () => {
    expect(rewriteSpinePath('/3pl-operations/quotes/abc/send')).toBe(
      '/quotes/abc/send',
    );
  });

  it('maps the two-segment domains to their grouped roots', () => {
    expect(rewriteSpinePath('/3pl-operations/stock/levels')).toBe(
      '/inventory/stock/levels',
    );
    expect(rewriteSpinePath('/3pl-operations/stock/movements')).toBe(
      '/inventory/stock/movements',
    );
    expect(rewriteSpinePath('/3pl-operations/sales-config/taxes/new')).toBe(
      '/settings/sales-config/taxes/new',
    );
    expect(rewriteSpinePath('/3pl-operations/purchase-orders/po-1')).toBe(
      '/purchasing/purchase-orders/po-1',
    );
  });

  it('folds the payments and credit-notes create surfaces into /invoicing', () => {
    expect(rewriteSpinePath('/3pl-operations/payments/new')).toBe(
      '/invoicing/payments/new',
    );
    expect(rewriteSpinePath('/3pl-operations/credit-notes/new')).toBe(
      '/invoicing/credit-notes/new',
    );
  });

  it('does not confuse vendor-bills with vendors (segment-boundary match)', () => {
    expect(rewriteSpinePath('/3pl-operations/vendor-bills/7')).toBe(
      '/purchasing/vendor-bills/7',
    );
  });

  it('returns null for the surfaces that stay under /3pl-operations', () => {
    expect(rewriteSpinePath('/3pl-operations/receiving')).toBeNull();
    expect(rewriteSpinePath('/3pl-operations/shipments/1')).toBeNull();
    expect(rewriteSpinePath('/3pl-operations/production')).toBeNull();
    expect(rewriteSpinePath('/3pl-operations/production/abc')).toBeNull();
  });

  it('returns null for unrelated paths and avoids false prefix matches', () => {
    expect(rewriteSpinePath('/dashboard')).toBeNull();
    expect(rewriteSpinePath('/crm/customers')).toBeNull();
    // Sibling that merely shares a prefix string must not be captured.
    expect(rewriteSpinePath('/3pl-operations/quotesextra')).toBeNull();
  });
});

describe('resolveSpineRedirect', () => {
  it('preserves query string and hash on the rewritten path', () => {
    expect(
      resolveSpineRedirect({
        pathname: '/3pl-operations/quotes/abc',
        search: '?state=submitted',
        hash: '#lines',
      }),
    ).toEqual({
      pathname: '/quotes/abc',
      search: '?state=submitted',
      hash: '#lines',
    });
  });

  it('returns the original pathname unchanged when no prefix matches', () => {
    expect(
      resolveSpineRedirect({
        pathname: '/3pl-operations/receiving',
        search: '?status=draft',
        hash: '',
      }),
    ).toEqual({
      pathname: '/3pl-operations/receiving',
      search: '?status=draft',
      hash: '',
    });
  });
});

describe('REDIRECT_PREFIX_MAP', () => {
  it('maps every old prefix to a distinct ungated spine root', () => {
    for (const [from, to] of REDIRECT_PREFIX_MAP) {
      expect(from.startsWith('/3pl-operations/')).toBe(true);
      expect(to.startsWith('/3pl-operations')).toBe(false);
    }
  });
});
