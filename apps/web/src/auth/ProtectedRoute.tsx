import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';

import { AppShell } from '@/components/shell/AppShell';
import { useAuth } from './AuthContext';

/**
 * Route guard for any authenticated staff route. Unauthenticated users get
 * redirected to /signin with the originating pathname preserved in
 * location.state so the SignInPage can route them back after login.
 *
 * Wave 1 wraps children in <AppShell>. Wave 2 will add wrong-org and
 * wrong-role redirects driven by useMe(); for now any authenticated caller
 * lands inside the shell.
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

  return <AppShell>{children}</AppShell>;
}
