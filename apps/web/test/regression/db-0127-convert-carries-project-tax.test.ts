// Regression suite for migration 0127: convert_project_to_invoice now snapshots
// the project line's tax at invoice issuance (R-W14-MONEY-01). Previously it
// hardcoded tax_rate_snapshot = 0 and tax_amount_cents = 0, discarding the
// project line's tax_rate_id and forcing the operator to re-apply taxes by hand.
// The fix reads taxes.rate_bps through the existing FK (org-scoped), snapshots
// it as a decimal fraction, and computes tax / tax-inclusive line_total with
// round_half_even. Static content checks. Behaviour validated on staging:
// $1000 @ 8.25% -> tax 8250 / total 108250; with 10% discount -> net 90000 /
// tax 7425 / total 97425; null tax FK -> tax 0; banker's rounding on the tie.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const sql = readFileSync(
  join(__dirname, '..', '..', '..', '..', 'supabase', 'migrations', '0127_convert_carries_project_tax.sql'),
  'utf8',
);
const ddl = sql.replace(/^\s*--.*$/gm, '');

describe('migration 0127: convert carries project tax (R-W14-MONEY-01)', () => {
  it('recreates convert_project_to_invoice as SECURITY DEFINER with a pinned search_path', () => {
    expect(ddl).toMatch(/create or replace function public\.convert_project_to_invoice/i);
    expect(ddl).toMatch(/security definer\s+set search_path to 'public'/i);
  });

  it('reads the tax rate through the project line FK with an org-scoped join (no cross-tenant leak)', () => {
    expect(ddl).toMatch(/left join public\.taxes t\s+on t\.id = pli\.tax_rate_id and t\.org_id = pli\.org_id/i);
  });

  it('snapshots the rate as a decimal fraction (bps / 10000) and defaults a null FK to zero tax', () => {
    expect(ddl).toMatch(/coalesce\(t\.rate_bps, 0\) \/ 10000\.0/i);
  });

  it('computes every cents value with banker rounding and leaves no bare round() in the DDL', () => {
    expect((ddl.match(/public\.round_half_even\(/gi) ?? []).length).toBeGreaterThanOrEqual(6);
    const bareRound = ddl.match(/(?<![_a-z])round\(/gi) ?? [];
    expect(bareRound.length).toBe(0);
  });

  it('keeps the draft-invoice idempotency guard and the totals recompute', () => {
    expect(ddl).toMatch(/status = 'draft'[\s\S]*?order by created_at asc[\s\S]*?limit 1/i);
    expect(ddl).toMatch(/perform public\.recompute_invoice_totals\(v_invoice_id\)/i);
  });
});
