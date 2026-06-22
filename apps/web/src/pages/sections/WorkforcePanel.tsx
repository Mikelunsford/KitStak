// Workforce Section Dashboard panel (Section Dashboards, Phase 3). KPI band plus
// open assignments and who is on shift, each deep-linking into the KitForce
// pages. Read-only; one round-trip via useWorkforceSummary.

import { Link } from 'react-router-dom';

import { formatCents } from '@/lib/money';
import { useWorkforceSummary } from '@/lib/hooks/useCrossCutting';
import { KpiTile } from './KpiTile';
import { centsToNumber, humanizeToken } from './sectionDashboardFormat';

function PanelSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="h-24 animate-pulse border border-line bg-bg-2" />
      ))}
    </div>
  );
}

function formatStartedAt(iso: string | null): string {
  if (!iso) return 'Not started';
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return iso;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'UTC',
  }).format(date);
}

export function WorkforcePanel() {
  const query = useWorkforceSummary();

  if (query.isLoading || !query.data) return <PanelSkeleton />;
  if (query.error) {
    return (
      <p className="font-sans text-sm text-accent">
        Could not load Workforce metrics. Refresh the page.
      </p>
    );
  }

  const { kpis, open_assignments, on_shift } = query.data;

  return (
    <div className="flex flex-col gap-8">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiTile label="Active members" value={String(kpis.active_members_count)} />
        <KpiTile label="On shift now" value={String(kpis.on_shift_count)} />
        <KpiTile
          label="Open assignments"
          value={String(kpis.open_assignments_count)}
        />
        <KpiTile
          label="Labor cost this month"
          value={formatCents(centsToNumber(kpis.labor_cost_this_month_cents))}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="flex flex-col gap-3 border border-line bg-bg-2 p-4">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-xl tracking-wide text-ink">
              Open assignments
            </h2>
            <Link
              to="/kitforce/assignments"
              className="font-sans text-xs uppercase tracking-wider text-ink-dim hover:text-ink"
            >
              View all
            </Link>
          </div>
          {open_assignments.length === 0 ? (
            <p className="font-sans text-sm text-ink-dim">No open assignments.</p>
          ) : (
            <ul className="flex flex-col">
              {open_assignments.map((a) => (
                <li key={a.id} className="border-b border-line/40 last:border-0">
                  <Link
                    to={`/kitforce/assignments/${a.id}`}
                    className="flex items-center justify-between py-2"
                  >
                    <span className="flex flex-col">
                      <span className="font-sans text-sm text-ink">
                        {a.title || a.number || a.id.slice(0, 8)}
                      </span>
                      <span className="font-sans text-xs text-ink-dim">
                        {a.member_name || 'Unassigned'} · {humanizeToken(a.status)}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="flex flex-col gap-3 border border-line bg-bg-2 p-4">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-xl tracking-wide text-ink">
              On shift now
            </h2>
            <Link
              to="/kitforce/shifts"
              className="font-sans text-xs uppercase tracking-wider text-ink-dim hover:text-ink"
            >
              View all
            </Link>
          </div>
          {on_shift.length === 0 ? (
            <p className="font-sans text-sm text-ink-dim">No one is on shift.</p>
          ) : (
            <ul className="flex flex-col">
              {on_shift.map((s) => (
                <li key={s.id} className="border-b border-line/40 last:border-0">
                  <Link
                    to={`/kitforce/shifts/${s.id}`}
                    className="flex items-center justify-between py-2"
                  >
                    <span className="flex flex-col">
                      <span className="font-sans text-sm text-ink">
                        {s.member_name || s.number || s.id.slice(0, 8)}
                      </span>
                      <span className="font-sans text-xs text-ink-dim">
                        {s.number}
                      </span>
                    </span>
                    <span className="font-sans text-xs text-ink-dim">
                      since {formatStartedAt(s.started_at)}
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
