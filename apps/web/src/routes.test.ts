// F-Wave9-COWORK-SMOKE-06 regression suite.
//
// Locks in the SPA mirror of the Edge bundle-level plugin gate. The
// ROUTES export must carry `requiresPlugin` for every non-redirect
// /3pl-operations/*, /manufacturing/*, /kitcost/*, and /copack/* route so
// RequirePlugin renders the NotFoundPage when the pillar plugin flag is off.
//
// Spine plus add-ons re-route: spine and shared-block surfaces moved to
// neutral ungated roots (/quotes, /projects, /purchasing/*, /catalog/*,
// /inventory/*, /settings/*). Redirect entries (isRedirect) sit at the old
// /3pl-operations paths and are never gated, so they are excluded here.

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
  it('returns PLUGINS_THREE_PL for the /3pl-operations add-on routes', () => {
    // After the spine re-route, only the true 3PL add-on surfaces stay
    // under /3pl-operations: receiving and shipments. The prefix rule
    // still gates anything beneath the namespace.
    expect(inferPluginForPath(specFor('/3pl-operations/receiving'))).toBe(
      FEATURE_FLAGS.PLUGINS_THREE_PL,
    );
    expect(inferPluginForPath(specFor('/3pl-operations/shipments/abc'))).toBe(
      FEATURE_FLAGS.PLUGINS_THREE_PL,
    );
    expect(inferPluginForPath(specFor('/3pl-operations/receiving/new'))).toBe(
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

  it('returns undefined for the new ungated spine roots (re-route targets)', () => {
    expect(inferPluginForPath(specFor('/quotes'))).toBeUndefined();
    expect(inferPluginForPath(specFor('/quotes/abc/send'))).toBeUndefined();
    expect(inferPluginForPath(specFor('/projects'))).toBeUndefined();
    expect(inferPluginForPath(specFor('/purchasing/vendors'))).toBeUndefined();
    expect(
      inferPluginForPath(specFor('/purchasing/purchase-orders')),
    ).toBeUndefined();
    expect(inferPluginForPath(specFor('/catalog/items'))).toBeUndefined();
    expect(inferPluginForPath(specFor('/catalog/boms'))).toBeUndefined();
    expect(
      inferPluginForPath(specFor('/inventory/warehouses')),
    ).toBeUndefined();
    expect(
      inferPluginForPath(specFor('/inventory/stock/levels')),
    ).toBeUndefined();
    expect(
      inferPluginForPath(specFor('/settings/sales-config/taxes')),
    ).toBeUndefined();
  });

  it('preserves an explicitly set requiresPlugin (opt-out / override)', () => {
    const spec: RouteSpec = {
      ...specFor('/dashboard'),
      requiresPlugin: FEATURE_FLAGS.PLUGINS_KITFORCE,
    };
    expect(inferPluginForPath(spec)).toBe(FEATURE_FLAGS.PLUGINS_KITFORCE);
  });

  it('returns undefined for a redirect entry even under a gated prefix', () => {
    const spec: RouteSpec = {
      ...specFor('/3pl-operations/quotes'),
      isRedirect: true,
    };
    expect(inferPluginForPath(spec)).toBeUndefined();
  });

  it('treats isRedirect as a higher-priority opt-out than requiresPlugin', () => {
    const spec: RouteSpec = {
      ...specFor('/3pl-operations/quotes'),
      requiresPlugin: FEATURE_FLAGS.PLUGINS_THREE_PL,
      isRedirect: true,
    };
    expect(inferPluginForPath(spec)).toBeUndefined();
  });
});

describe('withPluginGate', () => {
  it('annotates 3PL add-on routes with PLUGINS_THREE_PL', () => {
    const gated = withPluginGate(specFor('/3pl-operations/receiving'));
    expect(gated.requiresPlugin).toBe(FEATURE_FLAGS.PLUGINS_THREE_PL);
  });

  it('leaves a redirect entry ungated even under the /3pl-operations prefix', () => {
    const gated = withPluginGate({
      ...specFor('/3pl-operations/quotes'),
      isRedirect: true,
    });
    expect(gated.requiresPlugin).toBeUndefined();
  });

  it('annotates Manufacturing routes with PLUGINS_MANUFACTURING', () => {
    const gated = withPluginGate(specFor('/manufacturing/runs'));
    expect(gated.requiresPlugin).toBe(FEATURE_FLAGS.PLUGINS_MANUFACTURING);
  });

  it('annotates WMS routes with PLUGINS_WMS', () => {
    const gated = withPluginGate(specFor('/wms'));
    expect(gated.requiresPlugin).toBe(FEATURE_FLAGS.PLUGINS_WMS);
  });

  it('leaves agnostic routes untouched', () => {
    const gated = withPluginGate(specFor('/crm/customers'));
    expect(gated.requiresPlugin).toBeUndefined();
  });
});

describe('ROUTES — pillar gating coverage', () => {
  it('every non-redirect /3pl-operations/* route carries requiresPlugin = PLUGINS_THREE_PL', () => {
    const offenders = ROUTES.filter(
      (r) =>
        r.path.startsWith('/3pl-operations/') &&
        !r.isRedirect &&
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

  it('the /wms pillar root carries requiresPlugin = PLUGINS_WMS', () => {
    const root = ROUTES.find((r) => r.path === '/wms');
    expect(root?.requiresPlugin).toBe(FEATURE_FLAGS.PLUGINS_WMS);
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

  // R-W13-AUTH-01: the /admin/sso SSO management route is admin-guarded and
  // must never be plugin-gated (it is org config, not a pillar add-on).
  it('registers /admin/sso as an admin-guarded, ungated route', () => {
    const sso = ROUTES.find((r) => r.path === '/admin/sso');
    expect(sso).toBeDefined();
    expect(sso?.guard).toBe('admin');
    expect(sso?.requiresPlugin).toBeUndefined();
    expect(inferPluginForPath(specFor('/admin/sso'))).toBeUndefined();
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
        !inPillar(r.path, '/kitforce') &&
        !inPillar(r.path, '/wms'),
    );
    expect(accidentallyGated).toEqual([]);
  });
});
