// Regression for ADR 0004 Option A unit 2: tier-grain recompute (migration 0134).
// Redefines recompute_quote_totals so a tiered quote rolls totals up per tier into
// quote_tiers and the quote header carries no single total when tiers are present,
// while the non-tiered path stays byte-identical to the original 0017 definition.
// Like db-0132 / db-0094 this asserts the migration SQL declares that behaviour;
// the functional behaviour (per-tier rollup, zeroed tiered header, identical
// non-tiered sums, service_role-only grant) was validated on staging in an
// aborting transaction during the build.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const sql = readFileSync(
  join(
    __dirname, '..', '..', '..', '..',
    'supabase', 'migrations', '0134_recompute_quote_totals_tier_grain.sql',
  ),
  'utf8',
);

describe('migration 0134 - tier-grain recompute (ADR 0004)', () => {
  it('redefines recompute_quote_totals(uuid) as SECURITY DEFINER', () => {
    expect(sql).toMatch(
      /create or replace function public\.recompute_quote_totals\(p_quote_id uuid\)/i,
    );
    expect(sql).toMatch(/security definer/i);
  });

  it('rolls each tier up from its own lines (LEFT JOIN on tier_id, per-tier _cents)', () => {
    expect(sql).toMatch(/update public\.quote_tiers/i);
    expect(sql).toMatch(
      /left join public\.quote_line_items\s+\w+\s+on\s+\w+\.tier_id\s*=\s*\w+\.id/i,
    );
    for (const col of [
      'subtotal_cents',
      'discount_cents',
      'tax_cents',
      'total_cents',
    ]) {
      expect(sql).toMatch(new RegExp(`${col}\\s*=`, 'i'));
    }
    // Sums the per-line BIGINT amounts (alias-prefixed inside the rollup subquery).
    for (const col of [
      'line_subtotal_cents',
      'line_discount_cents',
      'line_tax_cents',
      'line_total_cents',
    ]) {
      expect(sql).toMatch(new RegExp(`sum\\(\\s*\\w+\\.${col}\\s*\\)`, 'i'));
    }
  });

  it('zeroes the quote header when tiers are present (no single total)', () => {
    expect(sql).toMatch(
      /exists\s*\(\s*select 1 from public\.quote_tiers where quote_id = p_quote_id\s*\)/i,
    );
    expect(sql).toMatch(/v_subtotal\s*:=\s*0/i);
    expect(sql).toMatch(/v_discount\s*:=\s*0/i);
    expect(sql).toMatch(/v_tax\s*:=\s*0/i);
    expect(sql).toMatch(/v_total\s*:=\s*0/i);
  });

  it('keeps the non-tiered path byte-identical to 0017 (sum of all lines into the header)', () => {
    for (const col of [
      'line_subtotal_cents',
      'line_discount_cents',
      'line_tax_cents',
      'line_total_cents',
    ]) {
      // Unprefixed sum: the non-tiered branch sums the quote's lines directly.
      expect(sql).toMatch(new RegExp(`coalesce\\(sum\\(${col}\\), 0\\)`, 'i'));
    }
    expect(sql).toMatch(/update public\.quotes\s+set subtotal_cents/i);
  });

  it('preserves the post-0117 hardened grant baseline (service_role only, no authenticated)', () => {
    expect(sql).toMatch(
      /revoke execute on function public\.recompute_quote_totals\(uuid\)\s+from public, anon, authenticated/i,
    );
    expect(sql).toMatch(
      /grant execute on function public\.recompute_quote_totals\(uuid\) to service_role/i,
    );
    // Must NOT re-grant authenticated (the 0017 definition did; 0117 revoked it).
    expect(sql).not.toMatch(
      /grant execute on function public\.recompute_quote_totals\(uuid\)[^;]*authenticated/i,
    );
  });

  it('declares the constitutional header', () => {
    expect(sql).toMatch(/Migration:\s*0134_/);
    expect(sql).toMatch(/Wave:.*ADR 0004/i);
    expect(sql).toMatch(/Money rules/i);
    expect(sql).toMatch(/DOWN MIGRATION/);
  });
});
