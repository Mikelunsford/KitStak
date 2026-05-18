import { Logo } from '@/components/ui/Logo';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/lib/auth';
import { useBranding } from '@/lib/branding';

export function DashboardPage() {
  const { user, signOut } = useAuth();
  const { branding } = useBranding();
  const appName = branding.app_name_override ?? 'KITSTAK';

  return (
    <main className="min-h-screen bg-bg text-ink">
      <header className="border-b border-line px-8 py-6 flex items-center justify-between">
        <Logo size="compact" />
        <div className="flex items-center gap-6">
          <span className="font-sans text-sm text-ink-dim tracking-wide">
            Wave 1 · Identity
          </span>
          {user ? (
            <Button onClick={() => void signOut()}>Sign out</Button>
          ) : null}
        </div>
      </header>

      <section className="px-8 py-16 max-w-5xl mx-auto flex flex-col gap-8">
        <h1 className="text-6xl font-display tracking-wide text-ink">
          BUILT TO SHIP.
        </h1>
        <p className="font-sans text-lg text-ink-dim max-w-2xl">
          Signed in to {appName}. Identity, branding, and the first lit pillar arrive in the next wave.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-8">
          <Card title="3PL OPERATIONS" body="Receiving, kitting, production, shipments." />
          <Card title="MANUFACTURING" body="BOMs, runs, finished goods, output movements." />
          <Card title="CO-PACK AND ECOM" body="Channel intake, kit-to-order, packaging." />
        </div>
      </section>
    </main>
  );
}

type CardProps = { title: string; body: string };

function Card({ title, body }: CardProps) {
  return (
    <article className="bg-bg-2 border border-line p-6 flex flex-col gap-3">
      <h2 className="text-xl font-display tracking-wider text-ink">{title}</h2>
      <p className="font-sans text-ink-dim text-sm">{body}</p>
    </article>
  );
}
