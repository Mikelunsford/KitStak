import { useBrandingContext } from '@/whitelabel/BrandingProvider';

/**
 * DashboardPage. landing for authenticated staff sessions.
 *
 * The five-pillar surface lives in Sidebar; this page is the post-login
 * resting state. Wave 1 ships an overview card grid; pillars 2 through 5
 * are gated, so the corresponding cards stay informational only until the
 * relevant `plugins.<pillar>` flag is enabled.
 *
 * Wraps in <AppShell> via the ProtectedRoute guard, not directly here.
 */
export function DashboardPage() {
  const branding = useBrandingContext();
  const appName = branding.branding?.app_name_override ?? 'Kitstak';

  return (
    <section className="px-8 py-12 max-w-5xl mx-auto flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-6xl font-display tracking-wide text-ink">
          BUILT TO SHIP.
        </h1>
        <p className="font-sans text-lg text-ink-dim max-w-2xl">
          Signed in to {appName}. The five pillars below light up as your
          workspace enables each one.
        </p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card
          title="3PL OPERATIONS"
          body="Receiving, kitting, production, shipments."
        />
        <Card
          title="MANUFACTURING"
          body="BOMs, runs, finished goods, output movements."
        />
        <Card
          title="CO-PACK AND ECOM"
          body="Channel intake, kit-to-order, packaging."
        />
        <Card title="KITFORCE" body="Labor, time, and crew assignment." />
        <Card title="KITCOST" body="Job costing rolled up by run and SKU." />
      </div>
    </section>
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
