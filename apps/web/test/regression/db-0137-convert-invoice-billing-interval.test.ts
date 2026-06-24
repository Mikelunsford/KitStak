// Regression for migration 0137: convert_project_to_invoice carries the line
// billing_interval onto the invoice (ADR 0005 Phase 1b, project->invoice half),
// completing the carry-through chain quote -> project -> invoice. A new
// invoice_line_items.billing_interval column mirrors the 0131 / 0136 columns. The
// 3-arg signature is unchanged (projects are not tiered), so this is a plain
// CREATE OR REPLACE plus the additive column.
//
// Like db-0136 this asserts the migration SQL; the functional behaviour (column
// added, billing_interval carried, money math unchanged, grant locked) was
// validated on staging in an aborting transaction during the build.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const sql = readFileSync(
  join(
    __dirname, '..', '..', '..', '..',
    'supabase', 'migrations', '0137_convert_invoice_billing_interval.sql',
  ),
  'utf8',
);

describe('migration 0137 - invoice-line billing_interval carry', () => {
  it('adds billing_interval to invoice_line_items (mirrors 0131 / 0136)', () => {
    expect(sql).toMatch(
      /alter table public\.invoice_line_items\s+add column if not exists billing_interval text not null default 'one_time'/i,
    );
    expect(sql).toMatch(/check \(billing_interval in \('one_time', 'monthly'\)\)/i);
  });

  it('redefines convert_project_to_invoice in place (3-arg, no signature change)', () => {
    expect(sql).toMatch(
      /create or replace function public\.convert_project_to_invoice\(\s*p_project_id uuid,\s*p_caller_org_id uuid,\s*p_actor uuid\s*\)/i,
    );
    expect(sql).toMatch(/security definer/i);
    // No drop: the signature is unchanged, unlike the convert_quote_to_project 0136.
    expect(sql).not.toMatch(/drop function/i);
  });

  it('carries billing_interval onto the invoice line (insert column + select)', () => {
    expect(sql).toMatch(/line_total_cents, sort_order, billing_interval,/i);
    expect(sql).toMatch(/pli\.position,\s*pli\.billing_interval,/i);
  });

  it('preserves the banker-rounded money math unchanged', () => {
    expect(sql).toMatch(/public\.round_half_even/i);
    expect(sql).toMatch(/perform public\.recompute_invoice_totals\(v_invoice_id\)/i);
    // tax snapshot from the project line's tax_rate_id is unchanged.
    expect(sql).toMatch(/left join public\.taxes t\s+on t\.id = pli\.tax_rate_id/i);
  });

  it('keeps the grant baseline service_role only (never re-grants authenticated)', () => {
    expect(sql).toMatch(
      /revoke execute on function public\.convert_project_to_invoice\(uuid, uuid, uuid\)\s+from public, anon, authenticated/i,
    );
    expect(sql).toMatch(
      /grant execute on function public\.convert_project_to_invoice\(uuid, uuid, uuid\)\s+to service_role/i,
    );
    expect(sql).not.toMatch(
      /grant execute on function public\.convert_project_to_invoice\([^)]*\)\s+to[^;]*authenticated/i,
    );
  });

  it('declares the constitutional header', () => {
    expect(sql).toMatch(/Migration:\s*0137_/);
    expect(sql).toMatch(/Wave:.*ADR 0005/i);
    expect(sql).toMatch(/DOWN MIGRATION/);
    expect(sql).toMatch(/Zod canon/);
    expect(sql).toMatch(/Grants/);
  });
});
