import { useBrandingContext } from '@/whitelabel/BrandingProvider';
import { useOrgFlags } from '@/lib/hooks/useOrgFlags';
import { FEATURE_FLAGS } from '@/lib/constants';
import {
  PILLAR_TILES,
  visiblePillarTiles,
  type PillarTileSpec,
} from './dashboardTiles';

/**
 * DashboardPage. landing for authenticated staff sessions.
 *
 * The five-pillar surface lives in Sidebar; this page is the post-login
 * resting state. Wave 1 ships an overview card grid; pillars are gated
 * by `plugins.<pillar>` flags. Per UX-Q3, unbuilt pillars (Co-Pack and
 * KitForce) are omitted entirely from the tile grid when their flags
 * are off, so the first-impression surface no longer advertises routes
 * that return 404. Pillars that are merely off pending an operator
 * flip (3PL, Manufacturing, KitCost) remain visible.
 *
 * Wraps in <AppShell> via the ProtectedRoute guard, not directly here.
 */
export function DashboardPage() {
  const branding = useBrandingContext();
  const orgFlags = useOrgFlags();
  const appName = branding.branding?.app_name_override ?? 'Kitstak';

  const tiles = visiblePillarTiles(PILLAR_TILES, orgFlags.data);

  return (
    <section className="px-8 py-12 max-w-5xl mx-auto flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-6xl font-display tracking-wide text-ink">
          BUILT TO SHIP.
        </h1>
        <p className="font-sans text-lg text-ink-dim max-w-2xl">
          Signed in to {appName}. The pillars below light up as your
          workspace enables each one.
        </p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {tiles.map((tile) => (
          <Card key={tile.key} title={tile.title} body={tile.body} />
        ))}
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

// Re-exported so consumers (and tests) can verify the wired tile set
// without importing the page component itself.
export { PILLAR_TILES, visiblePillarTiles, FEATURE_FLAGS };
export type { PillarTileSpec };
