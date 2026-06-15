// Regression suite for Wave 12 / WMS Body B Phase B2 (THE SPINE STOP-POINT).
// Migration 0107 adds the additive nullable bin dimension to the append-only
// stock_movements ledger, the bin_stock_levels rollup, the
// recompute_bin_stock_level function, and the AFTER INSERT trigger that fires
// both rollups. The sum-reconcile invariant holds by construction because the
// bin recompute's signed-CASE is byte-identical to recompute_stock_level's.
//
// Static content checks. The LIVE aborting-transaction reconcile proof on
// staging (sum(bin) per (warehouse, item) == stock_levels.quantity_on_hand, and
// NULL-location movements in the warehouse total but no bin row) is run by the
// supervising agent and pasted into the PR body; this file pins the structure.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS = join(__dirname, '..', '..', '..', '..', 'supabase', 'migrations');

const sql = readFileSync(
  join(MIGRATIONS, '0107_stock_movements_bin_dimension.sql'),
  'utf8',
);

// 0095 is the latest redefinition of recompute_stock_level (0030 then 0095).
const sql0095 = readFileSync(
  join(MIGRATIONS, '0095_stock_movements_reserve_type.sql'),
  'utf8',
);

// Extract the on-hand signed-CASE block: from `case when movement_type in
// ('receipt'...` through the matching `else 0 end`. This is the load-bearing
// expression for the sum-reconcile invariant.
const ON_HAND_CASE_RE =
  /case\s+when movement_type in \('receipt'[\s\S]*?else 0\s+end/;

describe('migration 0107 stock_movements bin dimension (WMS B2, spine stop-point)', () => {
  it('adds the three additive nullable columns (no NOT NULL, no default, no backfill)', () => {
    expect(sql).toMatch(
      /alter table public\.stock_movements\s+add column if not exists location_id uuid references public\.warehouse_locations\(id\) on delete set null;/i,
    );
    // lot_id is a BARE uuid here (FK added in B4); license_plate_id is a bare uuid.
    expect(sql).toMatch(
      /alter table public\.stock_movements\s+add column if not exists lot_id uuid;/i,
    );
    expect(sql).toMatch(
      /alter table public\.stock_movements\s+add column if not exists license_plate_id uuid;/i,
    );
    // No NOT NULL / default / backfill on any of the three bin columns.
    expect(sql).not.toMatch(/add column if not exists location_id uuid[^;]*not null/i);
    expect(sql).not.toMatch(/add column if not exists location_id uuid[^;]*default/i);
    expect(sql).not.toMatch(/update public\.stock_movements set location_id/i);
  });

  it('adds the bin query index and leaves the existing warehouse_item index untouched', () => {
    expect(sql).toMatch(
      /create index if not exists stock_movements_warehouse_item_location_idx\s*on public\.stock_movements \(warehouse_id, item_id, location_id\)/i,
    );
    // B2 must not touch the existing index or the movement_type CHECK.
    expect(sql).not.toMatch(/drop index if exists public\.stock_movements_warehouse_item_idx/i);
    expect(sql).not.toMatch(/stock_movements_movement_type_check/i);
  });

  it('creates bin_stock_levels with the four-key unique group-by key', () => {
    const t = sql.match(/create table if not exists public\.bin_stock_levels \([\s\S]*?\);/)?.[0];
    expect(t).toBeTruthy();
    expect(t!).toMatch(/org_id uuid not null references public\.organizations\(id\) on delete cascade/i);
    expect(t!).toMatch(/warehouse_id uuid not null references public\.warehouses\(id\) on delete cascade/i);
    expect(t!).toMatch(/location_id uuid not null references public\.warehouse_locations\(id\) on delete cascade/i);
    expect(t!).toMatch(/item_id uuid not null/i);
    // lot_id is nullable (the no-lot partition is the lot_id IS NULL row).
    expect(t!).toMatch(/lot_id uuid,/i);
    expect(t!).toMatch(/quantity_on_hand numeric\(18,4\) not null default 0/i);
    // NULLS NOT DISTINCT is load-bearing: the no-lot partition (lot_id IS NULL)
    // must dedup or every recompute into a no-lot bin inserts a duplicate and
    // the sum-reconcile breaks. Pin the clause so it cannot regress.
    expect(t!).toMatch(
      /unique nulls not distinct \(warehouse_id, location_id, item_id, lot_id\)/i,
    );
  });

  it('makes bin_stock_levels SELECT-only RLS Pattern A with NO write policy', () => {
    expect(sql).toMatch(/alter table public\.bin_stock_levels enable row level security/i);
    const select = sql.match(/create policy bin_stock_levels_select[\s\S]*?;/)?.[0];
    expect(select).toBeTruthy();
    expect(select!).toMatch(/for select to authenticated/i);
    expect(select!).toMatch(/using \(org_id = public\.current_org_id\(\)\)/i);
    // No write policy: the rollup is trigger-maintained, exactly like stock_levels.
    expect(sql).not.toMatch(/create policy bin_stock_levels_write/i);
    expect(sql).not.toMatch(/bin_stock_levels[\s\S]*?for all to authenticated/i);
  });

  it('creates the org / warehouse_item / location indexes on the rollup', () => {
    expect(sql).toMatch(/bin_stock_levels_org_idx[\s\S]*?\(org_id\)/i);
    expect(sql).toMatch(/bin_stock_levels_warehouse_item_idx[\s\S]*?\(warehouse_id, item_id\)/i);
    expect(sql).toMatch(/bin_stock_levels_location_idx[\s\S]*?\(location_id\)/i);
  });

  it('does NOT audit bin_stock_levels (no entity_type, no audit trigger)', () => {
    // The spine stock_levels rollup is not audited; bin_stock_levels follows it.
    // Assert the absence of the actual audit DDL / write path, not mere prose
    // mentions of the constraint name (the header explains it is left untouched).
    expect(sql).not.toMatch(/alter table public\.audit_log\s+add constraint audit_log_entity_type_check/i);
    expect(sql).not.toMatch(/drop constraint audit_log_entity_type_check/i);
    expect(sql).not.toMatch(/'bin_stock_level'/i);
    expect(sql).not.toMatch(/perform public\.audit_append_state_change/i);
    expect(sql).not.toMatch(/create trigger audit_bin_stock_levels/i);
    expect(sql).not.toMatch(/create or replace function public\.trg_audit_bin_stock_levels/i);
  });

  it('defines recompute_bin_stock_level: security definer, search_path, skips NULL location, null-safe lot', () => {
    const fn = sql.match(
      /create or replace function public\.recompute_bin_stock_level[\s\S]*?\$\$;/,
    )?.[0];
    expect(fn).toBeTruthy();
    expect(fn!).toMatch(/\(\s*p_warehouse_id uuid,\s*p_item_id uuid,\s*p_location_id uuid,\s*p_lot_id uuid\s*\)/i);
    expect(fn!).toMatch(/security definer/i);
    expect(fn!).toMatch(/set search_path = public/i);
    // The NULL no-bin partition is skipped (it lives only in the warehouse grain).
    expect(fn!).toMatch(/if p_location_id is null then\s*return;\s*end if;/i);
    // null-safe lot match.
    expect(fn!).toMatch(/lot_id is not distinct from p_lot_id/i);
    // upsert on the four-key unique.
    expect(fn!).toMatch(/on conflict \(warehouse_id, location_id, item_id, lot_id\) do update/i);
    // execute revoked from public / anon, granted to service_role.
    expect(sql).toMatch(/revoke execute on function public\.recompute_bin_stock_level\(uuid, uuid, uuid, uuid\) from public, anon/i);
    expect(sql).toMatch(/grant execute on function public\.recompute_bin_stock_level\(uuid, uuid, uuid, uuid\) to service_role/i);
  });

  it('bin recompute on-hand signed-CASE is BYTE-IDENTICAL to recompute_stock_level (sum-reconcile invariant)', () => {
    const binCase = sql.match(ON_HAND_CASE_RE)?.[0];
    const spineCase = sql0095.match(ON_HAND_CASE_RE)?.[0];
    expect(binCase).toBeTruthy();
    expect(spineCase).toBeTruthy();
    // The exact byte equality is what guarantees the bins always sum back to the
    // warehouse total. A drift here silently breaks the reconcile invariant.
    expect(binCase).toBe(spineCase);
  });

  it('extends the AFTER INSERT trigger to fire BOTH rollups with the location_id guard', () => {
    const fn = sql.match(
      /create or replace function public\.trg_stock_movements_recompute[\s\S]*?\$\$;/,
    )?.[0];
    expect(fn).toBeTruthy();
    // warehouse grain, unchanged.
    expect(fn!).toMatch(/perform public\.recompute_stock_level\(new\.warehouse_id, new\.item_id\);/i);
    // bin grain only when the movement carries a bin (WMS on).
    expect(fn!).toMatch(/if new\.location_id is not null then/i);
    expect(fn!).toMatch(
      /perform public\.recompute_bin_stock_level\(\s*new\.warehouse_id, new\.item_id, new\.location_id, new\.lot_id\s*\);/i,
    );
    // execute revoked from public / anon.
    expect(sql).toMatch(/revoke execute on function public\.trg_stock_movements_recompute\(\) from public, anon/i);
  });

  it('re-declares the AFTER INSERT trigger idempotently', () => {
    expect(sql).toMatch(/drop trigger if exists stock_movements_recompute_ai on public\.stock_movements;/i);
    expect(sql).toMatch(
      /create trigger stock_movements_recompute_ai\s*after insert on public\.stock_movements\s*for each row execute function public\.trg_stock_movements_recompute\(\);/i,
    );
  });
});
