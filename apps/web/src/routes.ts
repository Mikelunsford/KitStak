import { lazy, type LazyExoticComponent, type ComponentType } from 'react';

/**
 * Flat ROUTES table. Per 00-canon/01-architecture.md "Routing". react-router-dom
 * v6 with a flat ROUTES table and lazy code splits. No nested JSX <Route> trees.
 *
 * `guard` decides which auth wrapper wraps the element at render time. `layout`
 * is informational; ProtectedRoute / AdminProtectedRoute wrap in <AppShell>
 * themselves, public/portal routes render bare.
 */

export type RouteGuard = 'protected' | 'admin' | 'portal' | 'public';
export type RouteLayout = 'shell' | 'auth' | 'unauthenticated';

export interface RouteSpec {
  path: string;
  element: LazyExoticComponent<ComponentType<unknown>>;
  guard: RouteGuard;
  layout: RouteLayout;
}

// Lazy code splits. keep imports inside the lazy() callback so each route
// pulls its own chunk. Pages export named components; lazy() needs a default,
// so we adapt at the dynamic-import boundary.
const SignInPage = lazy(() =>
  import('./pages/SignInPage').then((m) => ({ default: m.SignInPage })),
);
const DashboardPage = lazy(() =>
  import('./pages/DashboardPage').then((m) => ({ default: m.DashboardPage })),
);
const FeatureUnavailablePage = lazy(() =>
  import('./pages/FeatureUnavailablePage').then((m) => ({
    default: m.FeatureUnavailablePage,
  })),
);
const NotFoundPage = lazy(() =>
  import('./pages/NotFoundPage').then((m) => ({ default: m.NotFoundPage })),
);

export const ROUTES: ReadonlyArray<RouteSpec> = [
  {
    path: '/signin',
    element: SignInPage,
    guard: 'public',
    layout: 'unauthenticated',
  },
  {
    path: '/dashboard',
    element: DashboardPage,
    guard: 'protected',
    layout: 'shell',
  },
  {
    path: '/feature-unavailable',
    element: FeatureUnavailablePage,
    guard: 'public',
    layout: 'unauthenticated',
  },
  {
    path: '/404',
    element: NotFoundPage,
    guard: 'public',
    layout: 'unauthenticated',
  },
] as const;
