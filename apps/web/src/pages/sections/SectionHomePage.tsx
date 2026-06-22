// SectionHomePage. The destination behind every task-section header (Section
// Dashboards). One component serves all eight section homes: it resolves which
// section from the pathname, renders the section header, and composes the
// section's content as a list of widgets (the KPI panel, where one exists, plus
// one widget per hub domain group). The widget list is rendered through
// CustomizableSection, which applies the user's saved order/visibility and
// hosts Customize mode (Personalization, Phase A2). Role-gated sections bounce
// to the global dashboard once capabilities resolve; underlying page URLs are
// unchanged.

import { type ReactNode } from 'react';
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
import type { DashboardSectionKey } from '@/lib/types/cross_cutting';
import { SellPanel } from './SellPanel';
import { MoneyPanel } from './MoneyPanel';
import { InventoryPanel } from './InventoryPanel';
import { ProductionPanel } from './ProductionPanel';
import { BuyPanel } from './BuyPanel';
import { WorkforcePanel } from './WorkforcePanel';
import { InsightsPanel } from './InsightsPanel';
import { SetHomeButton } from '@/components/shell/SetHomeButton';
import {
  CustomizableSection,
  type DashboardWidget,
} from './CustomizableSection';

// A single hub domain group rendered as its own widget: the group heading (kept
// visible outside Customize mode) plus the grid of sub-area cards.
function HubGroupNode({ group }: { group: SidebarRouteGroup }) {
  return (
    <div className="flex flex-col gap-3">
      {group.label ? (
        <h2 className="font-display text-xl tracking-wide text-ink-dim">
          {group.label}
        </h2>
      ) : null}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {group.routes.map((r) => {
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
  );
}

// The KPI panel for the sections that have one. Returns null for sections that
// are hub-only (e.g. Settings).
function panelFor(key: string): ReactNode {
  switch (key) {
    case 'sell':
      return <SellPanel />;
    case 'money':
      return <MoneyPanel />;
    case 'inventory':
      return <InventoryPanel />;
    case 'production':
      return <ProductionPanel />;
    case 'buy':
      return <BuyPanel />;
    case 'workforce':
      return <WorkforcePanel />;
    case 'insights':
      return <InsightsPanel />;
    default:
      return null;
  }
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

  // Compose the section's widgets: the KPI panel (when the section has one)
  // followed by one widget per hub domain group. Stable ids let the saved
  // layout survive across visits and new sections.
  const widgets: DashboardWidget[] = [];
  const panelNode = panelFor(mode.key);
  if (panelNode) {
    widgets.push({ id: 'panel', title: 'Key metrics', node: panelNode });
  }
  for (const grp of groups) {
    widgets.push({
      id: `hub:${grp.label ?? 'general'}`,
      title: grp.label ?? 'Shortcuts',
      node: <HubGroupNode group={grp} />,
    });
  }

  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-10 px-8 py-12">
      <header className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="font-display text-4xl tracking-wide text-ink">
            {mode.label}
          </h1>
          <p className="font-sans text-sm text-ink-dim">{mode.subtitle}</p>
        </div>
        <SetHomeButton path={mode.homePath} />
      </header>

      <CustomizableSection
        sectionKey={mode.key as DashboardSectionKey}
        widgets={widgets}
        loadingHub={!ready}
      />
    </section>
  );
}
