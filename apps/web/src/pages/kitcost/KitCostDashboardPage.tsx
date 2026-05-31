// KitCostDashboardPage. Path C / C2 of the KitCost pillar wiring plan.
// Pillar 5.
//
// Read-only dashboard. One round-trip pulls KPIs, revenue trend, top
// customers, and project margins; the page hands each slice to a Recharts
// component. The route is already lazy-loaded via routes.ts, so importing
// recharts at module top-level here puts it in the KitCost chunk, not the
// main SPA index chunk (verified via pnpm -C apps/web build).
//
// Capability gate: useKitCostSummary disables the query when the caller
// lacks kitcost.dashboard.view; the page renders a "Not available" state
// instead of firing a guaranteed 403.

import type { ReactNode } from 'react';

import { formatCents } from '@/lib/money';
import { useCapabilities } from '@/lib/hooks/useCapabilities';
import { useKitCostSummary } from '@/lib/hooks/useKitCost';
import {
  blendedMargin,
  costStructure,
  customerConcentration,
  customerContribution,
  marginDistribution,
  marginsByHealth,
  marginsToCsv,
  revenueGrowth,
  revenueRunRate,
} from './kitcostDerived';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

// Brand palette. Kept inline (not pulled from tailwind.config.js at runtime)
// because Recharts needs raw hex strings for series colors and Tailwind
// classes are not available inside the SVG renderer.
const NAVY = '#0a1628';
const ACCENT = '#c8102e';
const INK_DIM = '#8a9bb0';
const LINE_FAINT = '#2d3f55';
const BG_2 = '#0f1d33';

function asNum(v: number | string): number {
  return typeof v === 'number' ? v : Number(v);
}

interface KpiTileProps {
  label: string;
  value: string;
  sub?: string;
}
function KpiTile({ label, value, sub }: KpiTileProps) {
  return (
    <div className="border border-line bg-bg-2 p-4">
      <p className="text-xs uppercase tracking-wider text-ink-dim">{label}</p>
      <p className="mt-1 font-display text-3xl tracking-wide text-ink">{value}</p>
      {sub ? <p className="mt-1 text-xs text-ink-dim">{sub}</p> : null}
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="border border-line bg-bg-2 p-4 flex flex-col gap-3">
      <h2 className="font-display text-xl tracking-wide text-ink">{title}</h2>
      <div className="h-72 w-full">{children}</div>
    </div>
  );
}

function axisDollarTick(cents: number): string {
  // Compact dollar tick for the Y axis. The full precise amount is in the
  // tooltip; the tick only needs to be readable at 24px height.
  const dollars = cents / 100;
  if (Math.abs(dollars) >= 1_000_000) return `$${(dollars / 1_000_000).toFixed(1)}M`;
  if (Math.abs(dollars) >= 1_000) return `$${(dollars / 1_000).toFixed(1)}K`;
  return `$${dollars.toFixed(0)}`;
}

