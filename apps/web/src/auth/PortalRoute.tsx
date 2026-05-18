import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';

import { useMe } from '@/lib/hooks/useMe';
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
