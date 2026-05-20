import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Session, User } from '@supabase/supabase-js';

import { identifyUser, resetAnalytics, track } from '@/lib/analytics';
import { supabase } from '@/lib/supabase';

/**
 * Canonical AuthContext for Kitstak.
 *
 * State is a discriminated union per 00-canon/01-architecture.md "State
 * management" and CLAUDE.md non-negotiables.
 *
 *   loading       . initial mount, session token is being recovered from storage
 *   authenticated . we have a Session AND a User
 *   unauthenticated. no Session
 *
 * Wave 1 stops at JWT + session. Org claim, role, and capability gating
 * land in Wave 2 wiring against /auth-api/me.
 */

export type AuthState =
  | { status: 'loading' }
  | { status: 'authenticated'; user: User; session: Session }
  | { status: 'unauthenticated' };

interface AuthContextValue {
  state: AuthState;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });

  useEffect(() => {
    let mounted = true;

    void supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      if (data.session && data.session.user) {
        setState({
          status: 'authenticated',
          user: data.session.user,
          session: data.session,
        });
        // F-Wave5-CO-02: a recovered session on cold mount must
        // re-stitch the analytics distinct_id so events emitted from
        // page reloads land on the right person. Identify only; no
        // signed_in event here (that fires on the explicit auth call).
        identifyUser(data.session.user.id);
      } else {
        setState({ status: 'unauthenticated' });
      }
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;
      if (session && session.user) {
        setState({ status: 'authenticated', user: session.user, session });
      } else {
        setState({ status: 'unauthenticated' });
      }
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      state,
      async signIn(email, password) {
        const { data, error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        // F-Wave5-CO-02: stitch the analytics session to the opaque
        // Supabase user.id and emit the first funnel event. Never pass
        // email or any PII to identifyUser; the UUID is enough.
        if (!error && data.user) {
          identifyUser(data.user.id);
          track('signed_in', { method: 'password' });
        }
        return { error: error?.message ?? null };
      },
      async signOut() {
        await supabase.auth.signOut();
        // F-Wave5-CO-02: reset the anonymous-session token so the next
        // sign-in on this browser starts a fresh distinct_id.
        resetAnalytics();
      },
    }),
    [state],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside <AuthProvider>');
  }
  return ctx;
}

/**
 * Variant of useAuth that returns undefined instead of throwing when no
 * AuthProvider is in the tree. Use this in low-level hooks (e.g.
 * useCapabilities) that may be rendered by unit tests which don't set up
 * the auth provider.
 */
export function useAuthOptional(): AuthContextValue | undefined {
  return useContext(AuthContext);
}
