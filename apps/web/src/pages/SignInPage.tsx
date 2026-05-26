import { FormEvent, useState } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { z } from 'zod';

import { Logo } from '@/components/ui/Logo';
import { Button } from '@/components/ui/Button';
import { TextInput } from '@/components/ui/TextInput';
import { useAuth } from '@/auth/AuthContext';
import { requestPasswordReset } from '@/lib/services/authResetService';

const SignInSchema = z.object({
  email: z.string().email('Enter a valid email'),
  password: z.string().min(8, 'Minimum 8 characters'),
});

const ResetEmailSchema = z.object({
  email: z.string().email('Enter a valid email'),
});

// Anti-enumeration message rendered on both happy-path and network-error
// branches of the forgot-password form. The wire endpoint never reveals
// whether the email is registered; mirroring that posture in the UI keeps
// the SPA from being a side channel.
const RESET_CONFIRMATION =
  'If an account exists for that email, a reset link has been sent. ' +
  'Check your inbox in the next few minutes.';

export function SignInPage() {
  const { state, signIn } = useAuth();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ email?: string; password?: string }>(
    {},
  );
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (state.status === 'authenticated') {
    const from = (location.state as { from?: string } | null)?.from ?? '/dashboard';
    return <Navigate to={from} replace />;
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = SignInSchema.safeParse({ email, password });
    if (!parsed.success) {
      const fieldErrors: { email?: string; password?: string } = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if (field === 'email') fieldErrors.email = issue.message;
        if (field === 'password') fieldErrors.password = issue.message;
      }
      setErrors(fieldErrors);
      return;
    }
    setErrors({});
    setFormError(null);
    setSubmitting(true);
    const { error } = await signIn(parsed.data.email, parsed.data.password);
    setSubmitting(false);
    if (error) setFormError(error);
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-bg px-6">
      <div className="w-full max-w-md flex flex-col gap-10">
        <header className="flex justify-center">
          <Logo size="default" />
        </header>

        <section className="bg-bg-2 border border-line p-10 flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <h1 className="text-4xl font-display tracking-wide text-ink">
              SIGN IN
            </h1>
            <p className="font-sans text-ink-dim">Built to Ship.</p>
          </div>

          <form onSubmit={onSubmit} className="flex flex-col gap-5">
            <TextInput
              label="Email"
              type="email"
              name="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              {...(errors.email ? { error: errors.email } : {})}
            />
            <TextInput
              label="Password"
              type="password"
              name="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              {...(errors.password ? { error: errors.password } : {})}
            />
            {formError ? (
              <p role="alert" className="font-sans text-sm text-accent">
                {formError}
              </p>
            ) : null}
            <Button type="submit" disabled={submitting} className="mt-2">
              {submitting ? 'Signing in...' : 'Sign in'}
            </Button>
          </form>

          <ForgotPasswordPanel />

          <p className="border-t border-line pt-5 text-sm text-ink-dim">
            Customer accessing your portal?{' '}
            <Link
              to="/portal/signin"
              className="text-accent underline underline-offset-2"
            >
              Sign in to your portal
            </Link>
          </p>
        </section>
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// ForgotPasswordPanel.
//
// Toggle-revealed inline form below the sign-in form. Submitting POSTs to
// /auth-api/auth/request-password-reset and renders the same anti-leak
// confirmation message regardless of outcome (network error included).
// ---------------------------------------------------------------------------
function ForgotPasswordPanel() {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setEmailError(null);
    const parsed = ResetEmailSchema.safeParse({ email });
    if (!parsed.success) {
      setEmailError(parsed.error.issues[0]?.message ?? 'Invalid email');
      return;
    }
    setSubmitting(true);
    try {
      await requestPasswordReset({ email: parsed.data.email });
    } catch {
      // Anti-enumeration: a network or server error must NOT differentiate
      // from the success path. The user sees the same confirmation either
      // way. We deliberately swallow the error here; Sentry capture upstream
      // of fetch would surface a real outage to operators.
    } finally {
      setSubmitting(false);
      setSubmitted(true);
    }
  }

  if (submitted) {
    return (
      <div
        className="border-t border-line pt-5 flex flex-col gap-3"
        data-testid="forgot-password-confirmation"
      >
        <p className="font-sans text-sm text-ink">{RESET_CONFIRMATION}</p>
        <button
          type="button"
          onClick={() => {
            setSubmitted(false);
            setEmail('');
            setOpen(false);
          }}
          className="self-start text-xs text-accent underline underline-offset-2"
        >
          Done
        </button>
      </div>
    );
  }

  if (!open) {
    return (
      <div className="border-t border-line pt-5">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-sm text-accent underline underline-offset-2"
          data-testid="forgot-password-toggle"
        >
          Forgot password?
        </button>
      </div>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      className="border-t border-line pt-5 flex flex-col gap-3"
      data-testid="forgot-password-form"
    >
      <p className="font-sans text-sm text-ink-dim">
        Enter your email. We will send you a reset link.
      </p>
      <TextInput
        label="Email"
        type="email"
        name="reset_email"
        autoComplete="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        {...(emailError ? { error: emailError } : {})}
        data-testid="forgot-password-email"
      />
      <div className="flex items-center gap-3">
        <Button
          type="submit"
          disabled={submitting}
          data-testid="forgot-password-submit"
        >
          {submitting ? 'Sending...' : 'Send reset link'}
        </Button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setEmail('');
            setEmailError(null);
          }}
          className="text-xs text-ink-dim underline underline-offset-2"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
