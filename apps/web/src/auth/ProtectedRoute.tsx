import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';

import { AppShell } from '@/components/shell/AppShell';
import { NoActiveOrgPage } from '@/pages/NoActiveOrgPage';
import { hasActiveOrgClaim } from './activeOrgClaim';
import { useAuth } from './AuthContext';

/**
 * Route guard for any authenticated staff route. Unauthenticated users get
 * redirected to /signin with the originating pathname preserved in
 * location.state so the SignInPage can route them back after login.
 *
 * F-Wave9-COWORK-SMOKE-03: authenticated callers whose JWT lacks the
 * `kitstak_org_id` claim render the NoActiveOrgPage surface instead of
 * falling through to the requested element. The Edge dispatcher in
 * supabase/functions/_shared/tenant.ts already throws
 * `401 NO_ACTIVE_ORG` for the same condition; this is the SPA-side
 * mirror so a fresh user never sees a silently empty dashboard. The
 * claim check is synchronous and reads `session.user.app_metadata`, so
 * no API round-trip fires before the hard error renders.
 */
export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { state } = useAuth();
  const location = useLocation();

  if (state.status === 'loading') {
    return (
      <div className="flex h-screen items-center justify-center text-ink-dim">
        Checking session.
      </div>
    );
  }

  if (state.status === 'unauthenticated') {
    return (
      <Navigate to="/signin" replace state={{ from: location.pathname }} />
    );
  }

  // F-Wave9-COWORK-SMOKE-03: hard-fail when the active-org claim is
  // missing instead of rendering the requested surface with empty data.
  if (!hasActiveOrgClaim(state.user)) {
    return <NoActiveOrgPage />;
  }

  return <AppShell>{children}</AppShell>;
}
