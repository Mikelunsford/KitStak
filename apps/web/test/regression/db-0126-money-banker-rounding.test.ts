// Regression suite for migration 0126: SQL banker's rounding (R-W14-MONEY-02).
// The four live objects that did cents arithmetic used Postgres round(), which
// is half-away-from-zero on numeric, not the constitution's roundHalfEven. This
// migration adds a round_half_even(numeric) SQL helper whose tie-break is
// identical to apps/web/src/lib/money.ts and replaces every money round() call.
// Static content checks. Behaviour was validated on staging during the
// readiness pass: the helper returned 2.5 -> 2, 3.5 -> 4, -2.5 -> -2 (matching
// the TS roundHalfEven), the four objects recreated with 13 round_half_even
// calls and zero bare round() in the DDL, and the view kept security_invoker.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const sql = readFileSync(
  join(__dirname, '..', '..', '..', '..', 'supabase', 'migrations', '0126_money_banker_rounding.sql'),
  'utf8',
);

// DDL only: strip SQL line comments so the header prose (which discusses round()
// and security_invoker) cannot satisfy or trip the content assertions.
const ddl = sql.replace(/^\s*--.*$/gm, '');

describe('migration 0126: SQL banker rounding helper (R-W14-MONEY-02)', () => {
  it('creates an immutable round_half_even(numeric) helper with a pinned search_path', () => {
    expect(ddl).toMatch(/create or replace function public\.round_half_even\(p_value numeric\)/i);
    expect(ddl).toMatch(/immutable/i);
    expect(ddl).toMatch(/set search_path = ''/i);
  });

  it('mirrors the TS roundHalfEven tie-break: floor-based, ties to even', () => {
    // diff < 0.5 -> floor, diff > 0.5 -> floor + 1, diff = 0.5 -> nearest even.
    expect(ddl).toMatch(/p_value - floor\(p_value\) < 0\.5 then floor\(p_value\)/i);
    expect(ddl).toMatch(/p_value - floor\(p_value\) > 0\.5 then floor\(p_value\) \+ 1/i);
    expect(ddl).toMatch(/floor\(p_value\) % 2 = 0 then floor\(p_value\)/i);
  });

  it('revokes the helper from public and grants execute to authenticated + service_role', () => {
    expect(ddl).toMatch(/revoke all on function public\.round_half_even\(numeric\) from public/i);
    expect(ddl).toMatch(/grant execute on function public\.round_half_even\(numeric\) to authenticated, service_role/i);
  });

  it('routes every money-math call through round_half_even and leaves no bare round() in the DDL', () => {
    // Count call sites only: slice off the helper's own declaration / grant /
    // comment block (which references round_half_even four times) by starting at
    // the first rewritten object.
    const objectsDdl = ddl.slice(ddl.search(/create or replace function public\.convert_project_to_invoice/i));
    const halfEvenCalls = objectsDdl.match(/public\.round_half_even\(/gi) ?? [];
    // 3 (convert) + 2 (recompute_project_totals) + 2 (approve_billing_review) + 6 (view) = 13.
    expect(halfEvenCalls.length).toBe(13);
    // No remaining bare Postgres round( in the executable DDL. round_half_even(
    // does not contain round( as a token, so a positive match here is a real
    // half-up call that was missed.
    const bareRound = ddl.match(/(?<![_a-z])round\(/gi) ?? [];
    expect(bareRound.length).toBe(0);
  });

  it('recreates the four live objects, preserving security_invoker on the view', () => {
    expect(ddl).toMatch(/create or replace function public\.convert_project_to_invoice/i);
    expect(ddl).toMatch(/create or replace function public\.recompute_project_totals/i);
    expect(ddl).toMatch(/create or replace function public\.approve_billing_review/i);
    expect(ddl).toMatch(/create or replace view public\.view_job_profitability\s*with \(security_invoker = true\)/i);
  });

  it('keeps the three functions SECURITY DEFINER with a pinned search_path', () => {
    const definerBlocks = ddl.match(/security definer\s+set search_path to 'public'/gi) ?? [];
    expect(definerBlocks.length).toBe(3);
  });
});
