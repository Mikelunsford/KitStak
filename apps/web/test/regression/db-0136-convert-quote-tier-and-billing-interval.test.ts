// Regression for migration 0136: convert_quote_to_project gains an accepted-tier
// argument (ADR 0004 unit 5) and carries the line billing_interval onto the
// project (ADR 0005 Phase 1b, quote->project half). Two ADRs touch the same RPC,
// so they land in one redefine. A new project_line_items.billing_interval column
// mirrors the 0131 quote-line column.
//
// Like db-0094 / db-0135 this asserts the migration SQL; the functional behaviour
// (tier-filtered copy, billing_interval carry, foreign-tier NOT_FOUND, non-tiered
// byte-identical) was validated on staging in an aborting transaction during the
// build.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const sql = readFileSync(
  join(
    __dirname, '..', '..', '..', '..',
    'supabase', 'migrations', '0136_convert_quote_tier_and_billing_interval.sql',
  ),
  'utf8',
);

describe('migration 0136 - convert tier_id + project-line billing_interval', () => {
  it('adds billing_interval to project_line_items (mirrors 0131, default one_time)', () => {
    expect(sql).toMatch(
      /alter table public\.project_line_items\s+add column if not exists billing_interval text not null default 'one_time'/i,
    );
    expect(sql).toMatch(/check \(billing_interval in \('one_time', 'monthly'\)\)/i);
  });

  it('drops the 4-arg convert and recreates it with p_tier_id (5-arg)', () => {
    expect(sql).toMatch(
      /drop function if exists public\.convert_quote_to_project\(uuid, uuid, uuid, text\)/i,
    );
    expect(sql).toMatch(
      /create or replace function public\.convert_quote_to_project\([\s\S]*p_tier_id uuid default null/i,
    );
    expect(sql).toMatch(/security definer/i);
  });

  it('guards a named tier to the quote (404 on a foreign / cross-quote tier)', () => {
    expect(sql).toMatch(/where id = p_tier_id and quote_id = p_quote_id/i);
    expect(sql).toMatch(/NOT_FOUND: tier not found on quote/);
  });

  it('copies only the accepted tier lines (null = the null-tier lines) and carries billing_interval', () => {
    expect(sql).toMatch(/\(p_tier_id is null and qli\.tier_id is null\)/i);
    expect(sql).toMatch(/\(p_tier_id is not null and qli\.tier_id = p_tier_id\)/i);
    // billing_interval rides onto the project line (insert column + select).
    expect(sql).toMatch(/position, billing_interval,/i);
    expect(sql).toMatch(/qli\.billing_interval/i);
  });

  it('keeps the cents carryover unchanged (quantity /1000, discount /100)', () => {
    expect(sql).toMatch(/qli\.quantity_e3::numeric \/ 1000\.0/i);
    expect(sql).toMatch(/qli\.discount_bps::numeric \/ 100\.0/i);
    expect(sql).toMatch(/on conflict \(project_id, source_quote_line_item_id\)/i);
  });

  it('locks the new 5-arg form to service_role only (a fresh CREATE defaults to PUBLIC)', () => {
    expect(sql).toMatch(
      /revoke execute on function public\.convert_quote_to_project\(uuid, uuid, uuid, text, uuid\)\s+from public, anon, authenticated/i,
    );
    expect(sql).toMatch(
      /grant execute on function public\.convert_quote_to_project\(uuid, uuid, uuid, text, uuid\)\s+to service_role/i,
    );
    expect(sql).not.toMatch(
      /grant execute on function public\.convert_quote_to_project\([^)]*\)\s+to[^;]*authenticated/i,
    );
  });

  it('declares the constitutional header', () => {
    expect(sql).toMatch(/Migration:\s*0136_/);
    expect(sql).toMatch(/Wave:.*ADR 0004/i);
    expect(sql).toMatch(/DOWN MIGRATION/);
    expect(sql).toMatch(/Zod canon/);
    expect(sql).toMatch(/Grants/);
  });
});
