import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { useBrandingContext } from '@/whitelabel/BrandingProvider';
import { useOrgFlags } from '@/lib/hooks/useOrgFlags';
import { useDashboardSummary } from '@/lib/hooks/useCrossCutting';
import { useMe } from '@/lib/hooks/useMe';
import { useCapabilities } from '@/lib/hooks/useCapabilities';
import { WorkCard } from '@/components/shell/WorkCard';
import { SetupChecklist } from '@/components/shell/SetupChecklist';
import { SetupCompleteCelebration } from '@/components/shell/SetupCompleteCelebration';
import {
  SIDEBAR_MODES,
  isModeVisible,
  visibleRoutesForMode,
} from '@/components/shell/sidebarModes';
import type { Capability, RoleCode } from '@/lib/capabilities';
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
 * Below the work cards, the SectionLauncher replaces the old descriptive
 * PILLARS block with a role-aware launcher into the Section Dashboards: one
 * card per visible section (role plus entitlement gated), each linking to its
 * section home. The server-side API gates remain the authority; the hiding
 * here is presentational only.
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

  const { role, can } = useCapabilities();
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
  //
  // F-Wave10-WELCOME-PASSWORD-SERVER-GATE-01: only nudge users who genuinely
  // have no password yet. password_set is server-authoritative
  // (auth.users.encrypted_password via GET /me). We require a strict `false`
  // so an older getMe response that predates the field (undefined) is treated
  // as "do not nudge", which prevents re-nagging a user who already has a
  // password from a fresh browser or after clearing storage. The localStorage
  // one-shot still suppresses repeat nudges within a browser for the
  // genuinely-passwordless case.
  const passwordSet = me.data?.password_set;
  useEffect(() => {
    if (me.isLoading) return;
    if (!userId) return;
    if (passwordSet !== false) return;
    if (hasSeenPasswordPrompt(userId)) return;
    navigate('/account/security?welcome=1', { replace: true });
  }, [me.isLoading, userId, passwordSet, navigate]);

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
      <header className="flex flex-col gap-1">
        <h1 className="text-3xl font-display tracking-wide text-ink">
          DASHBOARD
        </h1>
        <p className="font-sans text-sm text-ink-dim">
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

      <SectionLauncher
        flags={orgFlags.data}
        loading={orgFlags.isLoading}
        role={role}
        can={can}
      />
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
          to="/quotes?state=submitted"
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
// SectionLauncher. Replaces the descriptive PILLARS block (which taught the
// add-ons once and then added nothing) with a role-aware launcher into the
// Section Dashboards. Mirrors the sidebar's visibility: a section shows only
// when the active role can see it (isModeVisible) and it has at least one
// entitled route, so add-on sections appear only when their plugin is on. Each
// card links to the section home (/sell, /money, ...). Presentational; the
// server stays the authority on entitlement and capability.
// ---------------------------------------------------------------------------

interface SectionLauncherProps {
  flags: Record<string, boolean>;
  loading: boolean;
  role: RoleCode | null;
  can: (cap: Capability) => boolean;
}

function SectionLauncher({ flags, loading, role, can }: SectionLauncherProps) {
  const sections = SIDEBAR_MODES.filter((mode) =>
    isModeVisible(mode, role, can),
  ).filter((mode) => visibleRoutesForMode(mode, flags, can).length > 0);

  return (
    <section className="flex flex-col gap-4">
      <h2 className="font-display text-2xl tracking-wide text-ink-dim">SECTIONS</h2>

      {loading ? (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-24 animate-pulse border border-line bg-bg-2 p-6"
            />
          ))}
        </div>
      ) : sections.length === 0 ? (
        <p className="font-sans text-sm text-ink-dim">
          No sections are available for your role yet.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {sections.map((mode) => {
            const Icon = mode.icon;
            return (
              <Link
                key={mode.key}
                to={mode.homePath}
                className="group flex flex-col gap-2 border border-line bg-bg-2 p-6 hover:border-accent"
              >
                <span className="flex items-center gap-2">
                  <Icon className="h-5 w-5 text-ink-dim group-hover:text-ink" />
                  <span className="font-display text-xl uppercase tracking-wider text-ink">
                    {mode.label}
                  </span>
                </span>
                <span className="font-sans text-sm text-ink-dim">
                  {mode.subtitle}
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}
