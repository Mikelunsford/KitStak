import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';

import { useMe } from '@/lib/hooks/useMe';
import { NoActiveOrgPage } from '@/pages/NoActiveOrgPage';
import { hasActiveOrgClaim } from './activeOrgClaim';
import { useAuth } from './AuthContext';

/**
 * Route guard for the customer_user portal surface. Bounces non-portal
 * users (any role other than customer_user) to /portal/signin.
 *
 * Wave 1 stub: customer portal shell ships later. For now this guard
 * renders children inline once role check passes, so the portal can be
 * iterated alongside the shell rebuild in Wave 2.
 */
export function PortalRoute({ children }: { children: ReactNode }) {
  const { state } = useAuth();
  const me = useMe({ enabled: state.status === 'authenticated' });
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
      <Navigate
        to="/portal/signin"
        replace
        state={{ from: location.pathname }}
      />
    );
  }

  // A customer_user whose JWT carries no kitstak_org_id claim would otherwise
  // fall through to the portal and fire org-scoped calls that 401 NO_ACTIVE_ORG,
  // rendering an empty shell (the same symptom the staff ProtectedRoute fixed
  // for F-Wave9-COWORK-SMOKE-03). Render the no-org surface INLINE rather than
  // redirecting: the portal sign-in bounces any authenticated session back to
  // /portal, so a redirect here would infinite-loop. The claim check is
  // synchronous, so this renders before useMe runs.
  if (!hasActiveOrgClaim(state.user)) {
    return <NoActiveOrgPage />;
  }

  if (me.isLoading) {
    return (
      <div className="flex h-screen items-center justify-center text-ink-dim">
        Loading workspace.
      </div>
    );
  }

  const role = me.data?.active_role ?? null;
  if (role !== 'customer_user') {
    return <Navigate to="/portal/signin" replace />;
  }

  return <>{children}</>;
}
