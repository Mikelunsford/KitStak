import { Suspense, type ReactElement } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';

import { ROUTES, type RouteSpec } from './routes';
import { ProtectedRoute } from './auth/ProtectedRoute';
import { AdminProtectedRoute } from './auth/AdminProtectedRoute';
import { PortalRoute } from './auth/PortalRoute';
import { IndexRoute } from './auth/IndexRoute';
import { RequirePlugin } from './auth/RequirePlugin';
import { BrandingProvider } from './whitelabel/BrandingProvider';

/**
 * App. consumes the flat ROUTES table and wraps each route in the
 * declared guard. BrandingProvider wraps the entire authenticated tree so
 * CSS-variable token writes apply consistently.
 *
 * The router lives in main.tsx; this file produces the route element
 * tree. We map RouteSpec.guard -> guard component at the leaf, not via
 * nested JSX <Route> structure, so the flat table remains the source of
 * truth.
 *
 * Plugin gating order: RequirePlugin sits BETWEEN the auth guard and the
 * route element. The auth guard runs first so an unauthenticated caller
 * is redirected to /signin before any org_feature_flags fetch fires; the
 * plugin gate runs second so an authenticated caller without the pillar
 * plugin sees NotFoundPage. The order matches the Edge dispatcher in
 * supabase/functions/_shared/bundleGate.ts which also runs the auth
 * resolve before reading the flag.
 */

function wrapWithGuard(spec: RouteSpec): ReactElement {
  const ElementCmp = spec.element;
  const leaf = spec.requiresPlugin ? (
    <RequirePlugin flag={spec.requiresPlugin}>
      <ElementCmp />
    </RequirePlugin>
  ) : (
    <ElementCmp />
  );
  switch (spec.guard) {
    case 'protected':
      return <ProtectedRoute>{leaf}</ProtectedRoute>;
    case 'admin':
      return <AdminProtectedRoute>{leaf}</AdminProtectedRoute>;
    case 'portal':
      return <PortalRoute>{leaf}</PortalRoute>;
    case 'public':
      return leaf;
  }
}

export function App() {
  return (
    <BrandingProvider>
      <Suspense
        fallback={
          <div className="flex h-screen items-center justify-center bg-bg text-ink-dim">
            Loading.
          </div>
        }
      >
        <Routes>
          {ROUTES.map((spec) => (
            <Route
              key={spec.path}
              path={spec.path}
              element={wrapWithGuard(spec)}
            />
          ))}
          <Route path="/" element={<IndexRoute />} />
          <Route path="*" element={<Navigate to="/404" replace />} />
        </Routes>
      </Suspense>
    </BrandingProvider>
  );
}
