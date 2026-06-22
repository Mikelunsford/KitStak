// Buy Section Dashboard panel (Section Dashboards, Phase 3). KPI band plus open
// purchase orders and vendor bills due, each deep-linking into the purchasing
// pages. Read-only; one round-trip via useBuySummary.

import { Link } from 'react-router-dom';

import { formatCents } from '@/lib/money';
import { useBuySummary } from '@/lib/hooks/useCrossCutting';
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

function formatDate(iso: string | null): string {
  if (!iso) return 'No date';
  const date = new Date(`${iso}T00:00:00Z`);
  if (!Number.isFinite(date.getTime())) return iso;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

export function BuyPanel() {
  const query = useBuySummary();

  if (query.isLoading || !query.data) return <PanelSkeleton />;
  if (query.error) {
    return (
      <p className="font-sans text-sm text-accent">
        Could not load Buy metrics. Refresh the page.
      </p>
    );
  }

  const { kpis, open_purchase_orders, vendor_bills_due } = query.data;

  return (
    <div className="flex flex-col gap-8">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiTile label="Open purchase orders" value={String(kpis.open_pos_count)} />
        <KpiTile
          label="Vendor bills due"
          value={String(kpis.vendor_bills_due_count)}
          sub={`${formatCents(centsToNumber(kpis.vendor_bills_due_cents))} owed`}
        />
        <KpiTile
          label="Expenses to approve"
          value={String(kpis.expenses_to_approve_count)}
          accent={kpis.expenses_to_approve_count > 0}
        />
        <KpiTile
          label="Spend this month"
          value={formatCents(centsToNumber(kpis.spend_this_month_cents))}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="flex flex-col gap-3 border border-line bg-bg-2 p-4">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-xl tracking-wide text-ink">
              Open purchase orders
            </h2>
            <Link
              to="/purchasing/purchase-orders"
              className="font-sans text-xs uppercase tracking-wider text-ink-dim hover:text-ink"
            >
              View all
            </Link>
          </div>
          {open_purchase_orders.length === 0 ? (
            <p className="font-sans text-sm text-ink-dim">No open purchase orders.</p>
          ) : (
            <ul className="flex flex-col">
              {open_purchase_orders.map((po) => (
                <li key={po.id} className="border-b border-line/40 last:border-0">
                  <Link
                    to={`/purchasing/purchase-orders/${po.id}`}
                    className="flex items-center justify-between py-2"
                  >
                    <span className="flex flex-col">
                      <span className="font-sans text-sm text-ink">
                        {po.number || po.id.slice(0, 8)}
                      </span>
                      <span className="font-sans text-xs text-ink-dim">
                        {humanizeToken(po.status)} · expected {formatDate(po.expected_date)}
                      </span>
                    </span>
                    <span className="font-display tracking-wide text-ink tabular-nums">
                      {formatCents(centsToNumber(po.total_cents))}
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
              Vendor bills due
            </h2>
            <Link
              to="/purchasing/vendor-bills"
              className="font-sans text-xs uppercase tracking-wider text-ink-dim hover:text-ink"
            >
              View all
            </Link>
          </div>
          {vendor_bills_due.length === 0 ? (
            <p className="font-sans text-sm text-ink-dim">No vendor bills due.</p>
          ) : (
            <ul className="flex flex-col">
              {vendor_bills_due.map((bill) => (
                <li key={bill.id} className="border-b border-line/40 last:border-0">
                  <Link
                    to={`/purchasing/vendor-bills/${bill.id}`}
                    className="flex items-center justify-between py-2"
                  >
                    <span className="flex flex-col">
                      <span className="font-sans text-sm text-ink">
                        {bill.number || bill.id.slice(0, 8)}
                      </span>
                      <span className="font-sans text-xs text-ink-dim">
                        {humanizeToken(bill.status)} · due {formatDate(bill.due_date)}
                      </span>
                    </span>
                    <span className="font-display tracking-wide text-ink tabular-nums">
                      {formatCents(centsToNumber(bill.balance_cents))}
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
