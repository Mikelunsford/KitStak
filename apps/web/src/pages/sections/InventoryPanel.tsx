// Inventory Section Dashboard panel (Section Dashboards, Phase 2). KPI band plus
// an items-below-reorder widget and (when the 3PL add-on is on) an inbound
// receiving widget. Inbound/outbound and bin KPIs surface per entitlement.
// Read-only; one round-trip via useInventorySummary.

import { Link } from 'react-router-dom';

import { useInventorySummary } from '@/lib/hooks/useCrossCutting';
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

function formatQty(n: number): string {
  return Number.isInteger(n) ? n.toString() : n.toFixed(2);
}

function formatExpected(iso: string | null): string {
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

export function InventoryPanel() {
  const query = useInventorySummary();
  const flags = useOrgFlags().data;
  const threePl = flags[FEATURE_FLAGS.PLUGINS_THREE_PL] === true;
  const wms = flags[FEATURE_FLAGS.PLUGINS_WMS] === true;

  if (query.isLoading || !query.data) return <PanelSkeleton />;
  if (query.error) {
    return (
      <p className="font-sans text-sm text-accent">
        Could not load Inventory metrics. Refresh the page.
      </p>
    );
  }

  const { kpis, below_reorder, inbound_receiving } = query.data;

  return (
    <div className="flex flex-col gap-8">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiTile
          label="Below reorder"
          value={String(kpis.below_reorder_count)}
          accent={kpis.below_reorder_count > 0}
        />
        <KpiTile label="Stocked SKUs" value={String(kpis.stocked_skus_count)} />
        {threePl ? (
          <>
            <KpiTile
              label="Inbound receiving"
              value={String(kpis.inbound_receiving_count)}
            />
            <KpiTile
              label="Outbound shipments"
              value={String(kpis.outbound_shipments_count)}
            />
          </>
        ) : null}
        {wms ? (
          <KpiTile
            label="Occupied bins"
            value={String(kpis.occupied_bins_count)}
          />
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="flex flex-col gap-3 border border-line bg-bg-2 p-4">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-xl tracking-wide text-ink">
              Items below reorder
            </h2>
            <Link
              to="/inventory/stock/levels"
              className="font-sans text-xs uppercase tracking-wider text-ink-dim hover:text-ink"
            >
              Stock levels
            </Link>
          </div>
          {below_reorder.length === 0 ? (
            <p className="font-sans text-sm text-ink-dim">
              Nothing below its reorder point.
            </p>
          ) : (
            <ul className="flex flex-col">
              {below_reorder.map((it) => (
                <li
                  key={it.item_id}
                  className="flex items-center justify-between border-b border-line/40 py-2 last:border-0"
                >
                  <span className="flex flex-col">
                    <span className="font-sans text-sm text-ink">
                      {it.sku || it.name || it.item_id.slice(0, 8)}
                    </span>
                    <span className="font-sans text-xs text-ink-dim">
                      {it.name}
                    </span>
                  </span>
                  <span className="font-display tracking-wide text-accent tabular-nums">
                    {formatQty(it.on_hand)} / {formatQty(it.reorder_point)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {threePl ? (
          <section className="flex flex-col gap-3 border border-line bg-bg-2 p-4">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-xl tracking-wide text-ink">
                Inbound receiving
              </h2>
              <Link
                to="/3pl-operations/receiving"
                className="font-sans text-xs uppercase tracking-wider text-ink-dim hover:text-ink"
              >
                View all
              </Link>
            </div>
            {inbound_receiving.length === 0 ? (
              <p className="font-sans text-sm text-ink-dim">
                No open receiving orders.
              </p>
            ) : (
              <ul className="flex flex-col">
                {inbound_receiving.map((r) => (
                  <li key={r.id} className="border-b border-line/40 last:border-0">
                    <Link
                      to={`/3pl-operations/receiving/${r.id}`}
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
                        expected {formatExpected(r.expected_date)}
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
