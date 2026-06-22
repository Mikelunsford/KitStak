// Money Section Dashboard panel (Section Dashboards, Phase 1). KPI band plus an
// AR aging breakdown and the oldest unpaid invoices, each deep-linking into the
// existing invoicing pages. Read-only; one round-trip via useMoneySummary.
// Rendered above the section hub by SectionHomePage.

import { Link } from 'react-router-dom';

import { formatCents } from '@/lib/money';
import { useMoneySummary } from '@/lib/hooks/useCrossCutting';
import { KpiTile } from './KpiTile';
import { arAgingRows, centsToNumber, humanizeToken } from './sectionDashboardFormat';

function PanelSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="h-24 animate-pulse border border-line bg-bg-2" />
      ))}
    </div>
  );
}

function formatDueDate(iso: string | null): string {
  if (!iso) return 'No due date';
  const date = new Date(`${iso}T00:00:00Z`);
  if (!Number.isFinite(date.getTime())) return iso;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

export function MoneyPanel() {
  const query = useMoneySummary();

  if (query.isLoading || !query.data) return <PanelSkeleton />;
  if (query.error) {
    return (
      <p className="font-sans text-sm text-accent">
        Could not load Money metrics. Refresh the page.
      </p>
    );
  }

  const { kpis, ar_aging, unpaid_invoices } = query.data;
  const aging = arAgingRows(ar_aging);

  return (
    <div className="flex flex-col gap-8">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiTile
          label="AR outstanding"
          value={formatCents(centsToNumber(kpis.ar_balance_cents))}
          sub={`${kpis.unpaid_invoices_count} unpaid invoice${kpis.unpaid_invoices_count === 1 ? '' : 's'}`}
        />
        <KpiTile
          label="Unpaid invoices"
          value={String(kpis.unpaid_invoices_count)}
        />
        <KpiTile
          label="Payments this month"
          value={formatCents(centsToNumber(kpis.payments_this_month_cents))}
        />
        <KpiTile
          label="Credit notes outstanding"
          value={formatCents(centsToNumber(kpis.credit_notes_outstanding_cents))}
          sub={`${kpis.credit_notes_outstanding_count} open`}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="flex flex-col gap-3 border border-line bg-bg-2 p-4">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-xl tracking-wide text-ink">
              AR aging
            </h2>
            <Link
              to="/invoicing/invoices?status=overdue"
              className="font-sans text-xs uppercase tracking-wider text-ink-dim hover:text-ink"
            >
              View overdue
            </Link>
          </div>
          <ul className="flex flex-col">
            {aging.map((row) => {
              const overdue = row.key === 'd90_plus' && row.cents > 0;
              return (
                <li
                  key={row.key}
                  className="flex items-center justify-between border-b border-line/40 py-2 last:border-0"
                >
                  <span className="font-sans text-sm text-ink">{row.label}</span>
                  <span
                    className={`font-display tracking-wide tabular-nums ${
                      overdue ? 'text-accent' : 'text-ink'
                    }`}
                  >
                    {formatCents(row.cents)}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="flex flex-col gap-3 border border-line bg-bg-2 p-4">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-xl tracking-wide text-ink">
              Unpaid invoices
            </h2>
            <Link
              to="/invoicing/invoices?status=sent"
              className="font-sans text-xs uppercase tracking-wider text-ink-dim hover:text-ink"
            >
              View all
            </Link>
          </div>
          {unpaid_invoices.length === 0 ? (
            <p className="font-sans text-sm text-ink-dim">
              No unpaid invoices. Nice.
            </p>
          ) : (
            <ul className="flex flex-col">
              {unpaid_invoices.map((inv) => (
                <li key={inv.id} className="border-b border-line/40 last:border-0">
                  <Link
                    to={`/invoicing/invoices/${inv.id}`}
                    className="flex items-center justify-between py-2"
                  >
                    <span className="flex flex-col">
                      <span className="font-sans text-sm text-ink">
                        {inv.number || inv.id.slice(0, 8)}
                      </span>
                      <span className="font-sans text-xs text-ink-dim">
                        {inv.customer_name || 'No customer'} ·{' '}
                        {humanizeToken(inv.status)} · due {formatDueDate(inv.due_date)}
                      </span>
                    </span>
                    <span className="font-display tracking-wide text-ink tabular-nums">
                      {formatCents(centsToNumber(inv.balance_cents))}
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
