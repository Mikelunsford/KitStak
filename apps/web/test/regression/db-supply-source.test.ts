// Regression suite for the supply-source migrations (Wave 13 / F-UIUX-
// ENTITYPICKER-SUPPLY-SOURCE-01): 0120 adds items.supply_source, 0121 adds the
// nullable per-line override to the five consumption-line tables, and 0122
// rewrites view_job_profitability so not-org-owned material rolls up as zero
// org cost. Static content checks, mirroring db-0104-job-profitability-view.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS = join(__dirname, '..', '..', '..', '..', 'supabase', 'migrations');
const read = (file: string) => readFileSync(join(MIGRATIONS, file), 'utf8');

const FOUR_VALUES = [
  'in_house',
  'customer_supplied',
  'vendor_consigned',
  'third_party_consigned',
];

describe('migration 0120: items.supply_source', () => {
  const sql = read('0120_item_supply_source.sql');

  it('adds the column idempotently, NOT NULL with an in_house default', () => {
    expect(sql).toMatch(
      /add column if not exists supply_source text not null default 'in_house'/i,
    );
  });

  it('constrains supply_source to the four known sources', () => {
    for (const v of FOUR_VALUES) {
      expect(sql).toContain(`'${v}'`);
    }
    expect(sql).toMatch(/check \(supply_source in \(/i);
  });
});

describe('migration 0121: per-line supply_source override', () => {
  const sql = read('0121_supply_source_line_overrides.sql');

  it('adds a nullable override to all five consumption-line tables', () => {
    const tables = [
      'receiving_order_line_items',
      'shipment_line_items',
      'manufacturing_run_consumed_line_items',
      'kitting_job_consumed_line_items',
      'job_run_daily_log_consumed_line_items',
    ];
    for (const t of tables) {
      const re = new RegExp(
        `alter table public\\.${t}\\s+add column if not exists supply_source text`,
        'i',
      );
      expect(sql).toMatch(re);
    }
  });

  it('allows null (inherit the item default) in the CHECK', () => {
    expect(sql).toMatch(/supply_source is null or supply_source in \(/i);
  });
});

describe('migration 0122: job profitability view zeroes not-org-owned material', () => {
  const sql = read('0122_job_profitability_supply_source.sql');

  it('replaces the view keeping security_invoker = true', () => {
    expect(sql).toMatch(
      /create or replace view public\.view_job_profitability\s*with \(security_invoker = true\)/i,
    );
  });

  it('reads the effective source as COALESCE(line override, item default)', () => {
    expect(sql).toMatch(
      /coalesce\(cli\.supply_source, it\.supply_source\)\s*in \('customer_supplied', 'third_party_consigned'\)/i,
    );
  });

  it('left joins items so an RLS-hidden item never drops a row or zeros cost', () => {
    expect(sql).toMatch(
      /left join public\.items it\s+on it\.id = cli\.item_id and it\.org_id = cli\.org_id/i,
    );
  });

  it('keeps the consumed-cost product and grants select to authenticated', () => {
    expect(sql).toMatch(/round\(cli\.quantity \* coalesce\(cli\.unit_cost_cents, 0\)\)/i);
    expect(sql).toMatch(/grant select on public\.view_job_profitability to authenticated/i);
    const sqlDdl = sql.replace(/^\s*--.*$/gm, '');
    expect(sqlDdl).not.toMatch(/security definer/i);
  });
});
