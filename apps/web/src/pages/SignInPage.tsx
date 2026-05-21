import { FormEvent, useState } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { z } from 'zod';

import { Logo } from '@/components/ui/Logo';
import { Button } from '@/components/ui/Button';
import { TextInput } from '@/components/ui/TextInput';
import { useAuth } from '@/auth/AuthContext';

const SignInSchema = z.object({
  email: z.string().email('Enter a valid email'),
  password: z.string().min(8, 'Minimum 8 characters'),
});

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
