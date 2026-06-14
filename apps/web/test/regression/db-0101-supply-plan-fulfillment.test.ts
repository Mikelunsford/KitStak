// Regression suite for Wave 12 / A6 step 4 — migration 0101 folds the Supply
// Plan fulfillment link into A6: supply_plans.job_run_id (closes
// F-Wave12-SUPPLY-PLAN-JOB-RUN-LINK-01) and the fulfill_supply_plan RPC
// (released -> fulfilled), which releases the remaining holds so the spine
// quantity_reserved is not left stale once a run has consumed the stock.
//
// Static content checks. The fulfill path was validated on staging in an
// aborting transaction during the A6 build: a released plan with a held line
// (reserved 5) fulfilled to status fulfilled, reserved_qty 0, and a single
// reserve_release movement.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const sql = readFileSync(
  join(__dirname, '..', '..', '..', '..', 'supabase', 'migrations', '0101_supply_plan_fulfillment.sql'),
  'utf8',
);

describe('migration 0101 — supply plan fulfillment fold-in (A6)', () => {
  it('adds the nullable supply_plans.job_run_id FK (ON DELETE SET NULL)', () => {
    expect(sql).toMatch(/alter table public\.supply_plans\s*add column if not exists job_run_id uuid\s*references public\.job_runs\(id\) on delete set null/i);
  });

  it('fulfill_supply_plan is released -> fulfilled, idempotent, with the 3-arg guard', () => {
    const fn = sql.match(/create or replace function public\.fulfill_supply_plan[\s\S]*?\$\$;/)?.[0];
    expect(fn).toBeTruthy();
    expect(fn!).toMatch(/v_status <> 'released'/i);
    expect(fn!).toMatch(/return p_plan_id; -- idempotent/i);
    expect(fn!).toMatch(/set status = 'fulfilled',\s*fulfilled_at = now\(\)/i);
    // 3-arg cross-tenant guard, NOT_FOUND never 403
    expect(fn!).toMatch(/v_org_id is null or v_org_id <> p_caller_org_id/i);
    expect(fn!).toMatch(/NOT_FOUND/);
    expect(fn!).not.toMatch(/FORBIDDEN/);
  });

  it('fulfill writes reserve_release for held lines and zeroes reserved_qty, but does NOT restore shortage', () => {
    const fn = sql.match(/create or replace function public\.fulfill_supply_plan[\s\S]*?\$\$;/)?.[0];
    expect(fn!).toMatch(/where supply_plan_id = p_plan_id and reserved_qty > 0/i);
    expect(fn!).toMatch(/insert into public\.stock_movements[\s\S]*?'reserve_release'[\s\S]*?'supply_plan', p_plan_id/i);
    expect(fn!).toMatch(/set reserved_qty = 0/i);
    // unlike cancel, fulfill does not reset shortage_qty (the demand was met)
    expect(fn!).not.toMatch(/shortage_qty = required_qty/i);
  });

  it('grants fulfill_supply_plan to authenticated + service_role only', () => {
    expect(sql).toMatch(/revoke execute on function public\.fulfill_supply_plan\(uuid, uuid, uuid\)\s*from public, anon/i);
    expect(sql).toMatch(/grant execute on function public\.fulfill_supply_plan\(uuid, uuid, uuid\)\s*to authenticated, service_role/i);
  });
});
