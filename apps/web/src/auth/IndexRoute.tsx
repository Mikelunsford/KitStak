import { Navigate } from 'react-router-dom';

import { useMe } from '@/lib/hooks/useMe';
import { useAuth } from './AuthContext';

/**
 * Auth-aware redirect for the "/" path.
 *
 * Defense-in-depth for Path B2 MAGICLINK-01: the magic-link redirectTo
 * already points at /portal directly, but if a customer_user ever lands
 * at the bare root (typed URL, bookmarked, browser auto-fill) we bounce
 * them to /portal instead of /dashboard (which would itself bounce to
 * /signin via ProtectedRoute and confuse the customer).
 */
export function IndexRoute() {
  const { state } = useAuth();
  const me = useMe({ enabled: state.status === 'authenticated' });

  if (state.status === 'loading') {
    return (
      <div className="flex h-screen items-center justify-center text-ink-dim">
        Checking session.
      </div>
    );
  }

  if (state.status === 'unauthenticated') {
    return <Navigate to="/signin" replace />;
  }

  if (me.isLoading) {
    return (
      <div className="flex h-screen items-center justify-center text-ink-dim">
        Loading workspace.
      </div>
    );
  }

  const role = me.data?.active_role ?? null;
  if (role === 'customer_user') {
    return <Navigate to="/portal" replace />;
  }

  return <Navigate to="/dashboard" replace />;
}
