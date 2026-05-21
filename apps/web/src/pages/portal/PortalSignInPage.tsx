// PortalSignInPage. Customer-portal re-entry surface.
//
// Path B2.5a: a returning customer who has lost their original invite email
// or whose session has expired can come here, type their email, and receive
// a fresh single-use magic link via the same Resend chassis that ships the
// invite emails. The backend endpoint POST /auth-api/portal/request-signin-link
// is anti-leak (always 200, identical envelope regardless of registration),
// so the UI assumes success on any non-network response and shows the same
// confirmation message in every case.

import { FormEvent, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { z } from 'zod';

import { Logo } from '@/components/ui/Logo';
import { Button } from '@/components/ui/Button';
import { TextInput } from '@/components/ui/TextInput';
import { useAuth } from '@/auth/AuthContext';
import { requestPortalSignInLink } from '@/lib/services/portalAuthService';

const EmailSchema = z.object({
  email: z.string().email('Enter a valid email address'),
});

export function PortalSignInPage() {
  const { state } = useAuth();
  const [email, setEmail] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [networkError, setNetworkError] = useState<string | null>(null);

  if (state.status === 'authenticated') {
    return <Navigate to="/portal" replace />;
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFieldError(null);
    setNetworkError(null);
    const parsed = EmailSchema.safeParse({ email });
    if (!parsed.success) {
      setFieldError(parsed.error.issues[0]?.message ?? 'Invalid email');
      return;
    }
    setSubmitting(true);
    try {
      await requestPortalSignInLink(parsed.data.email);
      setSubmitted(true);
    } catch (err) {
      setNetworkError(
        err instanceof Error ? err.message : 'Network error. Try again.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-bg px-6">
      <div className="flex w-full max-w-md flex-col gap-10">
        <header className="flex justify-center">
          <Logo size="default" />
        </header>

        <section className="flex flex-col gap-6 border border-line bg-bg-2 p-10">
          <div className="flex flex-col gap-2">
            <h1 className="font-display text-4xl tracking-wide text-ink">
              CUSTOMER PORTAL
            </h1>
            <p className="font-sans text-ink-dim">
              Enter your email. We will send you a sign-in link.
            </p>
          </div>

          {submitted ? (
            <div className="flex flex-col gap-3 border border-line bg-bg p-6">
              <p className="font-sans text-sm text-ink">
                If <span className="font-mono">{email}</span> is registered for
                a Kitstak customer portal, a sign-in link is on its way.
              </p>
              <p className="font-sans text-xs text-ink-dim">
                Check your inbox. The link expires after one hour and works
                only once. You can request a fresh link any time.
              </p>
              <button
                type="button"
                onClick={() => {
                  setSubmitted(false);
                  setEmail('');
                }}
                className="self-start text-sm text-accent underline"
              >
                Send another link
              </button>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="flex flex-col gap-5">
              <TextInput
                label="Email"
                type="email"
                name="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                {...(fieldError ? { error: fieldError } : {})}
              />
              {networkError ? (
                <p role="alert" className="font-sans text-sm text-accent">
                  {networkError}
                </p>
              ) : null}
              <Button type="submit" disabled={submitting} className="mt-2">
                {submitting ? 'Sending link...' : 'Send sign-in link'}
              </Button>
            </form>
          )}

          <p className="border-t border-line pt-5 text-sm text-ink-dim">
            Kitstak team member?{' '}
            <Link
              to="/signin"
              className="text-accent underline underline-offset-2"
            >
              Staff sign-in
            </Link>
          </p>
        </section>
      </div>
    </main>
  );
}
