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

// ---------------------------------------------------------------------------
// C2 reporting depth. Further derived views over the same KitCostSummary
// payload. Still no new schema and no new endpoint. Integer-cents summation,
// display-only ratios.
// ---------------------------------------------------------------------------

export interface CostStructure {
  revenue_cents: number;
  cost_cents: number;
  margin_cents: number;
  /** Cost as a percentage of revenue, one decimal. 0 when revenue is 0. */
  cost_pct: number;
  /** Margin as a percentage of revenue, one decimal. 0 when revenue is 0. */
  margin_pct: number;
}

/**
 * Where the revenue dollar goes across the reported projects: the blended
 * split between cost and margin. Reuses blendedMargin for the integer-cents
 * roll-up, then expresses cost as a share of revenue.
 */
export function costStructure(rows: ProjectMargins): CostStructure {
  const b = blendedMargin(rows);
  const cost_pct =
    b.revenue_cents === 0 ? 0 : Math.round((b.cost_cents / b.revenue_cents) * 1000) / 10;
  return {
    revenue_cents: b.revenue_cents,
    cost_cents: b.cost_cents,
    margin_cents: b.margin_cents,
    cost_pct,
    margin_pct: b.margin_pct,
  };
}

export type MarginBandKey = 'negative' | 'thin' | 'healthy' | 'strong';

export interface MarginBand {
  key: MarginBandKey;
  label: string;
  count: number;
  revenue_cents: number;
}

const BAND_THIN_MAX = 15;
const BAND_HEALTHY_MAX = 30;

/**
 * Bucket projects into four margin-health bands by margin percentage, with a
 * count and a revenue total per band. Returns the bands in a fixed order from
 * negative through strong, so the caller can render a stable strip.
 */
export function marginDistribution(rows: ProjectMargins): MarginBand[] {
  const bands: Record<MarginBandKey, MarginBand> = {
    negative: { key: 'negative', label: 'Negative', count: 0, revenue_cents: 0 },
    thin: { key: 'thin', label: 'Thin (under 15%)', count: 0, revenue_cents: 0 },
    healthy: { key: 'healthy', label: 'Healthy (15 to 30%)', count: 0, revenue_cents: 0 },
    strong: { key: 'strong', label: 'Strong (30% and up)', count: 0, revenue_cents: 0 },
  };
  for (const row of rows) {
    const pct = row.margin_pct;
    let key: MarginBandKey;
    if (pct < 0) key = 'negative';
    else if (pct < BAND_THIN_MAX) key = 'thin';
    else if (pct < BAND_HEALTHY_MAX) key = 'healthy';
    else key = 'strong';
    bands[key].count += 1;
    bands[key].revenue_cents += toCents(row.revenue_cents);
  }
  return [bands.negative, bands.thin, bands.healthy, bands.strong];
}

export interface RevenueRunRate {
  /** Trailing-three-month average revenue, cents. */
  trailing3_avg_cents: number;
  /** Annualized run rate: the trailing-three-month average times twelve. */
  annualized_cents: number;
}

/**
 * Annualized revenue run rate, derived from the trailing-three-month average.
 * A forward-looking SMB signal. Integer cents throughout (avg times twelve is
 * exact).
 */
export function revenueRunRate(trend: RevenueTrend): RevenueRunRate {
  const g = revenueGrowth(trend);
  return {
    trailing3_avg_cents: g.trailing3_avg_cents,
    annualized_cents: g.trailing3_avg_cents * 12,
  };
}

export interface CustomerShare {
  customer_id: string;
  customer_name: string;
  revenue_cents: number;
  /** Share of reported top-customer revenue, percent, one decimal. */
  share_pct: number;
  /** Running cumulative share through this row, percent, one decimal. */
  cumulative_pct: number;
}

/**
 * Per-customer revenue share with a running cumulative total, a Pareto view of
 * the top customers. Preserves input order, which the summary endpoint emits
 * descending by revenue, so the cumulative column reads top-down.
 */
export function customerContribution(customers: TopCustomers): CustomerShare[] {
  const rows = customers.map((c) => ({
    customer_id: c.customer_id,
    customer_name: c.customer_name,
    revenue_cents: toCents(c.revenue_cents),
  }));
  let total = 0;
  for (const r of rows) total += r.revenue_cents;
  let running = 0;
  return rows.map((r) => {
    running += r.revenue_cents;
    const share_pct = total === 0 ? 0 : Math.round((r.revenue_cents / total) * 1000) / 10;
    const cumulative_pct = total === 0 ? 0 : Math.round((running / total) * 1000) / 10;
    return { ...r, share_pct, cumulative_pct };
  });
}

// ---- CSV export (pure serializer; the DOM download lives in the page). ----

function csvCell(value: string): string {
  // RFC 4180: quote a cell that contains a comma, quote, or line break, and
  // escape embedded quotes by doubling them.
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function centsToPlainDollars(cents: number): string {
  // Display-only decimal dollars with no symbol or thousands separator, so the
  // value imports cleanly into a spreadsheet. Integer arithmetic only; the
  // monetary roll-up upstream stays in cents.
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const whole = Math.trunc(abs / 100);
  const frac = abs % 100;
  return `${sign}${whole}.${frac.toString().padStart(2, '0')}`;
}

/**
 * Serialize project margin rows to RFC 4180 CSV with a header row. Money
 * columns are plain decimal dollars; the margin percentage keeps one decimal.
 */
export function marginsToCsv(rows: MarginRow[]): string {
  const header = ['Project', 'Revenue', 'Cost', 'Margin', 'Margin %'];
  const lines = [header.join(',')];
  for (const row of rows) {
    const cells = [
      csvCell(row.project_name || row.project_id),
      centsToPlainDollars(row.revenue_cents),
      centsToPlainDollars(row.cost_cents),
      centsToPlainDollars(row.margin_cents),
      row.margin_pct.toFixed(1),
    ];
    lines.push(cells.join(','));
  }
  return lines.join('\r\n');
}
