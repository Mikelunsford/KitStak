// Regression for ADR 0004 Option A foundation: quote_tiers plus the nullable
// quote_line_items.tier_id (migration 0132). Like db-0094 / db-0106, this asserts
// the migration SQL declares the table, its Pattern B RLS, and the additive
// nullable FK column. The structure was validated on staging in an aborting
// transaction.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATION_PATH = join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'supabase',
  'migrations',
  '0132_quote_tiers.sql',
);

const sql = readFileSync(MIGRATION_PATH, 'utf8');

describe('migration 0132 - quote_tiers foundation (ADR 0004)', () => {
  it('creates quote_tiers as a child of quotes (ON DELETE CASCADE)', () => {
    expect(sql).toMatch(/create table if not exists public\.quote_tiers/i);
    expect(sql).toMatch(
      /quote_id uuid not null references public\.quotes\(id\) on delete cascade/i,
    );
  });

  it('carries a label, a break quantity, sort order, and per-tier _cents totals', () => {
    expect(sql).toMatch(/label text not null/i);
    expect(sql).toMatch(/break_quantity_e3 bigint not null/i);
    expect(sql).toMatch(/sort_order integer not null/i);
    for (const col of [
      'subtotal_cents',
      'discount_cents',
      'tax_cents',
      'total_cents',
    ]) {
      expect(sql).toMatch(new RegExp(`${col} bigint not null default 0`, 'i'));
    }
  });

  it('enables RLS with the Pattern B parent-join policies', () => {
    expect(sql).toMatch(/alter table public\.quote_tiers enable row level security/i);
    // SELECT: org match through the parent quote.
    expect(sql).toMatch(
      /create policy quote_tiers_select on public\.quote_tiers[\s\S]*?q\.org_id = public\.current_org_id\(\)/i,
    );
    // WRITE: additionally role-gated, mirroring quote_line_items (0014).
    expect(sql).toMatch(
      /create policy quote_tiers_write on public\.quote_tiers[\s\S]*?current_user_role\(\) in\s*\(\s*'org_owner', 'org_admin', 'sales', 'accounting'\s*\)/i,
    );
  });

  it('adds a nullable tier_id FK to quote_line_items (ON DELETE CASCADE)', () => {
    expect(sql).toMatch(
      /alter table public\.quote_line_items\s+add column if not exists tier_id uuid\s+references public\.quote_tiers\(id\) on delete cascade/i,
    );
    // Nullable: the ADD COLUMN statement (up to its semicolon) carries no NOT
    // NULL. The "where tier_id is not null" partial index is a separate
    // statement, so scope the check to the column declaration only.
    const addStmt =
      sql.match(/add column if not exists tier_id uuid[\s\S]*?;/)?.[0] ?? '';
    expect(addStmt).not.toMatch(/not null/i);
  });

  it('indexes the tier rollup path', () => {
    expect(sql).toMatch(
      /create index if not exists quote_line_items_tier_idx\s+on public\.quote_line_items \(tier_id\)/i,
    );
  });
});
