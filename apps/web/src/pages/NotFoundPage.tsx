import { Link } from 'react-router-dom';

import { Logo } from '@/components/ui/Logo';
import { Button } from '@/components/ui/Button';

/**
 * NotFoundPage. destination for unmatched routes and for bundle-gate
 * 404s. Copy is direct, no em dashes or emojis.
 */
export function NotFoundPage() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-bg px-6">
      <div className="w-full max-w-md flex flex-col gap-8">
        <header className="flex justify-center">
          <Logo size="default" />
        </header>

        <section className="bg-bg-2 border border-line p-10 flex flex-col gap-6">
          <h1 className="text-5xl font-display tracking-wide text-ink">
            NOT FOUND
          </h1>
          <p className="font-sans text-ink-dim">
            That page does not exist on this workspace.
          </p>
          <Link to="/dashboard" className="inline-block">
            <Button>Back to dashboard</Button>
          </Link>
        </section>
      </div>
    </main>
  );
}
