// Unit coverage for the KitCost derived reporting metrics (C1, Option A).
// Pure functions over the read-only KitCostSummary payload. The wire carries
// monetary fields as BIGINT cents (number | string), so each case mixes both
// forms to lock in toCents coercion.

import { describe, expect, it } from 'vitest';

import type { KitCostSummary } from '@/lib/types/cross_cutting';

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

type ProjectMargins = KitCostSummary['project_margins'];
type RevenueTrend = KitCostSummary['revenue_trend'];
type TopCustomers = KitCostSummary['top_customers'];

function margin(
  id: string,
  revenue_cents: number | string,
  cost_cents: number | string,
  margin_cents: number | string,
  margin_pct: number,
): ProjectMargins[number] {
  return {
    project_id: id,
    project_name: `Project ${id}`,
    revenue_cents,
    cost_cents,
    margin_cents,
    margin_pct,
  };
}

describe('blendedMargin', () => {
  it('sums revenue, cost, and margin in integer cents across rows', () => {
    const rows: ProjectMargins = [
      margin('a', 100_000, 60_000, 40_000, 40),
      margin('b', '50000', '45000', '5000', 10),
    ];

    const result = blendedMargin(rows);

    expect(result.revenue_cents).toBe(150_000);
    expect(result.cost_cents).toBe(105_000);
    expect(result.margin_cents).toBe(45_000);
    // 45000 / 150000 = 30.0%
    expect(result.margin_pct).toBe(30);
  });

  it('rounds the blended percentage to one decimal', () => {
    const rows: ProjectMargins = [margin('a', 30_000, 20_000, 10_000, 33.33)];
    // 10000 / 30000 = 0.3333... -> 33.3%
    expect(blendedMargin(rows).margin_pct).toBe(33.3);
  });

  it('returns zeros with a 0% margin when there are no rows', () => {
    const result = blendedMargin([]);
    expect(result).toEqual({
      revenue_cents: 0,
      cost_cents: 0,
      margin_cents: 0,
      margin_pct: 0,
    });
  });

  it('guards divide-by-zero when revenue is zero', () => {
    const rows: ProjectMargins = [margin('a', 0, 5_000, -5_000, -100)];
    expect(blendedMargin(rows).margin_pct).toBe(0);
  });
});

describe('revenueGrowth', () => {
  function point(month: string, revenue_cents: number | string): RevenueTrend[number] {
    return { month, revenue_cents };
  }

  it('returns the empty shape for an empty trend', () => {
    expect(revenueGrowth([])).toEqual({
      mom_pct: null,
      trailing3_avg_cents: 0,
      best: null,
      worst: null,
    });
  });

  it('derives month-over-month growth from the last two months', () => {
    const trend: RevenueTrend = [
      point('2026-01', 100_000),
      point('2026-02', '125000'),
    ];
    // (125000 - 100000) / 100000 = 25.0%
    expect(revenueGrowth(trend).mom_pct).toBe(25);
  });

  it('returns null mom_pct when only one month is reported', () => {
    expect(revenueGrowth([point('2026-01', 100_000)]).mom_pct).toBeNull();
  });

  it('returns null mom_pct when the prior month is zero', () => {
    const trend: RevenueTrend = [point('2026-01', 0), point('2026-02', 50_000)];
    expect(revenueGrowth(trend).mom_pct).toBeNull();
  });

  it('averages only the trailing three months', () => {
    const trend: RevenueTrend = [
      point('2026-01', 10_000),
      point('2026-02', 20_000),
      point('2026-03', 30_000),
      point('2026-04', 60_000),
    ];
    // tail = [20000, 30000, 60000] -> 110000 / 3 = 36666.67 -> rounds to 36667
    expect(revenueGrowth(trend).trailing3_avg_cents).toBe(36_667);
  });

  it('identifies the best and worst reported months', () => {
    const trend: RevenueTrend = [
      point('2026-01', 40_000),
      point('2026-02', '90000'),
      point('2026-03', 15_000),
    ];
    const result = revenueGrowth(trend);
    expect(result.best).toEqual({ month: '2026-02', revenue_cents: 90_000 });
    expect(result.worst).toEqual({ month: '2026-03', revenue_cents: 15_000 });
  });
});

