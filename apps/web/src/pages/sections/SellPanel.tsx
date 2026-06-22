// Sell Section Dashboard panel (Section Dashboards, Phase 1). KPI band plus two
// widgets (pipeline by stage, quotes needing action), each deep-linking into
// the existing list and detail pages. Read-only; one round-trip via
// useSellSummary. Rendered above the section hub by SectionHomePage.

import { Link } from 'react-router-dom';

import { formatCents } from '@/lib/money';
import { useSellSummary } from '@/lib/hooks/useCrossCutting';
import { KpiTile } from './KpiTile';
import {
  centsToNumber,
  stageLabel,
  winRateDisplay,
} from './sectionDashboardFormat';

function PanelSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="h-24 animate-pulse border border-line bg-bg-2" />
      ))}
    </div>
  );
}

export function SellPanel() {
  const query = useSellSummary();

  if (query.isLoading || !query.data) return <PanelSkeleton />;
  if (query.error) {
    return (
      <p className="font-sans text-sm text-accent">
        Could not load Sell metrics. Refresh the page.
      </p>
    );
  }

  const { kpis, pipeline_by_stage, quotes_needing_action } = query.data;

  return (
    <div className="flex flex-col gap-8">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiTile
          label="Open opportunities"
          value={String(kpis.open_opportunities_count)}
          sub={`${formatCents(centsToNumber(kpis.pipeline_value_cents))} pipeline`}
        />
        <KpiTile
          label="Quotes awaiting approval"
          value={String(kpis.quotes_awaiting_approval_count)}
        />
        <KpiTile
          label="Active projects"
          value={String(kpis.active_projects_count)}
        />
        <KpiTile
          label="Win rate"
          value={winRateDisplay(kpis.win_rate_pct)}
          sub="Closed won of decided"
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="flex flex-col gap-3 border border-line bg-bg-2 p-4">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-xl tracking-wide text-ink">
              Pipeline by stage
            </h2>
            <Link
              to="/crm/opportunities"
              className="font-sans text-xs uppercase tracking-wider text-ink-dim hover:text-ink"
            >
              View all
            </Link>
          </div>
          {pipeline_by_stage.length === 0 ? (
            <p className="font-sans text-sm text-ink-dim">
              No open opportunities yet.
            </p>
          ) : (
            <ul className="flex flex-col">
              {pipeline_by_stage.map((s) => (
                <li
                  key={s.stage}
                  className="flex items-center justify-between border-b border-line/40 py-2 last:border-0"
                >
                  <span className="font-sans text-sm text-ink">
                    {stageLabel(s.stage)}
                  </span>
                  <span className="flex items-center gap-4">
                    <span className="font-sans text-xs text-ink-dim">
                      {s.count}
                    </span>
                    <span className="font-display tracking-wide text-ink tabular-nums">
                      {formatCents(centsToNumber(s.value_cents))}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="flex flex-col gap-3 border border-line bg-bg-2 p-4">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-xl tracking-wide text-ink">
              Quotes needing action
            </h2>
            <Link
              to="/quotes?state=submitted"
              className="font-sans text-xs uppercase tracking-wider text-ink-dim hover:text-ink"
            >
              View all
            </Link>
          </div>
          {quotes_needing_action.length === 0 ? (
            <p className="font-sans text-sm text-ink-dim">
              No quotes waiting on you.
            </p>
          ) : (
            <ul className="flex flex-col">
              {quotes_needing_action.map((q) => (
                <li key={q.id} className="border-b border-line/40 last:border-0">
                  <Link
                    to={`/quotes/${q.id}`}
                    className="flex items-center justify-between py-2"
                  >
                    <span className="flex flex-col">
                      <span className="font-sans text-sm text-ink">
                        {q.number || q.id.slice(0, 8)}
                      </span>
                      <span className="font-sans text-xs text-ink-dim">
                        {q.customer_name || 'No customer'}
                      </span>
                    </span>
                    <span className="font-display tracking-wide text-ink tabular-nums">
                      {formatCents(centsToNumber(q.total_cents))}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
