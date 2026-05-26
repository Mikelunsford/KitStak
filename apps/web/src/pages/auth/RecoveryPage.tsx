// /auth/recovery. Public landing page for the Supabase recovery token.
//
// F-Wave9-INVITE-PASSWORD-SETUP-01 (SPA half). When the operator clicks
// the link from a password-reset email, the URL hash carries a recovery
// token. The Supabase JS SDK parses that hash on mount because
// `detectSessionInUrl` defaults to true, which signs the user in via the
// recovery flow. The page then renders a password-set form: on submit the
// SDK swaps the recovery session for a real one and we route to the
// dashboard.
//
// We do NOT trust the token client-side. Validation is delegated to the
// SDK / Supabase Auth server; the page reads the session state from the
// SDK after mount and renders one of two views:
//   - happy path: a session is present with type=recovery (or any active
//     session, since the SDK already signed the user in). Render the
//     password-set form.
//   - fallback: no recovery token, no session. Render a friendly "link is
//     invalid or expired" message with a link back to /signin so the user
//     can request a fresh reset email.
//
// Route guard: 'public'. The page is unguarded; the recovery token IS the
// credential. After the SDK signs the user in, AuthContext picks up the
// session via onAuthStateChange and any subsequent navigation will hit the
// usual protected-route guard.

import { FormEvent, useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { Lock } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { Logo } from '@/components/ui/Logo';
import { TextInput } from '@/components/ui/TextInput';
import { supabase } from '@/lib/supabase';
import { validatePasswordPair } from '@/pages/account/passwordValidator';

type RecoveryState =
  | { status: 'loading' }
  | { status: 'ready' }
  | { status: 'no-token' }
  | { status: 'updating' }
  | { status: 'done' }
  | { status: 'error'; message: string };

export function RecoveryPage() {
  const [recovery, setRecovery] = useState<RecoveryState>({ status: 'loading' });
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');

  useEffect(() => {
    // The Supabase SDK auto-parses the URL hash on construction when
    // detectSessionInUrl is true (default). By the time this effect runs
    // either getSession returns a real session (recovery succeeded and the
    // user is now signed in) or null (the user navigated here directly with
    // no token, or the token was already consumed).
    let cancelled = false;
    void supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      if (data.session && data.session.user) {
        setRecovery({ status: 'ready' });
      } else {
        setRecovery({ status: 'no-token' });
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (recovery.status === 'done') {
    return <Navigate to="/dashboard" replace />;
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (validatePasswordPair({ password, confirm }) !== null) return;
    setRecovery({ status: 'updating' });
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setRecovery({ status: 'error', message: error.message });
      return;
    }
    setRecovery({ status: 'done' });
  }

  const validation = validatePasswordPair({ password, confirm });
  const canSubmit =
    validation === null &&
    (recovery.status === 'ready' || recovery.status === 'error');

  return (
    <main className="flex min-h-screen items-center justify-center bg-bg px-6">
      <div className="flex w-full max-w-md flex-col gap-10">
        <header className="flex justify-center">
          <Logo size="default" />
        </header>

        <section className="flex flex-col gap-6 border border-line bg-bg-2 p-10">
          <div className="flex flex-col gap-2">
            <h1 className="font-display text-4xl tracking-wide text-ink">
              SET A NEW PASSWORD
            </h1>
            <p className="font-sans text-ink-dim">Built to Ship.</p>
          </div>

          {recovery.status === 'loading' ? (
            <p
              className="font-sans text-sm text-ink-dim"
              data-testid="recovery-loading"
            >
              Loading.
            </p>
          ) : null}

          {recovery.status === 'no-token' ? (
            <div
              className="flex flex-col gap-3 border border-line bg-bg p-6"
              data-testid="recovery-no-token"
            >
              <p className="font-sans text-sm text-ink">
                This link is invalid or has expired.
              </p>
              <p className="font-sans text-xs text-ink-dim">
                Go to sign-in and use the &quot;Forgot password&quot; link to
                request a fresh reset email.
              </p>
              <Link
                to="/signin"
                className="self-start text-sm text-accent underline underline-offset-2"
              >
                Back to sign in
              </Link>
            </div>
          ) : null}

          {recovery.status === 'ready' ||
          recovery.status === 'updating' ||
          recovery.status === 'error' ? (
            <form
              onSubmit={onSubmit}
              className="flex flex-col gap-4"
              data-testid="recovery-form"
            >
              <div className="flex items-center gap-3">
                <Lock
                  size={20}
                  strokeWidth={2}
                  className="text-ink-dim"
                  aria-hidden="true"
                />
                <p className="font-sans text-sm text-ink-dim">
                  Choose a password you have not used elsewhere.
                </p>
              </div>

              <TextInput
                label="New password"
                type="password"
                name="new_password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                data-testid="recovery-new-password-input"
              />
              <TextInput
                label="Confirm new password"
                type="password"
                name="confirm_password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                minLength={8}
                data-testid="recovery-confirm-password-input"
              />

              {validation && (password.length > 0 || confirm.length > 0) ? (
                <p
                  role="alert"
                  className="font-sans text-sm text-ink-dim border-l-2 border-line pl-3 py-2"
                  data-testid="recovery-validation"
                >
                  {validation}
                </p>
              ) : null}

              <Button
                type="submit"
                disabled={!canSubmit}
                data-testid="recovery-submit"
              >
                {recovery.status === 'updating'
                  ? 'Setting password...'
                  : 'Set password'}
              </Button>

              {recovery.status === 'error' ? (
                <p
                  role="alert"
                  className="font-sans text-sm text-accent border-l-2 border-accent pl-3 py-2 bg-accent/5"
                  data-testid="recovery-error"
                >
                  {recovery.message}
                </p>
              ) : null}
            </form>
          ) : null}

          <p className="border-t border-line pt-5 text-sm text-ink-dim">
            Remembered your password?{' '}
            <Link
              to="/signin"
              className="text-accent underline underline-offset-2"
            >
              Back to sign in
            </Link>
          </p>
        </section>
      </div>
    </main>
  );
}
