// Regression suite for Wave 12 / WMS Body B Phase B4 (lot and expiration
// capture). Migration 0110 lots plus the quarantine_lot RPC, the three additive
// lot_id FK closures (stock_movements / putaway_tasks / bin_stock_levels), the
// receiving_order_line_items.lot_id capture column, and the receipt-emitter
// redefinition that threads BOTH the 0108 dock location_id AND the new line lot.
//
// Static content checks (mirror db-0109 / db-0106 style). The quarantine RPC,
// the lot capture, and the receiving-to-putaway lot-keyed bin reconcile were
// validated on staging in an aborting transaction during the B4 build.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const sql = readFileSync(
  join(__dirname, '..', '..', '..', '..', 'supabase', 'migrations', '0110_lots.sql'),
  'utf8',
);

describe('migration 0110 lots (WMS B4)', () => {
  it('creates lots with the four-state status CHECK and a NOT NULL item FK', () => {
    const t = sql.match(/create table if not exists public\.lots \([\s\S]*?\);/)?.[0];
    expect(t).toBeTruthy();
    expect(t!).toMatch(/org_id uuid not null references public\.organizations\(id\) on delete cascade/i);
    expect(t!).toMatch(/item_id uuid not null references public\.items\(id\)/i);
    expect(t!).toMatch(/lot_code text not null/i);
    expect(t!).toMatch(/expiration_date date/i);
    expect(t!).toMatch(/received_at timestamptz/i);
    expect(t!).toMatch(/status text not null default 'active'[\s\S]*?check \(status in \('active', 'quarantined', 'expired', 'consumed'\)\)/i);
    expect(t!).toMatch(/deleted_at timestamptz/i);
  });

  it('creates the four indexes incl the partial-unique (org, item, code) and the FEFO expiration index', () => {
    expect(sql).toMatch(/create unique index if not exists lots_org_item_code_uniq\s*on public\.lots \(org_id, item_id, lot_code\)\s*where deleted_at is null/i);
    expect(sql).toMatch(/lots_org_idx[\s\S]*?\(org_id\)\s*where deleted_at is null/i);
    expect(sql).toMatch(/lots_org_status_idx[\s\S]*?\(org_id, status\)\s*where deleted_at is null/i);
    // FEFO groundwork: ordered scan by soonest expiry per item.
    expect(sql).toMatch(/lots_org_item_expiration_idx[\s\S]*?\(org_id, item_id, expiration_date\)\s*where deleted_at is null/i);
  });

  it('enables Pattern A RLS gated to the inventory 3-role set (org_owner, org_admin, ops)', () => {
    expect(sql).toMatch(/alter table public\.lots enable row level security/i);
    const select = sql.match(/create policy lots_select[\s\S]*?;/)?.[0];
    expect(select!).toMatch(/using \(org_id = public\.current_org_id\(\)\)/i);
    const write = sql.match(/create policy lots_write[\s\S]*?with check \([\s\S]*?\);/)?.[0];
    expect(write).toBeTruthy();
    expect(write!).toMatch(/current_user_role\(\) in \('org_owner', 'org_admin', 'ops'\)/i);
    expect(write!).not.toMatch(/'sales'/i);
  });

  it('extends the audit_log entity_type CHECK with lot as a strict superset of the 0109 list', () => {
    const check = sql.match(/add constraint audit_log_entity_type_check[\s\S]*?\)\);/)?.[0];
    expect(check).toBeTruthy();
    expect(check!).toContain("'lot'");
    // still a superset of the prior list (spot-check the 0109 tail and earlier).
    expect(check!).toContain("'putaway_task'");
    expect(check!).toContain("'warehouse_location'");
    expect(check!).toContain("'billing_review'");
    expect(check!).toContain("'job_run'");
    expect(check!).toContain("'three_pl_account'");
    expect(check!).toContain("'kitting_job'");
    expect(check!).toContain("'organization'");
  });

  it('audits lots as an FSM (from_state -> to_state on transition) under the lot entity_type', () => {
    const fn = sql.match(/create or replace function public\.trg_audit_lots[\s\S]*?\$\$;/)?.[0];
    expect(fn).toBeTruthy();
    expect(fn!).toMatch(/v_from := old\.status; v_to := new\.status/i);
    expect(fn!).toMatch(/audit_append_state_change\(\s*v_org_id, 'lot', v_entity_id, v_from, v_to/i);
  });

  it('stamps updated_at via a BEFORE UPDATE trigger and wires the audit trigger AFTER INSERT OR UPDATE OR DELETE', () => {
    expect(sql).toMatch(/create or replace function public\.trg_lots_set_updated_at/i);
    expect(sql).toMatch(/create trigger lots_set_updated_at\s*before update on public\.lots/i);
    expect(sql).toMatch(/create trigger audit_lots\s*after insert or update or delete on public\.lots/i);
  });

  it('quarantine_lot is the 3-arg cross-tenant pattern with a FOR UPDATE lock, NOT_FOUND, STATE_CONFLICT, and idempotency', () => {
    const fn = sql.match(/create or replace function public\.quarantine_lot[\s\S]*?\$\$;/)?.[0];
    expect(fn).toBeTruthy();
    // 3-arg signature.
    expect(fn!).toMatch(/p_lot_id uuid,\s*p_actor uuid,\s*p_caller_org_id uuid/i);
    // row lock.
    expect(fn!).toMatch(/from public\.lots where id = p_lot_id for update;/i);
    // cross-tenant guard -> NOT_FOUND (never 403 / FORBIDDEN).
    expect(fn!).toMatch(/v_org_id is null or v_org_id <> p_caller_org_id/i);
    expect(fn!).toMatch(/NOT_FOUND/);
    expect(fn!).not.toMatch(/FORBIDDEN/);
    // idempotent on already-quarantined; STATE_CONFLICT when not active.
    expect(fn!).toMatch(/if v_status = 'quarantined' then\s*return p_lot_id; -- idempotent/i);
    expect(fn!).toMatch(/v_status <> 'active'[\s\S]*?STATE_CONFLICT/i);
    expect(fn!).toMatch(/set status = 'quarantined'/i);
  });

  it('grants quarantine_lot to authenticated + service_role only', () => {
    expect(sql).toMatch(/revoke execute on function public\.quarantine_lot\(uuid, uuid, uuid\)\s*from public, anon/i);
    expect(sql).toMatch(/grant execute on function public\.quarantine_lot\(uuid, uuid, uuid\)\s*to authenticated, service_role/i);
  });

  it('closes the three additive lot_id FK constraints ON DELETE SET NULL (stock_movements / putaway_tasks / bin_stock_levels)', () => {
    expect(sql).toMatch(/alter table public\.stock_movements\s*add constraint stock_movements_lot_id_fkey\s*foreign key \(lot_id\) references public\.lots\(id\) on delete set null/i);
    expect(sql).toMatch(/alter table public\.putaway_tasks\s*add constraint putaway_tasks_lot_id_fkey\s*foreign key \(lot_id\) references public\.lots\(id\) on delete set null/i);
    expect(sql).toMatch(/alter table public\.bin_stock_levels\s*add constraint bin_stock_levels_lot_id_fkey\s*foreign key \(lot_id\) references public\.lots\(id\) on delete set null/i);
    // each FK is guarded (drop-if-exists then add) so it is idempotent.
    expect(sql).toMatch(/alter table public\.stock_movements drop constraint if exists stock_movements_lot_id_fkey/i);
    expect(sql).toMatch(/alter table public\.putaway_tasks drop constraint if exists putaway_tasks_lot_id_fkey/i);
    expect(sql).toMatch(/alter table public\.bin_stock_levels drop constraint if exists bin_stock_levels_lot_id_fkey/i);
  });

  it('adds the receiving_order_line_items.lot_id capture column (nullable, ON DELETE SET NULL) plus its partial index', () => {
    expect(sql).toMatch(/alter table public\.receiving_order_line_items\s*add column if not exists lot_id uuid\s*references public\.lots\(id\) on delete set null/i);
    expect(sql).toMatch(/receiving_order_line_items_lot_idx[\s\S]*?\(org_id, lot_id\)\s*where lot_id is not null/i);
  });

  it('redefines the receipt emitter to carry BOTH the 0108 dock location_id AND the new line lot_id', () => {
    const fn = sql.match(/create or replace function public\.tg_receiving_orders_emit_movements[\s\S]*?\$\$;/)?.[0];
    expect(fn).toBeTruthy();
    // 0108 dock threading is PRESERVED (the receipt still cites the header dock).
    expect(fn!).toMatch(/new\.dock_location_id/);
    // the new line lot is threaded onto the SAME emitted row.
    expect(fn!).toMatch(/li\.lot_id/);
    // both columns appear in the INSERT column list.
    expect(fn!).toMatch(/location_id, lot_id/i);
    // movement_type stays 'receipt'; same received-guard and ordered SELECT.
    expect(fn!).toMatch(/'receipt'/);
    expect(fn!).toMatch(/new\.status <> 'received'/i);
    expect(fn!).toMatch(/order by li\.position/i);
    // the trigger function is not directly executable (assert against the full
    // migration; the revoke follows the function body, outside the $$ block).
    expect(sql).toMatch(/revoke execute on function public\.tg_receiving_orders_emit_movements\(\)\s*from public, anon/i);
  });

  it('does NOT recreate the AFTER UPDATE OF status trigger (body-only replace, the 0048/0051/0108 precedent)', () => {
    // The migration only replaces the function body; it must not re-register a
    // create-trigger statement (the 0032 status-transition trigger already points
    // at this function by name), and it must not touch the movement_type CHECK.
    // Match an actual `create trigger ... after update` STATEMENT (no comment
    // text between the keyword and the clause), not the DOWN-block prose.
    expect(sql).not.toMatch(/create trigger\s+\w+\s+after update/i);
    expect(sql).not.toMatch(/check \(movement_type in/i);
  });
});
