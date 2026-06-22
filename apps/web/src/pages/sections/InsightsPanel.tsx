// Insights Section Dashboard panel (Section Dashboards, Insights consolidation).
// Surfaces the KitCost headline KPIs at the top of /insights so the section
// reads as one analytics home; the hub below still links into the full KitCost
// dashboard and the Profitability page. Reuses the existing KitCost summary
// endpoint (no new backend); the query is cap-gated to kitcost.dashboard.view,
// so a role without it sees just the hub. Read-only.

import { Link } from 'react-router-dom';

import { formatCents } from '@/lib/money';
import { useCapabilities } from '@/lib/hooks/useCapabilities';
import { useKitCostSummary } from '@/lib/hooks/useKitCost';
import { KpiTile } from './KpiTile';
import { centsToNumber } from './sectionDashboardFormat';

function PanelSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="h-24 animate-pulse border border-line bg-bg-2" />
      ))}
    </div>
  );
}

export function InsightsPanel() {
  const caps = useCapabilities();
  const canViewKitCost = caps.can('kitcost.dashboard.view');
  const query = useKitCostSummary();

  // No cost-dashboard access: the hub still offers the Profitability card.
  if (!canViewKitCost) return null;
  if (query.isLoading || !query.data) return <PanelSkeleton />;
  if (query.error) {
    return (
      <p className="font-sans text-sm text-accent">
        Could not load cost metrics. Refresh the page.
      </p>
    );
  }

  const { kpis } = query.data;
  const empty =
    centsToNumber(kpis.total_revenue_ytd_cents) === 0 &&
    centsToNumber(kpis.invoiced_this_month_cents) === 0 &&
    kpis.active_projects_count === 0 &&
    centsToNumber(kpis.inventory_value_cents) === 0;

  if (empty) {
    return (
      <p className="font-sans text-sm text-ink-dim">
        No cost or margin data yet. Once you have paid invoices and active
        projects, the numbers land here.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiTile
          label="Total revenue YTD"
          value={formatCents(centsToNumber(kpis.total_revenue_ytd_cents))}
        />
        <KpiTile
          label="Invoiced this month"
          value={formatCents(centsToNumber(kpis.invoiced_this_month_cents))}
        />
        <KpiTile
          label="Active projects"
          value={String(kpis.active_projects_count)}
        />
        <KpiTile
          label="Inventory value"
          value={formatCents(centsToNumber(kpis.inventory_value_cents))}
        />
      </div>
      <div>
        <Link
          to="/kitcost/dashboard"
          className="font-sans text-xs uppercase tracking-wider text-ink-dim hover:text-ink"
        >
          Open the full cost dashboard
        </Link>
      </div>
    </div>
  );
}
