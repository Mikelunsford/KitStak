// Regression suite for Wave 12 / A6 step 2 — migration 0099 job_run_daily_logs,
// the consumed / produced line tables, and the post_job_run_daily_log emit RPC.
// Posting a draft log emits production_consumed / production_produced
// stock_movements from the line tables, reusing the existing 0030 movement types.
//
// Static content checks. The post path was validated on staging in an aborting
// transaction during the A6 build: a daily log with a consumed line (qty 10) and
// a produced line (qty 4, plus a null-item produced line) posted to on_hand -10
// and +4 (the null-item line skipped), a re-post did not double-emit, and a
// cross-tenant caller surfaced NOT_FOUND.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const sql = readFileSync(
  join(__dirname, '..', '..', '..', '..', 'supabase', 'migrations', '0099_job_run_daily_logs.sql'),
  'utf8',
);

describe('migration 0099 — job run daily logs + emit RPC (A6)', () => {
  it('creates job_run_daily_logs with the draft / posted FSM and denormalised org_id', () => {
    const t = sql.match(/create table if not exists public\.job_run_daily_logs \([\s\S]*?\);/)?.[0];
    expect(t).toBeTruthy();
    expect(t!).toMatch(/org_id uuid not null references public\.organizations\(id\) on delete cascade/i);
    expect(t!).toMatch(/job_run_id uuid not null references public\.job_runs\(id\) on delete cascade/i);
    expect(t!).toMatch(/status text not null default 'draft'[\s\S]*?check \(status in \('draft', 'posted'\)\)/i);
    expect(t!).toMatch(/labor_rate_cents bigint/i);
    expect(t!).toMatch(/kitforce_time_entry_id uuid/i);
  });

  it('consumed line item_id is REQUIRED; produced line item_id is NULLABLE', () => {
    const consumed = sql.match(/create table if not exists public\.job_run_daily_log_consumed_line_items \([\s\S]*?\);/)?.[0];
    const produced = sql.match(/create table if not exists public\.job_run_daily_log_produced_line_items \([\s\S]*?\);/)?.[0];
    expect(consumed!).toMatch(/item_id uuid not null references public\.items\(id\)/i);
    expect(produced!).toMatch(/item_id uuid references public\.items\(id\)/i);
    expect(produced!).not.toMatch(/item_id uuid not null/i);
    // both denormalise org_id for Pattern A RLS
    expect(consumed!).toMatch(/org_id uuid not null references public\.organizations\(id\) on delete cascade/i);
    expect(produced!).toMatch(/org_id uuid not null references public\.organizations\(id\) on delete cascade/i);
  });

  it('enables Pattern A RLS on all three tables gated to the 3PL commercial roles', () => {
    for (const tbl of ['job_run_daily_logs', 'job_run_daily_log_consumed_line_items', 'job_run_daily_log_produced_line_items']) {
      expect(sql, tbl).toMatch(new RegExp(`alter table public\\.${tbl} enable row level security`, 'i'));
    }
    const writes = sql.match(/create policy job_run_daily_log[a-z_]*_write[\s\S]*?with check \([\s\S]*?\);/g) ?? [];
    expect(writes.length).toBe(3);
    for (const w of writes) {
      expect(w).toMatch(/current_user_role\(\) in \('org_owner', 'org_admin', 'ops', 'sales'\)/i);
    }
  });

  it('extends the audit_log entity_type CHECK with the three daily-log types (superset of 0098)', () => {
    const check = sql.match(/add constraint audit_log_entity_type_check[\s\S]*?\)\);/)?.[0];
    for (const t of [
      'job_run_daily_log',
      'job_run_daily_log_consumed_line_item',
      'job_run_daily_log_produced_line_item',
    ]) {
      expect(check!).toContain(`'${t}'`);
    }
    // still a superset: job_run (0098) and the prior list survive
    expect(check!).toContain("'job_run'");
    expect(check!).toContain("'supply_plan'");
  });

  it('post_job_run_daily_log emits consumed / produced movements reusing the 0030 types', () => {
    const fn = sql.match(/create or replace function public\.post_job_run_daily_log[\s\S]*?\$\$;/)?.[0];
    expect(fn).toBeTruthy();
    // reuses existing 0030 production movement types; no new ledger type
    expect(fn!).toMatch(/'production_consumed'/);
    expect(fn!).toMatch(/'production_produced'/);
    expect(fn!).toMatch(/source_entity_type/i);
    expect(fn!).toMatch(/'job_run_daily_log', p_log_id/);
    // produced side skips descriptive-only (null item_id) lines
    expect(fn!).toMatch(/and li\.item_id is not null/i);
    // only emits when the run has a warehouse
    expect(fn!).toMatch(/if v_warehouse_id is not null then/i);
    // draft -> posted, idempotent on an already-posted log
    expect(fn!).toMatch(/return p_log_id; -- idempotent/i);
    expect(fn!).toMatch(/set status = 'posted', posted_at = now\(\)/i);
    // 3-arg cross-tenant guard, NOT_FOUND never 403
    expect(fn!).toMatch(/v_org_id is null or v_org_id <> p_caller_org_id/i);
    expect(fn!).toMatch(/NOT_FOUND/);
    expect(fn!).not.toMatch(/FORBIDDEN/);
    // the parent join is org-pinned (defense in depth on warehouse_id read)
    expect(fn!).toMatch(/join public\.job_runs jr on jr\.id = dl\.job_run_id and jr\.org_id = dl\.org_id/i);
  });

  it('grants post_job_run_daily_log to authenticated + service_role only', () => {
    expect(sql).toMatch(/revoke execute on function public\.post_job_run_daily_log\(uuid, uuid, uuid\)\s*from public, anon/i);
    expect(sql).toMatch(/grant execute on function public\.post_job_run_daily_log\(uuid, uuid, uuid\)\s*to authenticated, service_role/i);
  });
});