describe('customerConcentration', () => {
  function customer(id: string, revenue_cents: number | string): TopCustomers[number] {
    return { customer_id: id, customer_name: `Customer ${id}`, revenue_cents };
  }

  it('returns the largest customer share as a percentage', () => {
    const customers: TopCustomers = [
      customer('a', 70_000),
      customer('b', '30000'),
    ];
    // top 70000 / total 100000 = 70.0%
    expect(customerConcentration(customers)).toBe(70);
  });

  it('returns 0 when there are no customers', () => {
    expect(customerConcentration([])).toBe(0);
  });

  it('returns 0 when total revenue is zero', () => {
    const customers: TopCustomers = [customer('a', 0), customer('b', 0)];
    expect(customerConcentration(customers)).toBe(0);
  });
});

describe('marginsByHealth', () => {
  it('sorts rows ascending by margin percentage so thin margins surface first', () => {
    const rows: ProjectMargins = [
      margin('a', 100_000, 50_000, 50_000, 50),
      margin('b', 100_000, 95_000, 5_000, 5),
      margin('c', 100_000, 110_000, -10_000, -10),
    ];

    const result = marginsByHealth(rows);

    expect(result.map((r) => r.project_id)).toEqual(['c', 'b', 'a']);
    expect(result[0]?.margin_pct).toBe(-10);
  });

  it('coerces wire cents to numbers without mutating the input', () => {
    const rows: ProjectMargins = [margin('a', '100000', '60000', '40000', 40)];
    const result = marginsByHealth(rows);

    expect(result[0]?.revenue_cents).toBe(100_000);
    expect(result[0]?.cost_cents).toBe(60_000);
    expect(result[0]?.margin_cents).toBe(40_000);
    // input row untouched (still the original string form)
    expect(rows[0]?.revenue_cents).toBe('100000');
  });

  it('returns an empty array for empty input', () => {
    expect(marginsByHealth([])).toEqual([]);
  });
});

describe('costStructure', () => {
  it('splits revenue into cost and margin shares', () => {
    const rows: ProjectMargins = [
      margin('a', 100_000, 60_000, 40_000, 40),
      margin('b', '100000', '80000', '20000', 20),
    ];

    const result = costStructure(rows);

    expect(result.revenue_cents).toBe(200_000);
    expect(result.cost_cents).toBe(140_000);
    expect(result.margin_cents).toBe(60_000);
    // 140000 / 200000 = 70.0%, 60000 / 200000 = 30.0%
    expect(result.cost_pct).toBe(70);
    expect(result.margin_pct).toBe(30);
  });

  it('guards divide-by-zero when revenue is zero', () => {
    const rows: ProjectMargins = [margin('a', 0, 5_000, -5_000, -100)];
    const result = costStructure(rows);
    expect(result.cost_pct).toBe(0);
    expect(result.margin_pct).toBe(0);
  });

  it('returns zeros for empty input', () => {
    expect(costStructure([])).toEqual({
      revenue_cents: 0,
      cost_cents: 0,
      margin_cents: 0,
      cost_pct: 0,
      margin_pct: 0,
    });
  });
});

describe('marginDistribution', () => {
  it('buckets projects into the four health bands in fixed order', () => {
    const rows: ProjectMargins = [
      margin('a', 100_000, 110_000, -10_000, -10),
      margin('b', 100_000, 90_000, 10_000, 10),
      margin('c', '100000', '80000', '20000', 20),
      margin('d', 100_000, 50_000, 50_000, 50),
    ];

    const result = marginDistribution(rows);

    expect(result.map((b) => b.key)).toEqual(['negative', 'thin', 'healthy', 'strong']);
    expect(result.map((b) => b.count)).toEqual([1, 1, 1, 1]);
    // each band carries its project's revenue, coerced from the wire form
    expect(result.map((b) => b.revenue_cents)).toEqual([
      100_000, 100_000, 100_000, 100_000,
    ]);
  });

  it('places the band boundaries on the lower edge', () => {
    // 15% lands in healthy, 30% lands in strong, 0% lands in thin
    const rows: ProjectMargins = [
      margin('zero', 100_000, 100_000, 0, 0),
      margin('fifteen', 100_000, 85_000, 15_000, 15),
      margin('thirty', 100_000, 70_000, 30_000, 30),
    ];

    const result = marginDistribution(rows);
    const byKey = Object.fromEntries(result.map((b) => [b.key, b.count]));

    expect(byKey.thin).toBe(1);
    expect(byKey.healthy).toBe(1);
    expect(byKey.strong).toBe(1);
    expect(byKey.negative).toBe(0);
  });

  it('returns four empty bands for empty input', () => {
    const result = marginDistribution([]);
    expect(result.map((b) => b.key)).toEqual(['negative', 'thin', 'healthy', 'strong']);
    expect(result.every((b) => b.count === 0 && b.revenue_cents === 0)).toBe(true);
  });
});

