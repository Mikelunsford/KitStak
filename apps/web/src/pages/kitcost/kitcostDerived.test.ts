// Unit coverage for the KitCost derived reporting metrics (C1, Option A).
// Pure functions over the read-only KitCostSummary payload. The wire carries
// monetary fields as BIGINT cents (number | string), so each case mixes both
// forms to lock in toCents coercion.

import { describe, expect, it } from 'vitest';

import type { KitCostSummary } from '@/lib/types/cross_cutting';

import {
  blendedMargin,
  customerConcentration,
  marginsByHealth,
  revenueGrowth,
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
