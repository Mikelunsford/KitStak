// /account/security. Account-security surface for the signed-in user.
//
// F-Wave9-INVITE-PASSWORD-SETUP-01 (SPA half). A teammate who joined via
// magic link has no password yet; signing out would lock them out because
// /signin requires a password. This page lets any signed-in user set or
// change their password via the Supabase JS SDK. The SDK enforces the
// minimum-length rule server-side; we also gate the submit button on an
// eight-character minimum and a confirmation match so the user gets
// immediate feedback before round-tripping.
//
// F-Wave9-INVITE-PASSWORD-PROMPT-01: when navigated here with
// `?welcome=1` (DashboardPage redirects first-time invitees there on
// mount) we render a welcome banner above the password form and a
// "Skip for now" secondary action under it. Both branches (skip and
// successful password set) call markPasswordPromptSeen so the dashboard
// stops redirecting on subsequent visits.
//
// Visible to any authenticated user (route guard: 'protected'). No cap
// check: every user has the right to manage their own password.

import { FormEvent, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Lock } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { TextInput } from '@/components/ui/TextInput';
import { supabase } from '@/lib/supabase';
import { useMe } from '@/lib/hooks/useMe';
import { markPasswordPromptSeen } from '@/pages/firstSigninPromptState';
import { FirstSigninWelcomeBanner } from './FirstSigninWelcomeBanner';
import {
  MIN_PASSWORD_LENGTH,
  validatePasswordPair,
} from './passwordValidator';

type SubmitState =
  | { status: 'idle' }
  | { status: 'pending' }
  | { status: 'success' }
  | { status: 'error'; message: string };

export function SecurityPage() {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submit, setSubmit] = useState<SubmitState>({ status: 'idle' });
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const me = useMe({ enabled: true });

  const isWelcome = searchParams.get('welcome') === '1';
  const userId = me.data?.user_id ?? '';

  const validation = validatePasswordPair({ password, confirm });
  const canSubmit = validation === null && submit.status !== 'pending';

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;

    setSubmit({ status: 'pending' });
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setSubmit({ status: 'error', message: error.message });
      return;
    }
    setPassword('');
    setConfirm('');
    setSubmit({ status: 'success' });
    // Mark the welcome prompt as seen on every successful password set,
    // not only when the user arrived via ?welcome=1. A user who comes
    // here directly to change their password has clearly engaged with
    // the surface and should not see the welcome redirect later.
    if (userId) {
      markPasswordPromptSeen(userId);
    }
  }

  function onSkip() {
    if (userId) {
      markPasswordPromptSeen(userId);
    }
    navigate('/dashboard');
  }

  return (
    <section className="px-8 py-10 max-w-2xl mx-auto flex flex-col gap-10">
      <header className="flex flex-col gap-2">
        <h1 className="text-4xl font-display tracking-wide text-ink">
          ACCOUNT SECURITY
        </h1>
        <p className="font-sans text-sm text-ink-dim max-w-xl">
          Set or change the password used to sign in. If you joined via a
          magic-link invite, set a password here so you can sign in directly
          next time.
        </p>
      </header>

      {isWelcome ? <FirstSigninWelcomeBanner onSkip={onSkip} /> : null}

      <section
        className="border border-line bg-bg-2 p-5 flex flex-col gap-4"
        data-testid="set-password-section"
      >
        <header className="flex items-center gap-3">
          <Lock
            size={24}
            strokeWidth={2}
            className="text-ink-dim"
            aria-hidden="true"
          />
          <h2 className="font-display text-2xl tracking-wide text-ink">
            SET PASSWORD
          </h2>
        </header>

        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <TextInput
            label="New password"
            type="password"
            name="new_password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={MIN_PASSWORD_LENGTH}
            data-testid="new-password-input"
          />
          <TextInput
            label="Confirm new password"
            type="password"
            name="confirm_password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
            minLength={MIN_PASSWORD_LENGTH}
            data-testid="confirm-password-input"
          />

          <p className="font-sans text-xs text-ink-faint">
            Minimum {MIN_PASSWORD_LENGTH} characters. Use something you have
            not used elsewhere.
          </p>

          {validation && (password.length > 0 || confirm.length > 0) ? (
            <p
              role="alert"
              className="font-sans text-sm text-ink-dim border-l-2 border-line pl-3 py-2"
              data-testid="set-password-validation"
            >
              {validation}
            </p>
          ) : null}

          <div className="flex items-center gap-3">
            <Button
              type="submit"
              disabled={!canSubmit}
              data-testid="set-password-button"
            >
              {submit.status === 'pending'
                ? 'Updating...'
                : 'Update password'}
            </Button>
          </div>

          {submit.status === 'success' ? (
            <p
              role="status"
              className="font-sans text-sm text-success border-l-2 border-success pl-3 py-2 bg-success/5"
              data-testid="set-password-success"
            >
              Password updated. You can now sign in with your new password.
            </p>
          ) : null}

          {submit.status === 'error' ? (
            <p
              role="alert"
              className="font-sans text-sm text-accent border-l-2 border-accent pl-3 py-2 bg-accent/5"
              data-testid="set-password-error"
            >
              {submit.message}
            </p>
          ) : null}
        </form>
      </section>
    </section>
  );
}
