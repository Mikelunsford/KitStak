import { Link, useSearchParams } from 'react-router-dom';

import { Logo } from '@/components/ui/Logo';
import { Button } from '@/components/ui/Button';

/**
 * FeatureUnavailablePage. destination for per-route flag-off redirects.
 *
 * Per 00-canon/01-architecture.md: when the BE returns `403
 * FEATURE_DISABLED { flag }`, the SPA routes callers here with the flag
 * name in the query string so the message can be specific.
 *
 * Copy is direct: no em dashes, no double hyphens, no emojis. Either
 * include the flag name or fall back to a generic line.
 */
export function FeatureUnavailablePage() {
  const [search] = useSearchParams();
  const flag = search.get('flag');

  return (
    <main className="min-h-screen flex items-center justify-center bg-bg px-6">
      <div className="w-full max-w-md flex flex-col gap-8">
        <header className="flex justify-center">
          <Logo size="default" />
        </header>

        <section className="bg-bg-2 border border-line p-10 flex flex-col gap-6">
          <h1 className="text-4xl font-display tracking-wide text-ink">
            FEATURE UNAVAILABLE
          </h1>
          <p className="font-sans text-ink-dim">
            {flag
              ? `This feature is not enabled on your workspace. Reference flag: ${flag}.`
              : 'This feature is not enabled on your workspace.'}
          </p>
          <p className="font-sans text-sm text-ink-dim">
            Contact your workspace owner or your Kitstak operator to enable it.
          </p>
          <Link to="/dashboard" className="inline-block">
            <Button>Back to dashboard</Button>
          </Link>
        </section>
      </div>
    </main>
  );
}
