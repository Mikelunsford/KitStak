import { Suspense, type ReactElement } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';

import { ROUTES, type RouteSpec } from './routes';
import { ProtectedRoute } from './auth/ProtectedRoute';
import { AdminProtectedRoute } from './auth/AdminProtectedRoute';
import { PortalRoute } from './auth/PortalRoute';
import { BrandingProvider } from './whitelabel/BrandingProvider';
import { NotFoundPage } from './pages/NotFoundPage';

/**
 * App. consumes the flat ROUTES table and wraps each route in the
 * declared guard. BrandingProvider wraps the entire authenticated tree so
 * CSS-variable token writes apply consistently.
 *
 * The router lives in main.tsx; this file produces the route element
 * tree. We map RouteSpec.guard -> guard component at the leaf, not via
 * nested JSX <Route> structure, so the flat table remains the source of
 * truth.
 */

function wrapWithGuard(spec: RouteSpec): ReactElement {
  const ElementCmp = spec.element;
  const leaf = <ElementCmp />;
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
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </Suspense>
    </BrandingProvider>
  );
}
