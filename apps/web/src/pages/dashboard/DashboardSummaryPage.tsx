// DashboardSummaryPage. KPI tiles backed by /dashboard-api/dashboard/summary.
// Charts are hand-rolled SVG per the banned-dependency rule.

import { useDashboardSummary } from '@/lib/hooks/useCrossCutting';

function centsLabel(v: number | string, currency: string): string {
  const num =
    typeof v === 'number' ? v : Number.parseInt(v, 10);
  if (!Number.isFinite(num)) return `0.00 ${currency}`;
  const major = (num / 100).toFixed(2);
  return `${major} ${currency}`;
}

interface TileProps {
  label: string;
  value: string;
  sub?: string;
}
function Tile({ label, value, sub }: TileProps) {
  return (
    <div className="border border-line bg-bg-2 p-4">
      <p className="text-xs uppercase tracking-wider text-ink-dim">{label}</p>
      <p className="mt-1 font-display text-3xl tracking-wide text-ink">{value}</p>
      {sub ? <p className="text-xs text-ink-dim">{sub}</p> : null}
    </div>
  );
}

export function DashboardSummaryPage() {
  const query = useDashboardSummary();
  const s = query.data;

  return (
    <section className="px-6 py-8 max-w-6xl mx-auto flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-4xl tracking-wide text-ink">DASHBOARD</h1>
        <p className="text-sm text-ink-dim">
          Workspace summary across receivables, in-flight ops, and pipeline.
        </p>
      </header>

      {query.isLoading || !s ? (
        <p className="text-sm text-ink-dim">Loading.</p>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <Tile
              label="Open AR"
              value={centsLabel(s.ar_balance_cents, s.currency_code)}
              sub={`${s.open_invoices_count} open invoices`}
            />
            <Tile
              label="Overdue invoices"
              value={String(s.overdue_invoices_count)}
            />
            <Tile label="Open quotes" value={String(s.open_quotes_count)} />
            <Tile
              label="Receiving in flight"
              value={String(s.in_flight_receiving_count)}
            />
            <Tile
              label="Shipments in transit"
              value={String(s.in_flight_shipments_count)}
            />
            <Tile
              label="Active projects"
              value={String(s.active_projects_count)}
            />
          </div>

          <section>
            <h2 className="mb-2 font-display text-lg tracking-wider text-ink">
              IN-FLIGHT MIX
            </h2>
            <ChartBars
              entries={[
                { label: 'Receiving', value: s.in_flight_receiving_count },
                { label: 'Shipments', value: s.in_flight_shipments_count },
                { label: 'Projects', value: s.active_projects_count },
              ]}
            />
          </section>
        </>
      )}
    </section>
  );
}

function ChartBars({ entries }: { entries: Array<{ label: string; value: number }> }) {
  const max = Math.max(1, ...entries.map((e) => e.value));
  const barW = 60;
  const gap = 24;
  const chartW = entries.length * barW + (entries.length - 1) * gap + 40;
  const chartH = 160;
  return (
    <svg
      role="img"
      aria-label="In-flight mix bar chart"
      width={chartW}
      height={chartH}
      viewBox={`0 0 ${chartW} ${chartH}`}
      className="text-ink"
    >
      {entries.map((e, i) => {
        const x = 20 + i * (barW + gap);
        const h = (e.value / max) * (chartH - 40);
        const y = chartH - 20 - h;
        return (
          <g key={e.label}>
            <rect
              x={x}
              y={y}
              width={barW}
              height={h}
              fill="currentColor"
              opacity={0.6}
            />
            <text
              x={x + barW / 2}
              y={chartH - 4}
              textAnchor="middle"
              fontSize="10"
              fill="currentColor"
            >
              {e.label}
            </text>
            <text
              x={x + barW / 2}
              y={y - 4}
              textAnchor="middle"
              fontSize="10"
              fill="currentColor"
            >
              {e.value}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
