import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useBrandingContext } from '@/whitelabel/BrandingProvider';
import { useOrgFlags } from '@/lib/hooks/useOrgFlags';
import { useDashboardSummary } from '@/lib/hooks/useCrossCutting';
import { useMe } from '@/lib/hooks/useMe';
import { WorkCard } from '@/components/shell/WorkCard';
import { SetupChecklist } from '@/components/shell/SetupChecklist';
import { SetupCompleteCelebration } from '@/components/shell/SetupCompleteCelebration';
import { FEATURE_FLAGS } from '@/lib/constants';
import {
  PILLAR_TILES,
  visiblePillarTiles,
  type PillarTileSpec,
} from './dashboardTiles';
import { buildWorkCards } from '@/pages/dashboardWorkCards';
import {
  buildSetupSteps,
  countCompletedSetupSteps,
  isSetupComplete,
} from '@/pages/dashboardChecklistSteps';
import { hasSetupCelebrationBeenShown } from '@/pages/setupCelebrationState';
import { hasSeenPasswordPrompt } from '@/pages/firstSigninPromptState';

/**
 * DashboardPage. landing for authenticated staff sessions.
 *
 * UX-Q5 + Setup Checklist (2026-05-25): the top surface discriminates on
 * setup completeness. While any of the seven canonical setup steps is
 * incomplete the dashboard renders the SetupChecklist (a guided 7-step
 * progress surface with deep-link CTAs per row). Once every step is
 * complete the work-card grid takes over with live actionable counts per
 * workflow stage.
 *
 * UX-Q3: the five-pillar surface remains below as the branded
 * "what each pillar does" surface, gated by `plugins.<pillar>` flags so
 * unbuilt pillars (Co-Pack and KitForce) are omitted entirely when their
 * flags are off. Pillars that are merely off pending an operator flip
 * (3PL, Manufacturing, KitCost) remain visible.
 *
 * Wraps in <AppShell> via the ProtectedRoute guard, not directly here.
 */
export function DashboardPage() {
  const branding = useBrandingContext();
  const orgFlags = useOrgFlags();
  const appName = branding.branding?.app_name_override ?? 'Kitstak';
  const dashboard = useDashboardSummary();
  const me = useMe({ enabled: true });
  const navigate = useNavigate();

  const tiles = visiblePillarTiles(PILLAR_TILES, orgFlags.data);
  const activeOrgId = me.data?.active_org_id ?? '';
  const userId = me.data?.user_id ?? '';

  // F-Wave9-INVITE-PASSWORD-PROMPT-01: nudge invitees who arrived via the
  // magic link to set a password on their first dashboard mount. We
  // strictly gate on `me.data` being resolved (not isLoading, payload
  // present) so the effect never fires with an empty userId; otherwise
  // hasSeenPasswordPrompt('') always returns false and the redirect would
  // re-fire forever. `replace: true` removes /dashboard from history so
  // the back button does not bounce the operator out of the welcome
  // flow. Once the prompt is marked seen (either via "Skip for now" on
  // SecurityPage or by successfully setting a password), this effect
  // no-ops on every subsequent visit.
  useEffect(() => {
    if (me.isLoading) return;
    if (!userId) return;
    if (hasSeenPasswordPrompt(userId)) return;
    navigate('/account/security?welcome=1', { replace: true });
  }, [me.isLoading, userId, navigate]);

  // Celebration banner gating. The banner appears once, the first time the
  // operator sees the work-card grid for a given org. The `dismissed`
  // state lets the banner unmount immediately on click without waiting for
  // a re-render cycle to observe the localStorage write.
  const setupDone =
    dashboard.data !== undefined && isSetupComplete(dashboard.data);
  const [dismissed, setDismissed] = useState(false);
  const showCelebration =
    setupDone &&
    Boolean(activeOrgId) &&
    !dismissed &&
    !hasSetupCelebrationBeenShown(activeOrgId);

  return (
    <section className="px-8 py-12 max-w-6xl mx-auto flex flex-col gap-12">
      <header className="flex flex-col gap-2">
        <h1 className="text-6xl font-display tracking-wide text-ink">
          BUILT TO SHIP.
        </h1>
        <p className="font-sans text-lg text-ink-dim max-w-2xl">
          Signed in to {appName}. Your work for the day is below.
        </p>
      </header>

      {showCelebration && (
        <SetupCompleteCelebration
          orgId={activeOrgId}
          onDismiss={() => setDismissed(true)}
        />
      )}

      <WorkCardGrid
        loading={dashboard.isLoading}
        summary={dashboard.data}
        errored={Boolean(dashboard.error)}
      />

      <section className="flex flex-col gap-4">
        <h2 className="font-display text-2xl tracking-wide text-ink-dim">
          PILLARS
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {tiles.map((tile) => (
            <Card key={tile.key} title={tile.title} body={tile.body} />
          ))}
        </div>
      </section>
    </section>
  );
}

// ---------------------------------------------------------------------------
// WorkCardGrid. Discriminates on loading, error, all-zero, and live counts.
// ---------------------------------------------------------------------------

interface WorkCardGridProps {
  loading: boolean;
  errored: boolean;
  summary:
    | ReturnType<typeof useDashboardSummary>['data']
    | undefined;
}

function WorkCardGrid({ loading, errored, summary }: WorkCardGridProps) {
  // Loading: four shimmering cards with deterministic deep links so the
  // surface is still navigable while the count resolves.
  if (loading || !summary) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <WorkCard
          loading
          count={0}
          label="Quotes awaiting approval"
          to="/3pl-operations/quotes?state=submitted"
        />
        <WorkCard
          loading
          count={0}
          label="Runs in production"
          to="/manufacturing/runs?status=started"
        />
        <WorkCard
          loading
          count={0}
          label="Shipments ready to ship"
          to="/3pl-operations/shipments?status=picking"
        />
        <WorkCard
          loading
          count={0}
          label="Unpaid invoices"
          to="/invoicing/invoices?status=sent"
        />
      </div>
    );
  }

  if (errored) {
    return (
      <p className="font-sans text-sm text-accent">
        Could not load your work for today. Refresh the page.
      </p>
    );
  }

  // Setup phase: any of the seven canonical setup steps still pending.
  // Render the guided checklist instead of the work cards so the operator
  // has a clear path forward instead of an empty board.
  if (!isSetupComplete(summary)) {
    return (
      <SetupChecklist
        steps={buildSetupSteps(summary)}
        completed={countCompletedSetupSteps(summary)}
      />
    );
  }

  // Live counts.
  const cards = buildWorkCards(summary);
  return (
    <div className="flex flex-col gap-4">
      <h2 className="font-display text-2xl tracking-wide text-ink-dim">
        TODAY
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map((card) => (
          <WorkCard
            key={card.key}
            count={card.count}
            label={card.label}
            to={card.to}
          />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Card. Branded "what each pillar does" tile. Used by the gated pillar grid
// (Q3) so unbuilt pillars are omitted entirely when their feature flag is
// off.
// ---------------------------------------------------------------------------

type CardProps = { title: string; body: string };

function Card({ title, body }: CardProps) {
  return (
    <article className="bg-bg-2 border border-line p-6 flex flex-col gap-3">
      <h3 className="text-xl font-display tracking-wider text-ink">{title}</h3>
      <p className="font-sans text-ink-dim text-sm">{body}</p>
    </article>
  );
}

// Re-exported so consumers (and tests) can verify the wired tile set
// without importing the page component itself.
export { PILLAR_TILES, visiblePillarTiles, FEATURE_FLAGS };
export type { PillarTileSpec };
