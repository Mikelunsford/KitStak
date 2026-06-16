// Regression suite for Wave 13 Phase B (R-W13-CAT-01). Migration 0115 extends
// the item master (0012) with four additive, nullable catalog attributes:
// unit_of_measure (text), cost_cents (BIGINT cents, distinct from the existing
// unit_cost_cents), reorder_point (numeric), and barcode (text). No existing
// column is dropped, renamed, or retyped; no backfill; no NOT NULL; no RLS DDL.
//
// Static content checks (mirror db-0114 style). The migration is additive and
// idempotent, so the structure is pinned here; no live DB run is required.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const sql = readFileSync(
  join(
    __dirname,
    '..',
    '..',
    '..',
    '..',
    'supabase',
    'migrations',
    '0115_item_master_fields.sql',
  ),
  'utf8',
);

// Strip every `--` comment line so the column regexes match only the LIVE
// (executed) DDL, never the commented-out DOWN MIGRATION restore script.
const live = sql
  .split(/\r?\n/)
  .filter((l) => !/^\s*--/.test(l))
  .join('\n');

describe('migration 0115 item master fields (catalog deepening, R-W13-CAT-01)', () => {
  it('carries the canonical header (Wave 13, Phase B, Closes R-W13-CAT-01, dated, DOWN block)', () => {
    expect(sql).toMatch(/-- Wave: 13/);
    expect(sql).toMatch(/-- Phase: B\./);
    expect(sql).toMatch(/-- Closes: R-W13-CAT-01/);
    expect(sql).toMatch(/-- Date: 2026-06-15/);
    expect(sql).toMatch(/-- DOWN MIGRATION \(operator-only\):/);
    expect(sql).toMatch(/-- Constitutional alignment:/);
  });

  it('adds unit_of_measure as a nullable text column (idempotent, no default, no NOT NULL)', () => {
    expect(live).toMatch(
      /alter table public\.items\s+add column if not exists unit_of_measure text;/i,
    );
    expect(live).not.toMatch(/add column if not exists unit_of_measure text[^;]*not null/i);
    expect(live).not.toMatch(/add column if not exists unit_of_measure text[^;]*default/i);
  });

  it('adds cost_cents as a nullable BIGINT cents column with a non-negative CHECK', () => {
    expect(live).toMatch(
      /alter table public\.items\s+add column if not exists cost_cents bigint\s+check \(cost_cents is null or cost_cents >= 0\);/i,
    );
    // Money rule: the cost column is BIGINT and carries the _cents suffix.
    expect(live).not.toMatch(/add column if not exists cost_cents (?!bigint)/i);
    expect(live).not.toMatch(/add column if not exists cost_cents bigint[^;]*not null/i);
  });

  it('adds reorder_point as a nullable numeric column with a non-negative CHECK', () => {
    expect(live).toMatch(
      /alter table public\.items\s+add column if not exists reorder_point numeric\s+check \(reorder_point is null or reorder_point >= 0\);/i,
    );
    expect(live).not.toMatch(/add column if not exists reorder_point numeric[^;]*not null/i);
  });

  it('adds barcode as a nullable text column', () => {
    expect(live).toMatch(
      /alter table public\.items\s+add column if not exists barcode text;/i,
    );
    expect(live).not.toMatch(/add column if not exists barcode text[^;]*not null/i);
  });

  it('does not touch RLS, the existing money columns, or any backfill', () => {
    // No RLS / policy DDL: items already has Pattern A RLS from 0012.
    expect(live).not.toMatch(/create policy/i);
    expect(live).not.toMatch(/alter table public\.items enable row level security/i);
    // No drop / rename / retype of any existing column.
    expect(live).not.toMatch(/drop column/i);
    expect(live).not.toMatch(/rename column/i);
    // The existing landed-cost column is left intact; this migration adds a
    // SEPARATE cost_cents, it does not modify unit_cost_cents.
    expect(live).not.toMatch(/alter column unit_cost_cents/i);
    // No backfill on any added column.
    expect(live).not.toMatch(/update public\.items set/i);
  });

  it('is fully idempotent (every column add uses IF NOT EXISTS)', () => {
    const addCount = (live.match(/add column if not exists/gi) ?? []).length;
    const bareAddCount = (live.match(/add column (?!if not exists)/gi) ?? []).length;
    expect(addCount).toBe(4);
    expect(bareAddCount).toBe(0);
  });
});
