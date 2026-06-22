// Production and Fulfillment Section Dashboard panel (Section Dashboards, Phase
// 2). KPI band spanning manufacturing, co-pack, and 3PL, plus per-add-on widget
// lists folded by entitlement. Read-only; one round-trip via
// useProductionSummary.

import { Link } from 'react-router-dom';

import { useProductionSummary } from '@/lib/hooks/useCrossCutting';
import { useOrgFlags } from '@/lib/hooks/useOrgFlags';
import { FEATURE_FLAGS } from '@/lib/constants';
import { KpiTile } from './KpiTile';
import { humanizeToken } from './sectionDashboardFormat';

function PanelSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="h-24 animate-pulse border border-line bg-bg-2" />
      ))}
    </div>
  );
}

function formatPlanned(iso: string | null): string {
  if (!iso) return 'No target';
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return iso;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

export function ProductionPanel() {
  const query = useProductionSummary();
  const flags = useOrgFlags().data;
  const mfg = flags[FEATURE_FLAGS.PLUGINS_MANUFACTURING] === true;
  const copack = flags[FEATURE_FLAGS.PLUGINS_COPACK_ECOM] === true;
  const threePl = flags[FEATURE_FLAGS.PLUGINS_THREE_PL] === true;

  if (query.isLoading || !query.data) return <PanelSkeleton />;
  if (query.error) {
    return (
      <p className="font-sans text-sm text-accent">
        Could not load Production metrics. Refresh the page.
      </p>
    );
  }

  const { kpis, manufacturing_runs, sales_orders, job_runs } = query.data;

  return (
    <div className="flex flex-col gap-8">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiTile
          label="Runs in production"
          value={String(kpis.runs_in_production_count)}
        />
        <KpiTile
          label="Kitting in progress"
          value={String(kpis.kitting_in_progress_count)}
        />
        <KpiTile
          label="Orders to fulfill"
          value={String(kpis.orders_to_fulfill_count)}
        />
        <KpiTile
          label="Late jobs"
          value={String(kpis.late_jobs_count)}
          accent={kpis.late_jobs_count > 0}
          sub="Past planned date"
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {mfg ? (
          <section className="flex flex-col gap-3 border border-line bg-bg-2 p-4">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-xl tracking-wide text-ink">
                Manufacturing runs
              </h2>
              <Link
                to="/manufacturing/runs"
                className="font-sans text-xs uppercase tracking-wider text-ink-dim hover:text-ink"
              >
                View all
              </Link>
            </div>
            {manufacturing_runs.length === 0 ? (
              <p className="font-sans text-sm text-ink-dim">No open runs.</p>
            ) : (
              <ul className="flex flex-col">
                {manufacturing_runs.map((r) => (
                  <li key={r.id} className="border-b border-line/40 last:border-0">
                    <Link
                      to={`/manufacturing/runs/${r.id}`}
                      className="flex items-center justify-between py-2"
                    >
                      <span className="flex flex-col">
                        <span className="font-sans text-sm text-ink">
                          {r.number || r.id.slice(0, 8)}
                        </span>
                        <span className="font-sans text-xs text-ink-dim">
                          {humanizeToken(r.status)}
                        </span>
                      </span>
                      <span className="font-sans text-xs text-ink-dim">
                        {formatPlanned(r.planned_complete_at)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}

        {copack ? (
          <section className="flex flex-col gap-3 border border-line bg-bg-2 p-4">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-xl tracking-wide text-ink">
                Orders to fulfill
              </h2>
              <Link
                to="/copack/orders"
                className="font-sans text-xs uppercase tracking-wider text-ink-dim hover:text-ink"
              >
                View all
              </Link>
            </div>
            {sales_orders.length === 0 ? (
              <p className="font-sans text-sm text-ink-dim">
                No open sales orders.
              </p>
            ) : (
              <ul className="flex flex-col">
                {sales_orders.map((s) => (
                  <li key={s.id} className="border-b border-line/40 last:border-0">
                    <Link
                      to={`/copack/orders/${s.id}`}
                      className="flex items-center justify-between py-2"
                    >
                      <span className="flex flex-col">
                        <span className="font-sans text-sm text-ink">
                          {s.number || s.id.slice(0, 8)}
                        </span>
                        <span className="font-sans text-xs text-ink-dim">
                          {s.customer_name || 'No customer'}
                        </span>
                      </span>
                      <span className="font-sans text-xs text-ink-dim">
                        {humanizeToken(s.status)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}

        {threePl ? (
          <section className="flex flex-col gap-3 border border-line bg-bg-2 p-4">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-xl tracking-wide text-ink">
                Job runs
              </h2>
              <Link
                to="/3pl-operations/job-runs"
                className="font-sans text-xs uppercase tracking-wider text-ink-dim hover:text-ink"
              >
                View all
              </Link>
            </div>
            {job_runs.length === 0 ? (
              <p className="font-sans text-sm text-ink-dim">No active job runs.</p>
            ) : (
              <ul className="flex flex-col">
                {job_runs.map((j) => (
                  <li key={j.id} className="border-b border-line/40 last:border-0">
                    <Link
                      to={`/3pl-operations/job-runs/${j.id}`}
                      className="flex items-center justify-between py-2"
                    >
                      <span className="font-sans text-sm text-ink">
                        {j.number || j.id.slice(0, 8)}
                      </span>
                      <span className="font-sans text-xs text-ink-dim">
                        {humanizeToken(j.status)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}
      </div>
    </div>
  );
}
