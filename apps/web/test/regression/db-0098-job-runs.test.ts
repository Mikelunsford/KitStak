// Regression suite for Wave 12 / A6 step 1 — migration 0098 job_runs plus the
// four FSM transition RPCs (start / complete / close / cancel). job_runs is the
// floor-execution header; daily logs (0099) carry the stock-affecting actuals.
//
// Static content checks. The transition RPCs were validated on staging in an
// aborting transaction during the A6 build: a planned run started, completed,
// and closed in order, and a cross-tenant caller surfaced NOT_FOUND.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const sql = readFileSync(
  join(__dirname, '..', '..', '..', '..', 'supabase', 'migrations', '0098_job_runs.sql'),
  'utf8',
);

describe('migration 0098 — job runs + FSM transition RPCs (A6)', () => {
  it('creates job_runs with the five-state FSM and the spine refs', () => {
    const t = sql.match(/create table if not exists public\.job_runs \([\s\S]*?\);/)?.[0];
    expect(t).toBeTruthy();
    expect(t!).toMatch(/status text not null default 'planned'[\s\S]*?check \(status in \('planned', 'in_progress', 'completed', 'closed', 'cancelled'\)\)/i);
    expect(t!).toMatch(/project_id uuid references public\.projects\(id\) on delete set null/i);
    expect(t!).toMatch(/account_id uuid references public\.three_pl_accounts\(id\) on delete set null/i);
    expect(t!).toMatch(/job_template_id uuid references public\.job_templates\(id\) on delete set null/i);
    expect(t!).toMatch(/job_template_snapshot jsonb/i);
    expect(t!).toMatch(/warehouse_id uuid references public\.warehouses\(id\)/i);
  });

  it('enables Pattern A RLS on job_runs gated to the 3PL commercial roles', () => {
    expect(sql).toMatch(/alter table public\.job_runs enable row level security/i);
    const write = sql.match(/create policy job_runs_write[\s\S]*?with check \([\s\S]*?\);/)?.[0];
    expect(write!).toMatch(/current_user_role\(\) in \('org_owner', 'org_admin', 'ops', 'sales'\)/i);
  });

  it('extends the audit_log entity_type CHECK with job_run (superset of 0096)', () => {
    const check = sql.match(/add constraint audit_log_entity_type_check[\s\S]*?\)\);/)?.[0];
    expect(check!).toContain("'job_run'");
    // still a superset of the prior list
    expect(check!).toContain("'supply_plan'");
    expect(check!).toContain("'supply_plan_line'");
    expect(check!).toContain("'job_template_line'");
  });

  it('audits job_runs as an FSM (from_state -> to_state on transition)', () => {
    const fn = sql.match(/create or replace function public\.trg_audit_job_runs[\s\S]*?\$\$;/)?.[0];
    expect(fn!).toMatch(/v_from := old\.status; v_to := new\.status/i);
    expect(fn!).toMatch(/audit_append_state_change\(\s*v_org_id, 'job_run', v_entity_id, v_from, v_to/i);
  });

  it('each transition RPC is the 3-arg cross-tenant pattern, idempotent, with a state guard', () => {
    for (const f of ['start_job_run', 'complete_job_run', 'close_job_run', 'cancel_job_run']) {
      const fn = sql.match(new RegExp(`create or replace function public\\.${f}[\\s\\S]*?\\$\\$;`))?.[0];
      expect(fn, f).toBeTruthy();
      expect(fn!, f).toMatch(/v_org_id is null or v_org_id <> p_caller_org_id/i);
      expect(fn!, f).toMatch(/NOT_FOUND/);
      expect(fn!, f).not.toMatch(/FORBIDDEN/);
      expect(fn!, f).toMatch(/STATE_CONFLICT/);
      expect(fn!, f).toMatch(/return p_run_id; -- idempotent/i);
    }
  });

  it('the transitions stamp the paired <state>_at column', () => {
    expect(sql).toMatch(/set status = 'in_progress', started_at = now\(\)/i);
    expect(sql).toMatch(/set status = 'completed', completed_at = now\(\)/i);
    expect(sql).toMatch(/set status = 'closed', closed_at = now\(\)/i);
    expect(sql).toMatch(/set status = 'cancelled', cancelled_at = now\(\)/i);
  });

  it('cancel is allowed only from planned or in_progress', () => {
    const fn = sql.match(/create or replace function public\.cancel_job_run[\s\S]*?\$\$;/)?.[0];
    expect(fn!).toMatch(/v_status not in \('planned', 'in_progress'\)/i);
  });

  it('grants the transition RPCs to authenticated + service_role only', () => {
    for (const f of ['start_job_run', 'complete_job_run', 'close_job_run', 'cancel_job_run']) {
      expect(sql).toMatch(new RegExp(`revoke execute on function public\\.${f}\\(uuid, uuid, uuid\\)\\s*from public, anon`, 'i'));
      expect(sql).toMatch(new RegExp(`grant execute on function public\\.${f}\\(uuid, uuid, uuid\\)\\s*to authenticated, service_role`, 'i'));
    }
  });
});
