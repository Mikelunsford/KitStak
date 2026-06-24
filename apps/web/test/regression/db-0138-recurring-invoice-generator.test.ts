// Regression for ADR 0005 Phase 2: the recurring-invoice generator (migration
// 0138). A recurring_schedules table (RLS Pattern A) + generate_recurring_invoices
// (SECURITY DEFINER, service_role only) + a daily pg_cron job. The generator
// drafts an invoice from each due project's monthly lines (banker's-rounded math,
// monthly only) and advances next_run_on one month (idempotent per period).
//
// Like db-0137 this asserts the migration SQL; the functional behaviour (monthly
// lines only, money math, schedule advance, idempotent re-run) was validated on
// staging in an aborting transaction during the build.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const sql = readFileSync(
  join(
    __dirname, '..', '..', '..', '..',
    'supabase', 'migrations', '0138_recurring_invoice_generator.sql',
  ),
  'utf8',
);

describe('migration 0138 - recurring-invoice generator (ADR 0005 Phase 2)', () => {
  it('creates recurring_schedules with RLS Pattern A (org_id select, finance-role write)', () => {
    expect(sql).toMatch(/create table if not exists public\.recurring_schedules/i);
    expect(sql).toMatch(/project_id uuid not null references public\.projects/i);
    expect(sql).toMatch(/next_run_on date not null/i);
    expect(sql).toMatch(
      /status text not null default 'active' check \(status in \('active', 'paused', 'ended'\)\)/i,
    );
    expect(sql).toMatch(/alter table public\.recurring_schedules enable row level security/i);
    expect(sql).toMatch(
      /create policy recurring_schedules_select[\s\S]*org_id = public\.current_org_id\(\)/i,
    );
    expect(sql).toMatch(
      /create policy recurring_schedules_write[\s\S]*current_user_role\(\) in \('org_owner', 'org_admin', 'accounting'\)/i,
    );
  });

  it('defines generate_recurring_invoices(date) as SECURITY DEFINER, service_role only', () => {
    expect(sql).toMatch(
      /create or replace function public\.generate_recurring_invoices\(\s*p_today date default current_date\s*\)/i,
    );
    expect(sql).toMatch(/security definer/i);
    expect(sql).toMatch(
      /revoke execute on function public\.generate_recurring_invoices\(date\)\s+from public, anon, authenticated/i,
    );
    expect(sql).toMatch(
      /grant execute on function public\.generate_recurring_invoices\(date\)\s+to service_role/i,
    );
    expect(sql).not.toMatch(
      /grant execute on function public\.generate_recurring_invoices\(date\)[^;]*authenticated/i,
    );
  });

  it('bills only monthly lines with the banker-rounded invoice math, then recomputes', () => {
    expect(sql).toMatch(/where status = 'active' and next_run_on <= p_today/i);
    expect(sql).toMatch(/pli\.billing_interval = 'monthly'/i);
    expect(sql).toMatch(/public\.round_half_even/i);
    expect(sql).toMatch(/perform public\.recompute_invoice_totals\(v_invoice_id\)/i);
  });

  it('advances next_run_on one month for idempotency per period', () => {
    expect(sql).toMatch(/next_run_on = \(next_run_on \+ interval '1 month'\)::date/i);
  });

  it('schedules a daily pg_cron job (upsert on jobname)', () => {
    expect(sql).toMatch(/create extension if not exists pg_cron/i);
    expect(sql).toMatch(/cron\.schedule\(\s*'generate-recurring-invoices',\s*'0 6 \* \* \*'/i);
  });

  it('declares the constitutional header', () => {
    expect(sql).toMatch(/Migration:\s*0138_/);
    expect(sql).toMatch(/Wave:.*ADR 0005/i);
    expect(sql).toMatch(/DOWN MIGRATION/);
    expect(sql).toMatch(/Idempotency/);
    expect(sql).toMatch(/RLS rules/);
  });
});
