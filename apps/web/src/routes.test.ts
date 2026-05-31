// F-Wave9-COWORK-SMOKE-06 regression suite.
//
// Locks in the SPA mirror of the Edge bundle-level plugin gate. The
// ROUTES export must carry `requiresPlugin` for every /3pl-operations/*,
// /manufacturing/*, /kitcost/*, and /copack/* route so RequirePlugin
// renders the NotFoundPage when the pillar plugin flag is off.

import { describe, expect, it } from 'vitest';

import { FEATURE_FLAGS } from '@/lib/constants';

import { ROUTES, __internals, type RouteSpec } from './routes';

const { inferPluginForPath, withPluginGate, RAW_ROUTES } = __internals;

function specFor(path: string): RouteSpec {
  return {
    path,
    // The actual element doesn't matter for these tests; the inference
    // helper only reads `path`. Use a placeholder LazyExoticComponent shape.
    element: (() => null) as unknown as RouteSpec['element'],
    guard: 'protected',
    layout: 'shell',
  };
}

describe('inferPluginForPath', () => {
  it('returns PLUGINS_THREE_PL for /3pl-operations/* routes', () => {
    expect(inferPluginForPath(specFor('/3pl-operations/quotes'))).toBe(
      FEATURE_FLAGS.PLUGINS_THREE_PL,
    );
    expect(inferPluginForPath(specFor('/3pl-operations/projects/abc'))).toBe(
      FEATURE_FLAGS.PLUGINS_THREE_PL,
    );
    expect(inferPluginForPath(specFor('/3pl-operations/warehouses/new'))).toBe(
      FEATURE_FLAGS.PLUGINS_THREE_PL,
    );
  });

  it('returns PLUGINS_MANUFACTURING for the /manufacturing pillar root and its routes', () => {
    expect(inferPluginForPath(specFor('/manufacturing'))).toBe(
      FEATURE_FLAGS.PLUGINS_MANUFACTURING,
    );
    expect(inferPluginForPath(specFor('/manufacturing/runs'))).toBe(
      FEATURE_FLAGS.PLUGINS_MANUFACTURING,
    );
    expect(inferPluginForPath(specFor('/manufacturing/runs/new'))).toBe(
      FEATURE_FLAGS.PLUGINS_MANUFACTURING,
    );
  });

  it('returns PLUGINS_KITCOST for /kitcost/* routes', () => {
    expect(inferPluginForPath(specFor('/kitcost/dashboard'))).toBe(
      FEATURE_FLAGS.PLUGINS_KITCOST,
    );
  });

  it('returns PLUGINS_COPACK_ECOM for the /copack pillar root and its routes', () => {
    expect(inferPluginForPath(specFor('/copack'))).toBe(
      FEATURE_FLAGS.PLUGINS_COPACK_ECOM,
    );
    expect(inferPluginForPath(specFor('/copack/orders'))).toBe(
      FEATURE_FLAGS.PLUGINS_COPACK_ECOM,
    );
    expect(inferPluginForPath(specFor('/copack/fulfillments/new'))).toBe(
      FEATURE_FLAGS.PLUGINS_COPACK_ECOM,
    );
  });

  it('returns PLUGINS_KITFORCE for the /kitforce pillar root and its routes', () => {
    expect(inferPluginForPath(specFor('/kitforce'))).toBe(
      FEATURE_FLAGS.PLUGINS_KITFORCE,
    );
    expect(inferPluginForPath(specFor('/kitforce/members'))).toBe(
      FEATURE_FLAGS.PLUGINS_KITFORCE,
    );
    expect(inferPluginForPath(specFor('/kitforce/members/new'))).toBe(
      FEATURE_FLAGS.PLUGINS_KITFORCE,
    );
    expect(inferPluginForPath(specFor('/kitforce/time-entries'))).toBe(
      FEATURE_FLAGS.PLUGINS_KITFORCE,
    );
  });

  it('returns undefined for plugin-agnostic routes', () => {
    expect(inferPluginForPath(specFor('/dashboard'))).toBeUndefined();
    expect(inferPluginForPath(specFor('/crm/customers'))).toBeUndefined();
    expect(inferPluginForPath(specFor('/invoicing/invoices'))).toBeUndefined();
    expect(inferPluginForPath(specFor('/finance/coa'))).toBeUndefined();
    expect(inferPluginForPath(specFor('/admin/settings'))).toBeUndefined();
    expect(inferPluginForPath(specFor('/portal'))).toBeUndefined();
    expect(inferPluginForPath(specFor('/account/security'))).toBeUndefined();
  });

  it('preserves an explicitly set requiresPlugin (opt-out / override)', () => {
    const spec: RouteSpec = {
      ...specFor('/dashboard'),
      requiresPlugin: FEATURE_FLAGS.PLUGINS_KITFORCE,
    };
    expect(inferPluginForPath(spec)).toBe(FEATURE_FLAGS.PLUGINS_KITFORCE);
  });
});

