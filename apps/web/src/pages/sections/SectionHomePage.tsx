// SectionHomePage. The destination behind every task-section header (Section
// Dashboards, Phase 1). One component serves all eight section homes: it
// resolves which section from the pathname, renders the section header, the
// fixed KPI dashboard for Sell and Money, and a hub of the section's sub-areas
// as navigational cards (mirroring the rail sub-links, reusing the exact flag
// and capability gating from sidebarModes). Role-gated sections bounce to the
// global dashboard once capabilities resolve. URLs of the underlying pages do
// not change; this is purely a new landing layer.

import { Link, Navigate, useLocation } from 'react-router-dom';

import { useOrgFlags } from '@/lib/hooks/useOrgFlags';
import { useCapabilities } from '@/lib/hooks/useCapabilities';
import {
  SIDEBAR_MODES,
  groupRoutesByDomain,
  isModeVisible,
  visibleRoutesForMode,
  type SidebarRouteGroup,
} from '@/components/shell/sidebarModes';
import { SellPanel } from './SellPanel';
import { MoneyPanel } from './MoneyPanel';
import { InventoryPanel } from './InventoryPanel';
import { ProductionPanel } from './ProductionPanel';

function SectionHub({
  groups,
  loading,
}: {
  groups: ReadonlyArray<SidebarRouteGroup>;
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-16 animate-pulse border border-line bg-bg-2"
          />
        ))}
      </div>
    );
  }
  if (groups.length === 0) {
    return (
      <p className="font-sans text-sm text-ink-dim">
        Nothing in this section is available yet.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-6">
      {groups.map((grp, gi) => (
        <div key={grp.label ?? `group-${gi}`} className="flex flex-col gap-3">
          {grp.label ? (
            <h2 className="font-display text-xl tracking-wide text-ink-dim">
              {grp.label}
            </h2>
          ) : null}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {grp.routes.map((r) => {
              const Icon = r.icon;
              return (
                <Link
                  key={r.path}
                  to={r.path}
                  className="group flex items-center gap-3 border border-line bg-bg-2 p-5 hover:border-accent"
                >
                  <Icon className="h-5 w-5 text-ink-dim group-hover:text-ink" />
                  <span className="font-sans text-sm text-ink">{r.label}</span>
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

export function SectionHomePage() {
  const { pathname } = useLocation();
  const orgFlags = useOrgFlags();
  const { role, can } = useCapabilities();

  const mode = SIDEBAR_MODES.find((m) => m.homePath === pathname);
  if (!mode) return <Navigate to="/dashboard" replace />;

  // Wait for role + flags before deciding visibility so an authorized section
  // never flash-bounces while capabilities resolve.
  const ready = role !== null && !orgFlags.isLoading;
  if (ready && !isModeVisible(mode, role, can)) {
    return <Navigate to="/dashboard" replace />;
  }

  const groups = ready
    ? groupRoutesByDomain(visibleRoutesForMode(mode, orgFlags.data, can))
    : [];

  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-10 px-8 py-12">
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-4xl tracking-wide text-ink">
          {mode.label}
        </h1>
        <p className="font-sans text-sm text-ink-dim">{mode.subtitle}</p>
      </header>

      {mode.key === 'sell' ? <SellPanel /> : null}
      {mode.key === 'money' ? <MoneyPanel /> : null}
      {mode.key === 'inventory' ? <InventoryPanel /> : null}
      {mode.key === 'production' ? <ProductionPanel /> : null}

      <SectionHub groups={groups} loading={!ready} />
    </section>
  );
}
