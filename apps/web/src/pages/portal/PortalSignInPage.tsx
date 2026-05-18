// PortalSignInPage. Customer-portal sign-in. Wave 2 ships the page; the
// real auth handshake is driven by SignInPage / AuthContext.

import { Logo } from '@/components/ui/Logo';

export function PortalSignInPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-bg px-4">
      <section className="w-full max-w-md border border-line bg-bg-2 p-8">
        <header className="mb-6 flex flex-col items-center gap-2">
          <Logo size="default" />
          <h1 className="font-display text-2xl tracking-wide text-ink">
            CUSTOMER PORTAL
          </h1>
          <p className="text-sm text-ink-dim">
            Sign in to review your invoices, quotes, and projects.
          </p>
        </header>
        <p className="text-center text-sm text-ink-dim">
          Portal sign-in flow is delivered by the shared sign-in surface. If
          you reached this page in error, return to your invitation email.
        </p>
      </section>
    </main>
  );
}
