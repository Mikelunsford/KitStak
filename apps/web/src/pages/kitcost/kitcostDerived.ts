// KitCost derived reporting metrics. C1 of the KitCost deepening plan
// (Option A: reporting only). Pure functions that derive additional report
// views from the existing read-only KitCostSummary payload. No new schema,
// no new endpoint. The dashboard-api summary RPC stays the single source.
//
// Monetary inputs are BIGINT cents on the wire (number | string). Summation
// stays in integer cents (exact below 2^53, well above any realistic SMB
// total). Percentages are display-only ratios, not money, so plain division
// is correct here. banker's rounding is reserved for monetary math.

import type { KitCostSummary } from '@/lib/types/cross_cutting';

type RevenueTrend = KitCostSummary['revenue_trend'];
type TopCustomers = KitCostSummary['top_customers'];
type ProjectMargins = KitCostSummary['project_margins'];

function toCents(value: number | string): number {
  return typeof value === 'number' ? value : Number(value);
}

export interface BlendedMargin {
  revenue_cents: number;
  cost_cents: number;
  margin_cents: number;
  /** Blended margin percentage, one decimal. 0 when revenue is 0. */
  margin_pct: number;
}

/**
 * Roll the per-project margin rows into one blended figure across the
 * reported projects. Revenue, cost, and margin are summed in integer cents;
 * the blended percentage is margin over revenue.
 */
export function blendedMargin(rows: ProjectMargins): BlendedMargin {
  let revenue = 0;
  let cost = 0;
  let margin = 0;
  for (const row of rows) {
    revenue += toCents(row.revenue_cents);
    cost += toCents(row.cost_cents);
    margin += toCents(row.margin_cents);
  }
  const pct = revenue === 0 ? 0 : Math.round((margin / revenue) * 1000) / 10;
  return {
    revenue_cents: revenue,
    cost_cents: cost,
    margin_cents: margin,
    margin_pct: pct,
  };
}

export interface RevenueGrowth {
  /** Most recent month over the prior month, percent. null when undefined. */
  mom_pct: number | null;
  /** Mean revenue across the trailing three reported months, cents. */
  trailing3_avg_cents: number;
  /** Highest-revenue reported month, or null when the trend is empty. */
  best: { month: string; revenue_cents: number } | null;
  /** Lowest-revenue reported month, or null when the trend is empty. */
  worst: { month: string; revenue_cents: number } | null;
}

/**
 * Derive month-over-month growth, a trailing-three-month average, and the
 * best/worst months from the revenue trend. The trend arrives oldest-first.
 */
export function revenueGrowth(trend: RevenueTrend): RevenueGrowth {
  if (trend.length === 0) {
    return { mom_pct: null, trailing3_avg_cents: 0, best: null, worst: null };
  }

  const series: Array<{ month: string; revenue_cents: number }> = trend.map((p) => ({
    month: p.month,
    revenue_cents: toCents(p.revenue_cents),
  }));

  // The empty-trend early return above guarantees at least one element.
  const last = series[series.length - 1]!;
  const prev = series.length >= 2 ? series[series.length - 2]! : undefined;
  const mom_pct =
    prev && prev.revenue_cents !== 0
      ? Math.round(((last.revenue_cents - prev.revenue_cents) / prev.revenue_cents) * 1000) / 10
      : null;

  const tail = series.slice(-3);
  const tailSum = tail.reduce((acc, p) => acc + p.revenue_cents, 0);
  const trailing3_avg_cents = Math.round(tailSum / tail.length);

  let best = series[0]!;
  let worst = series[0]!;
  for (const p of series) {
    if (p.revenue_cents > best.revenue_cents) best = p;
    if (p.revenue_cents < worst.revenue_cents) worst = p;
  }

  return { mom_pct, trailing3_avg_cents, best, worst };
}

/**
 * Share of the reported top-customer revenue held by the single largest
 * customer, as a percentage. A concentration-risk signal. 0 when there is
 * no reported customer revenue.
 */
export function customerConcentration(customers: TopCustomers): number {
  if (customers.length === 0) return 0;
  let total = 0;
  let top = 0;
  for (const c of customers) {
    const cents = toCents(c.revenue_cents);
    total += cents;
    if (cents > top) top = cents;
  }
  if (total === 0) return 0;
  return Math.round((top / total) * 1000) / 10;
}

export interface MarginRow {
  project_id: string;
  project_name: string;
  revenue_cents: number;
  cost_cents: number;
  margin_cents: number;
  margin_pct: number;
}

/**
 * Project margin rows sorted by margin percentage ascending, so the thinnest
 * and negative margins surface first. Returns a new array; inputs untouched.
 */
export function marginsByHealth(rows: ProjectMargins): MarginRow[] {
  return rows
    .map((row) => ({
      project_id: row.project_id,
      project_name: row.project_name,
      revenue_cents: toCents(row.revenue_cents),
      cost_cents: toCents(row.cost_cents),
      margin_cents: toCents(row.margin_cents),
      margin_pct: row.margin_pct,
    }))
    .sort((a, b) => a.margin_pct - b.margin_pct);
}
