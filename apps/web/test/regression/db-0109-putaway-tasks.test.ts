// Regression suite for Wave 12 / WMS Body B Phase B3 (directed putaway).
// Migration 0109 putaway_tasks plus the three FSM transition RPCs (start /
// cancel / complete). A putaway_task is a directed move of received stock from a
// dock to a final bin; completing a task emits a warehouse-flat internal move
// (transfer_out at the source + transfer_in at the destination, existing 0030
// types), so the warehouse total stays flat while the 0107 bin recompute shifts
// the stock.
//
// Static content checks (mirror db-0098 / db-0106 style). The transition RPCs
// and the movement emission were validated on staging in an aborting transaction
// during the B3 build: a suggested task started, completed (two movements,
// transfer_out + transfer_in, warehouse-flat), and a cross-tenant caller
// surfaced NOT_FOUND.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const sql = readFileSync(
  join(__dirname, '..', '..', '..', '..', 'supabase', 'migrations', '0109_putaway_tasks.sql'),
  'utf8',
);

describe('migration 0109 putaway_tasks (WMS B3)', () => {
  it('creates putaway_tasks with the four-state FSM CHECK, quantity > 0, and bare-uuid lot_id', () => {
    const t = sql.match(/create table if not exists public\.putaway_tasks \([\s\S]*?\);/)?.[0];
    expect(t).toBeTruthy();
    expect(t!).toMatch(/org_id uuid not null references public\.organizations\(id\) on delete cascade/i);
    expect(t!).toMatch(/warehouse_id uuid not null references public\.warehouses\(id\)/i);
    expect(t!).toMatch(/item_id uuid not null references public\.items\(id\)/i);
    expect(t!).toMatch(/quantity numeric\(18,4\) not null check \(quantity > 0\)/i);
    expect(t!).toMatch(/status text not null default 'suggested'[\s\S]*?check \(status in \('suggested', 'in_progress', 'done', 'cancelled'\)\)/i);
    // lot_id is a BARE uuid (no FK; the FK lands in B4).
    expect(t!).toMatch(/lot_id uuid,/i);
    expect(t!).not.toMatch(/lot_id uuid references/i);
    expect(t!).toMatch(/license_plate_id uuid,/i);
    // source_entity_* are free-form audit refs (no FK).
    expect(t!).toMatch(/source_entity_type text,/i);
    expect(t!).toMatch(/source_entity_id uuid,/i);
    expect(t!).toMatch(/deleted_at timestamptz/i);
  });

  it('the three location FKs are ON DELETE SET NULL', () => {
    const t = sql.match(/create table if not exists public\.putaway_tasks \([\s\S]*?\);/)?.[0];
    expect(t!).toMatch(/source_location_id uuid references public\.warehouse_locations\(id\) on delete set null/i);
    expect(t!).toMatch(/suggested_location_id uuid references public\.warehouse_locations\(id\) on delete set null/i);
    expect(t!).toMatch(/actual_location_id uuid references public\.warehouse_locations\(id\) on delete set null/i);
  });

  it('creates the org / status / warehouse partial indexes plus the three location partials', () => {
    expect(sql).toMatch(/putaway_tasks_org_idx[\s\S]*?\(org_id\)\s*where deleted_at is null/i);
    expect(sql).toMatch(/putaway_tasks_org_status_idx[\s\S]*?\(org_id, status\)\s*where deleted_at is null/i);
    expect(sql).toMatch(/putaway_tasks_org_warehouse_idx[\s\S]*?\(org_id, warehouse_id\)\s*where deleted_at is null/i);
    expect(sql).toMatch(/putaway_tasks_source_location_idx[\s\S]*?\(source_location_id\)\s*where source_location_id is not null/i);
    expect(sql).toMatch(/putaway_tasks_suggested_location_idx[\s\S]*?\(suggested_location_id\)\s*where suggested_location_id is not null/i);
    expect(sql).toMatch(/putaway_tasks_actual_location_idx[\s\S]*?\(actual_location_id\)\s*where actual_location_id is not null/i);
  });

  it('enables Pattern A RLS gated to the inventory 3-role set (org_owner, org_admin, ops)', () => {
    expect(sql).toMatch(/alter table public\.putaway_tasks enable row level security/i);
    const select = sql.match(/create policy putaway_tasks_select[\s\S]*?;/)?.[0];
    expect(select!).toMatch(/using \(org_id = public\.current_org_id\(\)\)/i);
    const write = sql.match(/create policy putaway_tasks_write[\s\S]*?with check \([\s\S]*?\);/)?.[0];
    expect(write).toBeTruthy();
    // INVENTORY 3-role set, NOT the 3PL commercial 4-role set (no 'sales').
    expect(write!).toMatch(/current_user_role\(\) in \('org_owner', 'org_admin', 'ops'\)/i);
    expect(write!).not.toMatch(/'sales'/i);
  });

  it('extends the audit_log entity_type CHECK with putaway_task as a strict superset of the 0106 list', () => {
    const check = sql.match(/add constraint audit_log_entity_type_check[\s\S]*?\)\);/)?.[0];
    expect(check).toBeTruthy();
    expect(check!).toContain("'putaway_task'");
    // still a superset of the prior list (spot-check the 0106 tail and earlier).
    expect(check!).toContain("'warehouse_location'");
    expect(check!).toContain("'billing_review'");
    expect(check!).toContain("'job_run'");
    expect(check!).toContain("'three_pl_account'");
    expect(check!).toContain("'kitting_job'");
    expect(check!).toContain("'organization'");
  });

  it('audits putaway_tasks as an FSM (from_state -> to_state on transition)', () => {
    const fn = sql.match(/create or replace function public\.trg_audit_putaway_tasks[\s\S]*?\$\$;/)?.[0];
    expect(fn).toBeTruthy();
    expect(fn!).toMatch(/v_from := old\.status; v_to := new\.status/i);
    expect(fn!).toMatch(/audit_append_state_change\(\s*v_org_id, 'putaway_task', v_entity_id, v_from, v_to/i);
  });

  it('stamps updated_at via a BEFORE UPDATE trigger and wires the audit trigger AFTER INSERT OR UPDATE OR DELETE', () => {
    expect(sql).toMatch(/create or replace function public\.trg_putaway_tasks_set_updated_at/i);
    expect(sql).toMatch(/create trigger putaway_tasks_set_updated_at\s*before update on public\.putaway_tasks/i);
    expect(sql).toMatch(/create trigger audit_putaway_tasks\s*after insert or update or delete on public\.putaway_tasks/i);
  });

  it('each transition RPC is the 3-arg cross-tenant pattern, idempotent, with a NOT_FOUND guard and STATE_CONFLICT', () => {
    for (const f of ['start_putaway_task', 'cancel_putaway_task', 'complete_putaway_task']) {
      const fn = sql.match(new RegExp(`create or replace function public\\.${f}[\\s\\S]*?\\$\\$;`))?.[0];
      expect(fn, f).toBeTruthy();
      // 3-arg signature.
      expect(fn!, f).toMatch(/p_putaway_task_id uuid,\s*p_actor uuid,\s*p_caller_org_id uuid/i);
      // cross-tenant guard -> NOT_FOUND (never 403 / FORBIDDEN).
      expect(fn!, f).toMatch(/v_org_id is null or v_org_id <> p_caller_org_id/i);
      expect(fn!, f).toMatch(/NOT_FOUND/);
      expect(fn!, f).not.toMatch(/FORBIDDEN/);
      expect(fn!, f).toMatch(/STATE_CONFLICT/);
      expect(fn!, f).toMatch(/return p_putaway_task_id; -- idempotent/i);
    }
  });

  it('each transition RPC opens its row-read with a `for update` row lock (serialises concurrent transitions, no double emit)', () => {
    for (const f of ['start_putaway_task', 'cancel_putaway_task', 'complete_putaway_task']) {
      const fn = sql.match(new RegExp(`create or replace function public\\.${f}[\\s\\S]*?\\$\\$;`))?.[0];
      expect(fn, f).toBeTruthy();
      // the opening SELECT from putaway_tasks takes a row lock.
      expect(fn!, f).toMatch(/from public\.putaway_tasks where id = p_putaway_task_id for update;/i);
    }
  });

  it('adds the stock_movements_putaway_task_uniq partial unique backstop index (one transfer_out + one transfer_in per task)', () => {
    expect(sql).toMatch(
      /create unique index if not exists stock_movements_putaway_task_uniq\s*on public\.stock_movements \(source_entity_id, movement_type\)\s*where source_entity_type = 'putaway_task'/i,
    );
    // the DOWN block drops the backstop index.
    expect(sql).toMatch(/drop index if exists public\.stock_movements_putaway_task_uniq;/i);
  });

  it('the transitions stamp the paired <state>_at column', () => {
    expect(sql).toMatch(/set status = 'in_progress', started_at = now\(\)/i);
    expect(sql).toMatch(/set status = 'done', completed_at = now\(\)/i);
    expect(sql).toMatch(/set status = 'cancelled', cancelled_at = now\(\)/i);
  });

  it('cancel is allowed from any state except done', () => {
    const fn = sql.match(/create or replace function public\.cancel_putaway_task[\s\S]*?\$\$;/)?.[0];
    expect(fn!).toMatch(/if v_status = 'done' then[\s\S]*?STATE_CONFLICT/i);
  });

  it('complete moves only from in_progress and is idempotent on done (no double emit)', () => {
    const fn = sql.match(/create or replace function public\.complete_putaway_task[\s\S]*?\$\$;/)?.[0];
    expect(fn!).toMatch(/if v_status = 'done' then\s*return p_putaway_task_id; -- idempotent/i);
    expect(fn!).toMatch(/v_status <> 'in_progress'/i);
  });

  it('complete emits transfer_out + transfer_in (existing 0030 types) guarded by actual_location_id is not null', () => {
    const fn = sql.match(/create or replace function public\.complete_putaway_task[\s\S]*?\$\$;/)?.[0];
    expect(fn).toBeTruthy();
    // only emits when a destination bin is set (decision (e) no-op otherwise).
    expect(fn!).toMatch(/if v_actual_location_id is not null then/i);
    // two existing-type movements, reusing transfer_out / transfer_in.
    expect(fn!).toMatch(/'transfer_out'/);
    expect(fn!).toMatch(/'transfer_in'/);
    // source_entity_type points back at the task; unit_cost_cents 0 (relocation).
    expect(fn!).toMatch(/'putaway_task', p_putaway_task_id/);
    // no new movement type is invented.
    expect(fn!).not.toMatch(/'putaway'\s*,\s*v_quantity/i);
    // inserts into the spine ledger, letting the 0107 trigger fire the rollups.
    expect(fn!).toMatch(/insert into public\.stock_movements/i);
    // the two rows carry source vs destination location_id.
    expect(fn!).toMatch(/v_source_location_id/);
    expect(fn!).toMatch(/v_actual_location_id/);
  });

  it('grants the transition RPCs to authenticated + service_role only', () => {
    for (const f of ['start_putaway_task', 'cancel_putaway_task', 'complete_putaway_task']) {
      expect(sql).toMatch(new RegExp(`revoke execute on function public\\.${f}\\(uuid, uuid, uuid\\)\\s*from public, anon`, 'i'));
      expect(sql).toMatch(new RegExp(`grant execute on function public\\.${f}\\(uuid, uuid, uuid\\)\\s*to authenticated, service_role`, 'i'));
    }
  });

  it('does NOT redefine the stock_movements movement_type CHECK (reuses existing 0030 types)', () => {
    // The migration emits transfer_out / transfer_in (existing 0030 types); it
    // must NOT add a new movement_type or restate the movement_type CHECK list.
    expect(sql).not.toMatch(/check \(movement_type in/i);
    expect(sql).not.toMatch(/alter table public\.stock_movements/i);
  });
});