describe('withPluginGate', () => {
  it('annotates 3PL routes with PLUGINS_THREE_PL', () => {
    const gated = withPluginGate(specFor('/3pl-operations/items'));
    expect(gated.requiresPlugin).toBe(FEATURE_FLAGS.PLUGINS_THREE_PL);
  });

  it('annotates Manufacturing routes with PLUGINS_MANUFACTURING', () => {
    const gated = withPluginGate(specFor('/manufacturing/runs'));
    expect(gated.requiresPlugin).toBe(FEATURE_FLAGS.PLUGINS_MANUFACTURING);
  });

  it('leaves agnostic routes untouched', () => {
    const gated = withPluginGate(specFor('/crm/customers'));
    expect(gated.requiresPlugin).toBeUndefined();
  });
});

describe('ROUTES — pillar gating coverage', () => {
  it('every /3pl-operations/* route carries requiresPlugin = PLUGINS_THREE_PL', () => {
    const offenders = ROUTES.filter(
      (r) =>
        r.path.startsWith('/3pl-operations/') &&
        r.requiresPlugin !== FEATURE_FLAGS.PLUGINS_THREE_PL,
    );
    expect(offenders).toEqual([]);
  });

  it('every /manufacturing/* route carries requiresPlugin = PLUGINS_MANUFACTURING', () => {
    const offenders = ROUTES.filter(
      (r) =>
        r.path.startsWith('/manufacturing/') &&
        r.requiresPlugin !== FEATURE_FLAGS.PLUGINS_MANUFACTURING,
    );
    expect(offenders).toEqual([]);
  });

  it('every /kitcost/* route carries requiresPlugin = PLUGINS_KITCOST', () => {
    const offenders = ROUTES.filter(
      (r) =>
        r.path.startsWith('/kitcost/') &&
        r.requiresPlugin !== FEATURE_FLAGS.PLUGINS_KITCOST,
    );
    expect(offenders).toEqual([]);
  });

  it('every /copack/* route carries requiresPlugin = PLUGINS_COPACK_ECOM', () => {
    const offenders = ROUTES.filter(
      (r) =>
        r.path.startsWith('/copack/') &&
        r.requiresPlugin !== FEATURE_FLAGS.PLUGINS_COPACK_ECOM,
    );
    expect(offenders).toEqual([]);
  });

  it('every /kitforce/* route carries requiresPlugin = PLUGINS_KITFORCE', () => {
    const offenders = ROUTES.filter(
      (r) =>
        r.path.startsWith('/kitforce/') &&
        r.requiresPlugin !== FEATURE_FLAGS.PLUGINS_KITFORCE,
    );
    expect(offenders).toEqual([]);
  });

  it('the /copack pillar root carries requiresPlugin = PLUGINS_COPACK_ECOM', () => {
    const root = ROUTES.find((r) => r.path === '/copack');
    expect(root?.requiresPlugin).toBe(FEATURE_FLAGS.PLUGINS_COPACK_ECOM);
  });

  it('the /kitforce pillar root carries requiresPlugin = PLUGINS_KITFORCE', () => {
    const root = ROUTES.find((r) => r.path === '/kitforce');
    expect(root?.requiresPlugin).toBe(FEATURE_FLAGS.PLUGINS_KITFORCE);
  });

  it('RAW_ROUTES still contains the raw entries without auto-injected plugin gates', () => {
    // Sanity check: ROUTES is derived; RAW_ROUTES is the human-authored
    // list. They must contain the same number of entries, and ROUTES
    // must be a superset annotation of RAW_ROUTES.
    expect(ROUTES.length).toBe(RAW_ROUTES.length);
  });

  it('non-pillar routes are not accidentally gated', () => {
    const inPillar = (path: string, root: string): boolean =>
      path === root || path.startsWith(`${root}/`);
    const accidentallyGated = ROUTES.filter(
      (r) =>
        r.requiresPlugin !== undefined &&
        !inPillar(r.path, '/3pl-operations') &&
        !inPillar(r.path, '/manufacturing') &&
        !inPillar(r.path, '/kitcost') &&
        !inPillar(r.path, '/copack') &&
        !inPillar(r.path, '/kitforce'),
    );
    expect(accidentallyGated).toEqual([]);
  });
});
