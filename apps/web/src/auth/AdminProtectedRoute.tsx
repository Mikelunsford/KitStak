import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';

import { AppShell } from '@/components/shell/AppShell';
import { useMe } from '@/lib/hooks/useMe';
import { useAuth } from './AuthContext';

/**
 * Route guard for org-admin surfaces. Restricts to org_owner or org_admin.
 * Non-admins are bounced to /dashboard. Server endpoints re-check via
 * requireCap; this guard is purely a UI shortcut to hide the surface.
 *
 * Wave 1 stub: useMe() returns null while the auth-api/me endpoint is not
 * yet wired. We fail-closed during loading (no flash of admin chrome) and
 * fall through to /dashboard when role is missing. Wave 2 wires the real
 * fetch.
 */
export function AdminProtectedRoute({ children }: { children: ReactNode }) {
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
      <Navigate to="/signin" replace state={{ from: location.pathname }} />
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
  if (role !== 'org_owner' && role !== 'org_admin') {
    return <Navigate to="/dashboard" replace />;
  }

  return <AppShell>{children}</AppShell>;
}
