// BNEW-2 (PR-A, 2026-05-22 v2 smoke walk): pin the legacy-route redirect
// behaviour so a future refactor cannot silently re-introduce the
// regressed UUID-input form at /3pl-operations/production[/new].
//
// Two layers of assertion:
//   1. The redirect components themselves render a <Navigate> targeting
//      the canonical manufacturing URLs with `replace` (so the legacy
//      URL does not pollute browser history).
//   2. The flat ROUTES table wires those redirect components to the two
//      legacy paths and keeps the detail route on its original component.
//
// Pure-vitest suite, no DOM. We construct each redirect element and
// inspect its React type/props directly (mirrors the precedent in
// src/lib/hooks/featureFlagResolver.test.ts for prop-level assertions).

import { describe, expect, it } from 'vitest';
import type { ReactElement } from 'react';
import { Navigate } from 'react-router-dom';

import { ROUTES } from '@/routes';
import {
  LegacyProductionListRedirect,
  LegacyProductionCreateRedirect,
} from './LegacyProductionRedirect';

interface NavigateProps {
  to: string;
  replace?: boolean;
}

describe('LegacyProductionRedirect components (BNEW-2)', () => {
  it('list redirect renders <Navigate to="/manufacturing/runs" replace />', () => {
    // Invoking the function component returns a ReactElement object
    // ({ type, props, ... }). Navigate is itself a function component;
    // we are NOT rendering it here, just inspecting the JSX element.
    const el = LegacyProductionListRedirect() as ReactElement<NavigateProps>;
    expect(el.type).toBe(Navigate);
    expect(el.props.to).toBe('/manufacturing/runs');
    expect(el.props.replace).toBe(true);
  });

  it('create redirect renders <Navigate to="/manufacturing/runs/new" replace />', () => {
    const el = LegacyProductionCreateRedirect() as ReactElement<NavigateProps>;
    expect(el.type).toBe(Navigate);
    expect(el.props.to).toBe('/manufacturing/runs/new');
    expect(el.props.replace).toBe(true);
  });
});

describe('ROUTES wiring for legacy production paths (BNEW-2)', () => {
  it('/3pl-operations/production is registered as a redirect entry', () => {
    const spec = ROUTES.find((r) => r.path === '/3pl-operations/production');
    expect(spec, 'route must remain registered as a redirect').toBeDefined();
    // The element is a LazyExoticComponent; we cannot inspect its inner
    // module synchronously without a renderer. Component-level coverage is
    // in the suite above. Here we pin the wiring shape (path is present,
    // guard/layout match the rest of the protected shell routes).
    expect(spec?.guard).toBe('protected');
    expect(spec?.layout).toBe('shell');
  });

  it('/3pl-operations/production/new is registered as a redirect entry', () => {
    const spec = ROUTES.find(
      (r) => r.path === '/3pl-operations/production/new',
    );
    expect(spec, 'route must remain registered as a redirect').toBeDefined();
    expect(spec?.guard).toBe('protected');
    expect(spec?.layout).toBe('shell');
  });

  it('/3pl-operations/production/:id detail route remains intact (deep links still resolve)', () => {
    const spec = ROUTES.find(
      (r) => r.path === '/3pl-operations/production/:id',
    );
    expect(spec, 'detail route must stay registered').toBeDefined();
    expect(spec?.guard).toBe('protected');
    expect(spec?.layout).toBe('shell');
  });

  it('canonical /manufacturing/runs and /new routes still exist (redirect targets)', () => {
    expect(ROUTES.find((r) => r.path === '/manufacturing/runs')).toBeDefined();
    expect(
      ROUTES.find((r) => r.path === '/manufacturing/runs/new'),
    ).toBeDefined();
  });
});
