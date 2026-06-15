// Regression suite for Wave 12 / A7 step 3: migration 0104 the
// view_job_profitability read model. One row per non-deleted job_run: estimate
// (project budget) vs actual (posted daily-log labor + consumed material cost) vs
// billed revenue (the project's non-cancelled invoices), with margin. Static
// content checks; validated on staging during the A7 build (the view returned the
// expected estimate / actual / revenue / margin row for the seeded run).

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const sql = readFileSync(
  join(__dirname, '..', '..', '..', '..', 'supabase', 'migrations', '0104_job_profitability_view.sql'),
  'utf8',
);

describe('migration 0104: job profitability view (A7)', () => {
  it('creates the view with security_invoker = true (RLS inherited from base tables)', () => {
    expect(sql).toMatch(/create or replace view public\.view_job_profitability\s*with \(security_invoker = true\)/i);
  });

  it('exposes the estimate / actual / revenue / margin _cents columns keyed by job_run', () => {
    expect(sql).toMatch(/jr\.id as job_run_id/i);
    expect(sql).toMatch(/coalesce\(p\.budget_cents, 0\) as estimate_total_cents/i);
    expect(sql).toMatch(/as actual_labor_cents/i);
    expect(sql).toMatch(/as actual_material_cents/i);
    expect(sql).toMatch(/as actual_total_cents/i);
    expect(sql).toMatch(/as billed_revenue_cents/i);
    expect(sql).toMatch(/as margin_cents/i);
  });

  it('actuals sum only POSTED daily-log labor and consumed material', () => {
    expect(sql).toMatch(/dl\.labor_hours \* coalesce\(dl\.labor_rate_cents, 0\)/i);
    expect(sql).toMatch(/cli\.quantity \* coalesce\(cli\.unit_cost_cents, 0\)/i);
    expect(sql).toMatch(/dl\.status = 'posted'/i);
  });

  it('revenue is keyed by invoices.project_id excluding cancelled + deleted (no daily-log fan-out)', () => {
    const rev = sql.match(/select sum\(i\.total_cents\)[\s\S]*?from public\.invoices i[\s\S]*?i\.deleted_at is null/i)?.[0];
    expect(rev).toBeTruthy();
    expect(rev!).toMatch(/i\.project_id = jr\.project_id/i);
    expect(rev!).toMatch(/i\.status <> 'cancelled'/i);
    expect(rev!).toMatch(/i\.deleted_at is null/i);
  });

  it('only includes non-deleted job_runs and grants SELECT to authenticated', () => {
    expect(sql).toMatch(/from public\.job_runs jr[\s\S]*?where jr\.deleted_at is null/i);
    expect(sql).toMatch(/grant select on public\.view_job_profitability to authenticated/i);
    // no SECURITY DEFINER wrapper for the view. Strip SQL line comments first so
    // the header prose (which explains the security_invoker-over-definer choice)
    // does not trip the assertion; the check is on the DDL only.
    const sqlDdl = sql.replace(/^\s*--.*$/gm, '');
    expect(sqlDdl).not.toMatch(/security definer/i);
  });
});
