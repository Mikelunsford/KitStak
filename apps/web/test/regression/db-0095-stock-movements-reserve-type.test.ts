// Regression suite for Wave 12 / A5 step 1 (ledger) — migration 0095 activates
// the dormant spine reservation path so a Supply Plan can reserve available
// stock. stock_levels.quantity_reserved existed from 0030 with quantity_available
// GENERATED as on_hand - reserved, but recompute_stock_level only ever derived
// on_hand and there was no reserve movement type, so reserved was always 0.
//
// Static content checks (no DB harness in apps/web/test). The behavior was
// additionally validated on staging in an aborting transaction during the A5
// build: reserve 4 then reserve_release 4 moved quantity_reserved 0 -> 4 -> 0 and
// quantity_available 10 -> 6 -> 10 with on_hand steady at 10.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const sql = readFileSync(
  join(__dirname, '..', '..', '..', '..', 'supabase', 'migrations', '0095_stock_movements_reserve_type.sql'),
  'utf8',
);

describe('migration 0095 — stock_movements reserve type (A5)', () => {
  it('extends the movement_type CHECK with reserve and reserve_release as a strict superset', () => {
    const check = sql.match(/add constraint stock_movements_movement_type_check[\s\S]*?\)\);/)?.[0];
    expect(check).toBeTruthy();
    // every 0030 value still present
    for (const v of ['receipt', 'shipment', 'production_consumed', 'production_produced', 'adjustment', 'transfer_in', 'transfer_out']) {
      expect(check!).toContain(`'${v}'`);
    }
    expect(check!).toContain("'reserve'");
    expect(check!).toContain("'reserve_release'");
  });

  it('uses a guarded drop-then-add for the CHECK (idempotent)', () => {
    expect(sql).toMatch(/from pg_constraint[\s\S]*?conname\s*=\s*'stock_movements_movement_type_check'/i);
    expect(sql).toMatch(/drop constraint stock_movements_movement_type_check/i);
  });

  it('redefines recompute_stock_level to derive quantity_reserved from reserve minus reserve_release', () => {
    const fn = sql.match(/create or replace function public\.recompute_stock_level[\s\S]*?\$\$;/)?.[0];
    expect(fn).toBeTruthy();
    expect(fn!).toMatch(/when movement_type\s*=\s*'reserve'\s*then quantity/i);
    expect(fn!).toMatch(/when movement_type\s*=\s*'reserve_release'\s*then -quantity/i);
    expect(fn!).toMatch(/quantity_reserved\s*=\s*excluded\.quantity_reserved/i);
  });

  it('leaves the on_hand derivation byte-identical to 0030 (reserve excluded from on_hand)', () => {
    const fn = sql.match(/create or replace function public\.recompute_stock_level[\s\S]*?\$\$;/)?.[0];
    expect(fn!).toMatch(/when movement_type in \('receipt', 'production_produced', 'transfer_in', 'adjustment'\)/i);
    expect(fn!).toMatch(/when movement_type in \('shipment', 'production_consumed', 'transfer_out'\)/i);
    // the on_hand CASE must NOT count reserve as a physical move
    const onHandCase = fn!.match(/coalesce\(sum\(\s*case[\s\S]*?end\s*\), 0\)/)?.[0];
    expect(onHandCase).toBeTruthy();
    expect(onHandCase!).not.toMatch(/'reserve'/);
  });

  it('never writes the generated quantity_available column', () => {
    const fn = sql.match(/create or replace function public\.recompute_stock_level[\s\S]*?\$\$;/)?.[0];
    expect(fn!).not.toMatch(/quantity_available\s*=/);
  });

  it('keeps the function service-role only', () => {
    expect(sql).toMatch(/revoke execute on function public\.recompute_stock_level\(uuid, uuid\)\s*from public, anon/i);
    expect(sql).toMatch(/grant execute on function public\.recompute_stock_level\(uuid, uuid\)\s*to service_role/i);
  });
});
