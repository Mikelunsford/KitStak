// Regression suite for Wave 12 / WMS Body B receiving-to-dock (the
// spine-touching receive path; F-Wave12-WMS-RECEIVE-DOCK-01). Migration 0108
// adds the additive nullable header dock (receiving_orders.dock_location_id) and
// redefines tg_receiving_orders_emit_movements so the emitted receipt carries
// that dock as stock_movements.location_id. One dock per receipt: a HEADER
// column, never per line.
//
// Static content checks, mirroring db-0107 / db-0106. The LIVE proof (a receipt
// emitted with a dock lands a bin_stock_levels row via the unchanged 0107
// recompute, and a receipt with a NULL dock lands no bin row) is run by the
// supervising agent in an aborting transaction and pasted into the PR body; this
// file pins the structure.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS = join(__dirname, '..', '..', '..', '..', 'supabase', 'migrations');

const sql = readFileSync(
  join(MIGRATIONS, '0108_receiving_to_dock.sql'),
  'utf8',
);

describe('migration 0108 receiving-to-dock (WMS Body B, spine receive path)', () => {
  it('adds the additive nullable dock header column with FK warehouse_locations ON DELETE SET NULL', () => {
    expect(sql).toMatch(
      /alter table public\.receiving_orders\s+add column if not exists dock_location_id uuid\s+references public\.warehouse_locations\(id\) on delete set null;/i,
    );
    // No NOT NULL / default / backfill on the dock column. Scope the negative
    // checks to the single ADD COLUMN statement (up to its terminating ;) so a
    // `not null` / `default` elsewhere in the file cannot satisfy the match.
    const addStmt = sql.match(
      /add column if not exists dock_location_id uuid[\s\S]*?;/i,
    )?.[0];
    expect(addStmt).toBeTruthy();
    expect(addStmt!).not.toMatch(/not null/i);
    expect(addStmt!).not.toMatch(/default/i);
    expect(sql).not.toMatch(/update public\.receiving_orders set dock_location_id/i);
  });

  it('adds the partial dock index over live links', () => {
    expect(sql).toMatch(
      /create index if not exists receiving_orders_dock_location_idx\s*on public\.receiving_orders \(org_id, dock_location_id\)\s*where dock_location_id is not null;/i,
    );
  });

  it('redefines tg_receiving_orders_emit_movements to insert location_id sourced from new.dock_location_id', () => {
    const fn = sql.match(
      /create or replace function public\.tg_receiving_orders_emit_movements[\s\S]*?\$\$;/,
    )?.[0];
    expect(fn).toBeTruthy();
    // security definer + search_path preserved.
    expect(fn!).toMatch(/security definer/i);
    expect(fn!).toMatch(/set search_path = public/i);
    // Same terminal guard as 0051: only fires on the transition to 'received'.
    expect(fn!).toMatch(
      /if new\.status is null or new\.status = old\.status or new\.status <> 'received' then\s*return new;\s*end if;/i,
    );
    // location_id is in the INSERT column list.
    expect(fn!).toMatch(/insert into public\.stock_movements \([\s\S]*?location_id\s*\)/i);
    // and is sourced from new.dock_location_id in the SELECT.
    expect(fn!).toMatch(/new\.dock_location_id/i);
    // still reads the normalised line-item table ordered by position.
    expect(fn!).toMatch(/from public\.receiving_order_line_items li/i);
    expect(fn!).toMatch(/order by li\.position/i);
  });

  it('keeps movement_type receipt and does NOT thread lot_id (lots are B4)', () => {
    const fn = sql.match(
      /create or replace function public\.tg_receiving_orders_emit_movements[\s\S]*?\$\$;/,
    )?.[0];
    expect(fn).toBeTruthy();
    // movement stays 'receipt'; no new movement_type introduced.
    expect(fn!).toMatch(/'receipt'/);
    // lot_id is NOT threaded in this migration (B4).
    expect(fn!).not.toMatch(/lot_id/i);
    expect(sql).not.toMatch(/stock_movements_movement_type_check/i);
  });

  it('re-asserts the execute revoke and does NOT recreate the AFTER UPDATE trigger', () => {
    expect(sql).toMatch(
      /revoke execute on function public\.tg_receiving_orders_emit_movements\(\) from public, anon;/i,
    );
    // The 0032 AFTER UPDATE OF status trigger is referenced by name; 0048 / 0051
    // never recreated it and neither does 0108.
    expect(sql).not.toMatch(/create trigger receiving_orders_emit_movements/i);
    expect(sql).not.toMatch(/drop trigger if exists receiving_orders_emit_movements/i);
  });

  it('does NOT touch audit_log entity_type CHECK (no new entity_type)', () => {
    expect(sql).not.toMatch(/alter table public\.audit_log\s+add constraint audit_log_entity_type_check/i);
    expect(sql).not.toMatch(/drop constraint audit_log_entity_type_check/i);
  });

  it('does NOT touch the stock_movements RLS, movement_type CHECK, or the 0107 bin recompute / trigger', () => {
    // No new stock_movements write policy.
    expect(sql).not.toMatch(/create policy stock_movements_/i);
    // The 0107 recompute and its AFTER INSERT trigger are NOT redefined here.
    expect(sql).not.toMatch(/create or replace function public\.recompute_bin_stock_level/i);
    expect(sql).not.toMatch(/create or replace function public\.trg_stock_movements_recompute/i);
    expect(sql).not.toMatch(/create trigger stock_movements_recompute_ai/i);
    // recompute_stock_level (warehouse grain) is not redefined either.
    expect(sql).not.toMatch(/create or replace function public\.recompute_stock_level/i);
  });

  it('adds no money (_cents) column', () => {
    expect(sql).not.toMatch(/add column if not exists [a-z_]*_cents/i);
  });

  it('is forward-only and idempotent (ADD COLUMN / CREATE INDEX IF NOT EXISTS, CREATE OR REPLACE)', () => {
    expect(sql).toMatch(/add column if not exists dock_location_id/i);
    expect(sql).toMatch(/create index if not exists receiving_orders_dock_location_idx/i);
    expect(sql).toMatch(/create or replace function public\.tg_receiving_orders_emit_movements/i);
  });
});