describe('revenueRunRate', () => {
  function point(month: string, revenue_cents: number | string): RevenueTrend[number] {
    return { month, revenue_cents };
  }

  it('annualizes the trailing-three-month average', () => {
    const trend: RevenueTrend = [
      point('2026-01', 10_000),
      point('2026-02', 20_000),
      point('2026-03', 30_000),
    ];
    // trailing3 avg = 60000 / 3 = 20000; annualized = 20000 * 12 = 240000
    const result = revenueRunRate(trend);
    expect(result.trailing3_avg_cents).toBe(20_000);
    expect(result.annualized_cents).toBe(240_000);
  });

  it('returns zeros for an empty trend', () => {
    expect(revenueRunRate([])).toEqual({
      trailing3_avg_cents: 0,
      annualized_cents: 0,
    });
  });
});

describe('customerContribution', () => {
  function customer(id: string, revenue_cents: number | string): TopCustomers[number] {
    return { customer_id: id, customer_name: `Customer ${id}`, revenue_cents };
  }

  it('computes per-customer share and a running cumulative share', () => {
    const customers: TopCustomers = [
      customer('a', 50_000),
      customer('b', '30000'),
      customer('c', 20_000),
    ];

    const result = customerContribution(customers);

    expect(result.map((r) => r.share_pct)).toEqual([50, 30, 20]);
    expect(result.map((r) => r.cumulative_pct)).toEqual([50, 80, 100]);
    // input order preserved (the endpoint emits descending revenue)
    expect(result.map((r) => r.customer_id)).toEqual(['a', 'b', 'c']);
  });

  it('returns an empty array for empty input', () => {
    expect(customerContribution([])).toEqual([]);
  });

  it('reports 0% shares when total revenue is zero', () => {
    const customers: TopCustomers = [customer('a', 0), customer('b', 0)];
    const result = customerContribution(customers);
    expect(result.every((r) => r.share_pct === 0 && r.cumulative_pct === 0)).toBe(true);
  });
});

describe('marginsToCsv', () => {
  it('writes a header and one row per project in plain decimal dollars', () => {
    const rows = marginsByHealth([
      margin('a', 100_000, 60_000, 40_000, 40),
    ]);

    const csv = marginsToCsv(rows);

    expect(csv).toBe(
      ['Project,Revenue,Cost,Margin,Margin %', 'Project a,1000.00,600.00,400.00,40.0'].join(
        '\r\n',
      ),
    );
  });

  it('quotes and escapes fields containing commas or quotes', () => {
    const rows = marginsByHealth([
      { ...margin('a', 100_000, 60_000, 40_000, 40), project_name: 'Acme, "Big" Co' },
    ]);

    const csv = marginsToCsv(rows);
    const dataLine = csv.split('\r\n')[1];

    expect(dataLine?.startsWith('"Acme, ""Big"" Co",')).toBe(true);
  });

  it('renders negative cents with a leading sign and padded fraction', () => {
    const rows = marginsByHealth([margin('a', 0, 5_000, -5_000, -100)]);
    const csv = marginsToCsv(rows);
    const dataLine = csv.split('\r\n')[1];
    // revenue 0.00, cost 50.00, margin -50.00, pct -100.0
    expect(dataLine).toBe('Project a,0.00,50.00,-50.00,-100.0');
  });

  it('returns just the header for no rows', () => {
    expect(marginsToCsv([])).toBe('Project,Revenue,Cost,Margin,Margin %');
  });
});