export function KitCostDashboardPage() {
  const caps = useCapabilities();
  const canView = caps.can('kitcost.dashboard.view');
  const query = useKitCostSummary();

  if (!canView) {
    return (
      <section className="px-8 py-12 max-w-6xl mx-auto flex flex-col gap-6">
        <h1 className="font-display text-4xl tracking-wide text-ink">KITCOST</h1>
        <div className="border border-line bg-bg-2 p-6">
          <p className="text-sm text-ink-dim">
            Cost dashboard is not available for your role. Ask an org admin if you
            need access.
          </p>
        </div>
      </section>
    );
  }

  if (query.isLoading || !query.data) {
    return (
      <section className="px-8 py-12 max-w-6xl mx-auto flex flex-col gap-6">
        <h1 className="font-display text-4xl tracking-wide text-ink">KITCOST</h1>
        <p className="text-sm text-ink-dim">Loading.</p>
      </section>
    );
  }

  if (query.error) {
    return (
      <section className="px-8 py-12 max-w-6xl mx-auto flex flex-col gap-6">
        <h1 className="font-display text-4xl tracking-wide text-ink">KITCOST</h1>
        <p className="text-sm text-accent">
          {query.error instanceof Error ? query.error.message : 'Failed to load.'}
        </p>
      </section>
    );
  }

  const { kpis, revenue_trend, top_customers, project_margins } = query.data;

  const empty =
    asNum(kpis.total_revenue_ytd_cents) === 0 &&
    asNum(kpis.invoiced_this_month_cents) === 0 &&
    kpis.active_projects_count === 0 &&
    asNum(kpis.inventory_value_cents) === 0 &&
    top_customers.length === 0 &&
    project_margins.length === 0;

  if (empty) {
    return (
      <section className="px-8 py-12 max-w-6xl mx-auto flex flex-col gap-6">
        <h1 className="font-display text-4xl tracking-wide text-ink">KITCOST</h1>
        <div className="border border-line bg-bg-2 p-6">
          <p className="text-sm text-ink-dim">
            No KitCost data yet. Once you have paid invoices and active projects,
            this dashboard will populate.
          </p>
        </div>
      </section>
    );
  }

  // Recharts data adapters: convert BIGINT-cents strings to Numbers. Safe
  // because the SPA never displays fractional dollars above 9e15.
  const trendData = revenue_trend.map((p) => ({
    month: p.month,
    revenue: asNum(p.revenue_cents),
  }));
  const customersData = top_customers.map((c) => ({
    name: c.customer_name || c.customer_id.slice(0, 8),
    revenue: asNum(c.revenue_cents),
  }));
  const marginsData = project_margins.map((p) => ({
    name: p.project_name || p.project_id.slice(0, 8),
    revenue: asNum(p.revenue_cents),
    cost: asNum(p.cost_cents),
    margin: asNum(p.margin_cents),
    pct: p.margin_pct,
  }));

  // Derived report views over the same payload. No new round-trip.
  const blended = blendedMargin(project_margins);
  const growth = revenueGrowth(revenue_trend);
  const concentration = customerConcentration(top_customers);
  const marginRows = marginsByHealth(project_margins);
  const structure = costStructure(project_margins);
  const runRate = revenueRunRate(revenue_trend);
  const distribution = marginDistribution(project_margins);
  const contribution = customerContribution(top_customers);

  function downloadMarginsCsv() {
    const csv = marginsToCsv(marginRows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'kitcost-project-margins.csv';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }

  return (
    <section className="px-8 py-12 max-w-6xl mx-auto flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-4xl tracking-wide text-ink">KITCOST</h1>
        <p className="text-sm text-ink-dim">
          Revenue, margins, and inventory value across your workspace.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <KpiTile
          label="Total revenue YTD"
          value={formatCents(asNum(kpis.total_revenue_ytd_cents))}
        />
        <KpiTile
          label="Invoiced this month"
          value={formatCents(asNum(kpis.invoiced_this_month_cents))}
        />
        <KpiTile
          label="Active projects"
          value={String(kpis.active_projects_count)}
        />
        <KpiTile
          label="Inventory value"
          value={formatCents(asNum(kpis.inventory_value_cents))}
        />
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="font-display text-xl tracking-wide text-ink-dim">INSIGHTS</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <KpiTile
            label="Blended margin"
            value={`${blended.margin_pct.toFixed(1)}%`}
            sub={`${formatCents(blended.margin_cents)} on ${formatCents(blended.revenue_cents)}`}
          />
          <KpiTile
            label="Revenue MoM"
            value={growth.mom_pct === null ? 'n/a' : `${growth.mom_pct.toFixed(1)}%`}
            sub="Latest month vs prior"
          />
          <KpiTile
            label="Trailing 3mo avg"
            value={formatCents(growth.trailing3_avg_cents)}
            sub="Mean monthly revenue"
          />
          <KpiTile
            label="Customer concentration"
            value={`${concentration.toFixed(1)}%`}
            sub="Largest customer share"
          />
          <KpiTile
            label="Cost share"
            value={`${structure.cost_pct.toFixed(1)}%`}
            sub={`${formatCents(structure.cost_cents)} of revenue`}
          />
          <KpiTile
            label="Annualized run rate"
            value={formatCents(runRate.annualized_cents)}
            sub="Trailing 3mo average times 12"
          />
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="font-display text-xl tracking-wide text-ink-dim">
          MARGIN HEALTH
        </h2>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {distribution.map((band) => (
            <div
              key={band.key}
              className={`border bg-bg-2 p-4 ${
                band.key === 'negative' && band.count > 0
                  ? 'border-accent'
                  : 'border-line'
              }`}
            >
              <p className="text-xs uppercase tracking-wider text-ink-dim">
                {band.label}
              </p>
              <p className="mt-1 font-display text-3xl tracking-wide text-ink">
                {band.count}
              </p>
              <p className="mt-1 text-xs text-ink-dim">
                {formatCents(band.revenue_cents)} revenue
              </p>
            </div>
          ))}
        </div>
      </div>

      <ChartCard title="Revenue trend">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={trendData} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
            <CartesianGrid stroke={LINE_FAINT} strokeDasharray="2 4" />
            <XAxis dataKey="month" stroke={INK_DIM} tick={{ fontSize: 11 }} />
            <YAxis
              stroke={INK_DIM}
              tick={{ fontSize: 11 }}
              tickFormatter={axisDollarTick}
              width={64}
            />
            <Tooltip
              contentStyle={{ background: BG_2, border: `1px solid ${LINE_FAINT}` }}
              labelStyle={{ color: '#f5f1e8' }}
              formatter={(value: number) => formatCents(value)}
            />
            <Line
              type="monotone"
              dataKey="revenue"
              name="Revenue"
              stroke={ACCENT}
              strokeWidth={2}
              dot={{ r: 3, fill: ACCENT }}
              activeDot={{ r: 5, fill: ACCENT }}
            />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Top customers by revenue">
        {customersData.length === 0 ? (
          <p className="text-sm text-ink-dim">No paid invoices yet.</p>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={customersData}
              layout="vertical"
              margin={{ top: 8, right: 16, bottom: 8, left: 8 }}
            >
              <CartesianGrid stroke={LINE_FAINT} strokeDasharray="2 4" />
              <XAxis
                type="number"
                stroke={INK_DIM}
                tick={{ fontSize: 11 }}
                tickFormatter={axisDollarTick}
              />
              <YAxis
                type="category"
                dataKey="name"
                stroke={INK_DIM}
                tick={{ fontSize: 11 }}
                width={140}
              />
              <Tooltip
                contentStyle={{ background: BG_2, border: `1px solid ${LINE_FAINT}` }}
                labelStyle={{ color: '#f5f1e8' }}
                formatter={(value: number) => formatCents(value)}
              />
              <Bar dataKey="revenue" name="Revenue" fill={NAVY}>
                {customersData.map((_, i) => (
                  <Cell key={i} fill={i === 0 ? ACCENT : NAVY} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      {contribution.length > 0 ? (
        <div className="border border-line bg-bg-2 p-4 flex flex-col gap-3">
          <h2 className="font-display text-xl tracking-wide text-ink">
            Customer contribution
          </h2>
          <p className="text-xs text-ink-dim">
            Revenue share of each top customer, with a running cumulative total.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-ink-dim">
                  <th className="py-2 pr-4 font-sans font-normal">Customer</th>
                  <th className="py-2 pr-4 text-right font-sans font-normal">Revenue</th>
                  <th className="py-2 pr-4 text-right font-sans font-normal">Share</th>
                  <th className="py-2 text-right font-sans font-normal">Cumulative</th>
                </tr>
              </thead>
              <tbody>
                {contribution.map((row) => (
                  <tr key={row.customer_id} className="border-b border-line/40">
                    <td className="py-2 pr-4 text-ink">
                      {row.customer_name || row.customer_id.slice(0, 8)}
                    </td>
                    <td className="py-2 pr-4 text-right text-ink-dim">
                      {formatCents(row.revenue_cents)}
                    </td>
                    <td className="py-2 pr-4 text-right text-ink-dim">
                      {row.share_pct.toFixed(1)}%
                    </td>
                    <td className="py-2 text-right font-display tracking-wide text-ink">
                      {row.cumulative_pct.toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <ChartCard title="Project margins">
        {marginsData.length === 0 ? (
          <p className="text-sm text-ink-dim">No project revenue yet.</p>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={marginsData}
              margin={{ top: 8, right: 16, bottom: 24, left: 8 }}
            >
              <CartesianGrid stroke={LINE_FAINT} strokeDasharray="2 4" />
              <XAxis
                dataKey="name"
                stroke={INK_DIM}
                tick={{ fontSize: 11 }}
                angle={-20}
                textAnchor="end"
                interval={0}
                height={50}
              />
              <YAxis
                stroke={INK_DIM}
                tick={{ fontSize: 11 }}
                tickFormatter={axisDollarTick}
                width={64}
              />
              <Tooltip
                contentStyle={{ background: BG_2, border: `1px solid ${LINE_FAINT}` }}
                labelStyle={{ color: '#f5f1e8' }}
                formatter={(value: number, name: string) =>
                  name === 'Margin %' ? `${value.toFixed(1)}%` : formatCents(value)
                }
              />
              <Legend wrapperStyle={{ color: INK_DIM, fontSize: 11 }} />
              <Bar dataKey="revenue" name="Revenue" fill={NAVY} />
              <Bar dataKey="cost" name="Cost" fill={ACCENT} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      {marginRows.length > 0 ? (
        <div className="border border-line bg-bg-2 p-4 flex flex-col gap-3">
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-col gap-1">
              <h2 className="font-display text-xl tracking-wide text-ink">
                Project margin detail
              </h2>
              <p className="text-xs text-ink-dim">
                Sorted by margin health. Thinnest and negative margins first.
              </p>
            </div>
            <button
              type="button"
              onClick={downloadMarginsCsv}
              className="shrink-0 border border-line px-3 py-2 text-xs uppercase tracking-wider text-ink-dim transition-colors hover:border-accent hover:text-ink"
            >
              Download CSV
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-ink-dim">
                  <th className="py-2 pr-4 font-sans font-normal">Project</th>
                  <th className="py-2 pr-4 text-right font-sans font-normal">Revenue</th>
                  <th className="py-2 pr-4 text-right font-sans font-normal">Cost</th>
                  <th className="py-2 pr-4 text-right font-sans font-normal">Margin</th>
                  <th className="py-2 text-right font-sans font-normal">Margin %</th>
                </tr>
              </thead>
              <tbody>
                {marginRows.map((row) => {
                  const thin = row.margin_pct < 15;
                  return (
                    <tr key={row.project_id} className="border-b border-line/40">
                      <td className="py-2 pr-4 text-ink">
                        {row.project_name || row.project_id.slice(0, 8)}
                      </td>
                      <td className="py-2 pr-4 text-right text-ink-dim">
                        {formatCents(row.revenue_cents)}
                      </td>
                      <td className="py-2 pr-4 text-right text-ink-dim">
                        {formatCents(row.cost_cents)}
                      </td>
                      <td className="py-2 pr-4 text-right text-ink-dim">
                        {formatCents(row.margin_cents)}
                      </td>
                      <td
                        className={`py-2 text-right font-display tracking-wide ${
                          thin ? 'text-accent' : 'text-ink'
                        }`}
                      >
                        {row.margin_pct.toFixed(1)}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </section>
  );
}
