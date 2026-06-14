// Regression suite for Wave 12 / A5 step 2 — migration 0096 supply_plans and
// supply_plan_lines plus the release / cancel reservation RPCs. The release RPC
// reserves min(required, available) per reserve-resolution line by writing 0095
// reserve movements; cancel of a released plan writes reserve_release to restore
// the spine quantity_reserved.
//
// Static content checks. The release / cancel flow was validated on staging in
// an aborting transaction during the A5 build: a plan with line A (required 4,
// available 10) and line B (required 15, available 10) released to reserved 4 /
// shortage 0 and reserved 10 / shortage 5, the spine quantity_reserved tracked
// it, and cancel released both holds back to 0.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const sql = readFileSync(
  join(__dirname, '..', '..', '..', '..', 'supabase', 'migrations', '0096_supply_plans.sql'),
  'utf8',
);

describe('migration 0096 — supply plans + reservation RPCs (A5)', () => {
  it('creates supply_plans with the four-state FSM and warehouse / project refs', () => {
    const t = sql.match(/create table if not exists public\.supply_plans \([\s\S]*?\);/)?.[0];
    expect(t).toBeTruthy();
    expect(t!).toMatch(/status text not null default 'draft'[\s\S]*?check \(status in \('draft', 'released', 'fulfilled', 'cancelled'\)\)/i);
    expect(t!).toMatch(/project_id uuid references public\.projects\(id\) on delete set null/i);
    expect(t!).toMatch(/warehouse_id uuid references public\.warehouses\(id\)/i);
  });

  it('creates supply_plan_lines with denormalised org_id and the resolution enum', () => {
    const t = sql.match(/create table if not exists public\.supply_plan_lines \([\s\S]*?\);/)?.[0];
    expect(t).toBeTruthy();
    expect(t!).toMatch(/org_id uuid not null references public\.organizations\(id\) on delete cascade/i);
    expect(t!).toMatch(/supply_plan_id uuid not null references public\.supply_plans\(id\) on delete cascade/i);
    expect(t!).toMatch(/item_id uuid not null references public\.items\(id\)/i);
    expect(t!).toMatch(/resolution text not null default 'reserve'[\s\S]*?check \(resolution in \('reserve', 'inbound', 'purchase', 'replenish'\)\)/i);
    // nullable manual shortage links, no auto-created orders
    expect(t!).toMatch(/resolved_po_id uuid references public\.purchase_orders\(id\) on delete set null/i);
    expect(t!).toMatch(/resolved_receiving_order_id uuid references public\.receiving_orders\(id\) on delete set null/i);
  });

  it('enables Pattern A RLS on both tables gated to the 3PL commercial roles', () => {
    expect(sql).toMatch(/alter table public\.supply_plans enable row level security/i);
    expect(sql).toMatch(/alter table public\.supply_plan_lines enable row level security/i);
    const writes = sql.match(/create policy supply_plan(?:s|_lines)_write[\s\S]*?with check \([\s\S]*?\);/g) ?? [];
    expect(writes.length).toBe(2);
    for (const w of writes) {
      expect(w).toMatch(/current_user_role\(\) in \('org_owner', 'org_admin', 'ops', 'sales'\)/i);
    }
  });

  it('extends the audit_log entity_type CHECK with supply_plan and supply_plan_line (superset)', () => {
    const check = sql.match(/add constraint audit_log_entity_type_check[\s\S]*?\)\);/)?.[0];
    expect(check!).toContain("'supply_plan'");
    expect(check!).toContain("'supply_plan_line'");
    // still a superset of the prior list
    expect(check!).toContain("'job_template_line'");
    expect(check!).toContain("'three_pl_account'");
  });

  it('audits supply_plans as an FSM (from_state -> to_state on transition)', () => {
    const fn = sql.match(/create or replace function public\.trg_audit_supply_plans[\s\S]*?\$\$;/)?.[0];
    expect(fn!).toMatch(/v_from := old\.status; v_to := new\.status/i);
    expect(fn!).toMatch(/audit_append_state_change\(\s*v_org_id, 'supply_plan', v_entity_id, v_from, v_to/i);
  });

  it('release_supply_plan reserves min(required, available) for reserve lines and writes a reserve movement', () => {
    const fn = sql.match(/create or replace function public\.release_supply_plan[\s\S]*?\$\$;/)?.[0];
    expect(fn).toBeTruthy();
    expect(fn!).toMatch(/v_reservable := least\(v_line\.required_qty, greatest\(v_available, 0\)\)/i);
    // non-reserve resolutions reserve nothing
    expect(fn!).toMatch(/else\s*v_reservable := 0;/i);
    expect(fn!).toMatch(/shortage_qty\s*=\s*greatest\(v_line\.required_qty - v_reservable, 0\)/i);
    expect(fn!).toMatch(/insert into public\.stock_movements[\s\S]*?'reserve'[\s\S]*?'supply_plan', p_plan_id/i);
    // 3-arg cross-tenant guard, NOT_FOUND never 403
    expect(fn!).toMatch(/v_org_id is null or v_org_id <> p_caller_org_id/i);
    expect(fn!).toMatch(/NOT_FOUND/);
    expect(fn!).not.toMatch(/FORBIDDEN/);
  });

  it('cancel_supply_plan writes reserve_release for held lines and zeroes reserved_qty', () => {
    const fn = sql.match(/create or replace function public\.cancel_supply_plan[\s\S]*?\$\$;/)?.[0];
    expect(fn).toBeTruthy();
    expect(fn!).toMatch(/where supply_plan_id = p_plan_id and reserved_qty > 0/i);
    expect(fn!).toMatch(/insert into public\.stock_movements[\s\S]*?'reserve_release'[\s\S]*?'supply_plan', p_plan_id/i);
    expect(fn!).toMatch(/set reserved_qty = 0/i);
    expect(fn!).toMatch(/v_org_id is null or v_org_id <> p_caller_org_id/i);
  });

  it('grants the RPCs to authenticated + service_role only', () => {
    for (const f of ['release_supply_plan', 'cancel_supply_plan']) {
      expect(sql).toMatch(new RegExp(`revoke execute on function public\\.${f}\\(uuid, uuid, uuid\\)\\s*from public, anon`, 'i'));
      expect(sql).toMatch(new RegExp(`grant execute on function public\\.${f}\\(uuid, uuid, uuid\\)\\s*to authenticated, service_role`, 'i'));
    }
  });
});
