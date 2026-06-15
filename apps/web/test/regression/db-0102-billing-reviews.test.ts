// Regression suite for Wave 12 / A7 step 1: migration 0102 billing_reviews plus
// the approve / cancel RPCs. billing_reviews is the money-out header; approve
// creates a spine DRAFT invoice from the account service rates and lands the
// review in approved.
//
// Static content checks. The approve / cancel RPCs were validated on staging in
// an aborting transaction during the A7 build: a draft review approved (creating
// a draft invoice with one line per account service def, totals recomputed, the
// estimate and actual snapshotted, invoice_id set), and a cross-tenant caller
// surfaced NOT_FOUND.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const sql = readFileSync(
  join(__dirname, '..', '..', '..', '..', 'supabase', 'migrations', '0102_billing_reviews.sql'),
  'utf8',
);

describe('migration 0102: billing reviews + approve/cancel RPCs (A7)', () => {
  it('creates billing_reviews with the four-state FSM and money snapshot columns', () => {
    const t = sql.match(/create table if not exists public\.billing_reviews \([\s\S]*?\);/)?.[0];
    expect(t).toBeTruthy();
    expect(t!).toMatch(/status text not null default 'draft'[\s\S]*?check \(status in \('draft', 'approved', 'invoiced', 'cancelled'\)\)/i);
    expect(t!).toMatch(/estimate_total_cents bigint[\s\S]*?check \(estimate_total_cents is null or estimate_total_cents >= 0\)/i);
    expect(t!).toMatch(/actual_total_cents bigint[\s\S]*?check \(actual_total_cents is null or actual_total_cents >= 0\)/i);
    expect(t!).toMatch(/currency_code text/i);
  });

  it('wires the spine refs ON DELETE SET NULL incl. invoice_id', () => {
    const t = sql.match(/create table if not exists public\.billing_reviews \([\s\S]*?\);/)?.[0];
    expect(t!).toMatch(/job_run_id uuid references public\.job_runs\(id\) on delete set null/i);
    expect(t!).toMatch(/project_id uuid references public\.projects\(id\) on delete set null/i);
    expect(t!).toMatch(/account_id uuid references public\.three_pl_accounts\(id\) on delete set null/i);
    expect(t!).toMatch(/invoice_id uuid references public\.invoices\(id\) on delete set null/i);
  });

  it('enables Pattern A RLS on billing_reviews gated to the FIVE roles incl. accounting', () => {
    expect(sql).toMatch(/alter table public\.billing_reviews enable row level security/i);
    const write = sql.match(/create policy billing_reviews_write[\s\S]*?with check \([\s\S]*?\);/)?.[0];
    expect(write!).toMatch(/current_user_role\(\) in \('org_owner', 'org_admin', 'ops', 'sales', 'accounting'\)/i);
    // accounting present, exactly the billing surface role addition
    expect(write!).toContain("'accounting'");
  });

  it('extends the audit_log entity_type CHECK with billing_review (superset of 0099)', () => {
    const check = sql.match(/add constraint audit_log_entity_type_check[\s\S]*?\)\);/)?.[0];
    expect(check!).toContain("'billing_review'");
    // still a superset of the prior list (job run + daily-log carriers)
    expect(check!).toContain("'job_run'");
    expect(check!).toContain("'job_run_daily_log'");
    expect(check!).toContain("'job_run_daily_log_consumed_line_item'");
    expect(check!).toContain("'job_run_daily_log_produced_line_item'");
    expect(check!).toContain("'supply_plan'");
    expect(check!).toContain("'three_pl_account'");
  });

  it('audits billing_reviews as an FSM (from_state -> to_state on transition)', () => {
    const fn = sql.match(/create or replace function public\.trg_audit_billing_reviews[\s\S]*?\$\$;/)?.[0];
    expect(fn!).toMatch(/v_from := old\.status; v_to := new\.status/i);
    expect(fn!).toMatch(/audit_append_state_change\(\s*v_org_id, 'billing_review', v_entity_id, v_from, v_to/i);
  });

  it('approve_billing_review is the 4-arg cross-tenant pattern, idempotent, with a state guard', () => {
    const fn = sql.match(/create or replace function public\.approve_billing_review[\s\S]*?\$\$;/)?.[0];
    expect(fn).toBeTruthy();
    // 4-arg signature with the optional invoice-number override
    expect(fn!).toMatch(/p_review_id uuid,\s*p_actor uuid,\s*p_caller_org_id uuid,\s*p_invoice_number text default null/i);
    expect(fn!).toMatch(/v_org_id is null or v_org_id <> p_caller_org_id/i);
    expect(fn!).toMatch(/NOT_FOUND/);
    expect(fn!).not.toMatch(/FORBIDDEN/);
    expect(fn!).toMatch(/STATE_CONFLICT/);
    expect(fn!).toMatch(/v_status in \('approved', 'invoiced'\)[\s\S]*?return p_review_id; -- idempotent/i);
  });

  it('approve acquires the invoice number the chassis way and inserts a draft invoice', () => {
    const fn = sql.match(/create or replace function public\.approve_billing_review[\s\S]*?\$\$;/)?.[0];
    // chassis next_doc_number for the invoice doc_type, with optional override
    expect(fn!).toMatch(/coalesce\(\s*nullif\(trim\(p_invoice_number\), ''\),\s*public\.next_doc_number\(v_org_id, 'invoice'\)\)/i);
    // creates a spine DRAFT invoice with project_id + currency
    const ins = fn!.match(/insert into public\.invoices \([\s\S]*?returning id into v_invoice_id;/)?.[0];
    expect(ins).toBeTruthy();
    expect(ins!).toMatch(/org_id, invoice_number, customer_id, project_id,\s*currency_code, status, created_by, updated_by/i);
    expect(ins!).toMatch(/v_currency, 'draft', p_actor, p_actor/i);
  });

  it('approve builds one invoice line per active account service def and recomputes totals', () => {
    const fn = sql.match(/create or replace function public\.approve_billing_review[\s\S]*?\$\$;/)?.[0];
    const ins = fn!.match(/insert into public\.invoice_line_items \([\s\S]*?order by asd\.position;/)?.[0];
    expect(ins).toBeTruthy();
    // quantity 1, price = the rate (0 when null), no tax / discount, sort = position
    expect(ins!).toMatch(/v_invoice_id, asd\.name, 1, coalesce\(asd\.rate_cents, 0\),\s*0, 0, 0, coalesce\(asd\.rate_cents, 0\),/i);
    // active = effective window open
    expect(ins!).toMatch(/asd\.account_id = v_account_id/i);
    // guarded behind an account_id present check
    expect(fn!).toMatch(/if v_account_id is not null then/i);
    // recompute the spine totals the authoritative way
    expect(fn!).toMatch(/perform public\.recompute_invoice_totals\(v_invoice_id\);/i);
  });

  it('approve snapshots the project-budget estimate and the posted daily-log actual, then sets invoice_id', () => {
    const fn = sql.match(/create or replace function public\.approve_billing_review[\s\S]*?\$\$;/)?.[0];
    // estimate from projects.budget_cents, org-scoped
    expect(fn!).toMatch(/select budget_cents into v_estimate_cents[\s\S]*?from public\.projects[\s\S]*?org_id = v_org_id/i);
    // actual = posted labor + posted consumed material
    expect(fn!).toMatch(/dl\.labor_hours \* coalesce\(dl\.labor_rate_cents, 0\)/i);
    expect(fn!).toMatch(/cli\.quantity \* coalesce\(cli\.unit_cost_cents, 0\)/i);
    expect(fn!).toMatch(/dl\.status = 'posted'/i);
    // final update lands approved + invoice_id + approved_at + snapshots
    const upd = fn!.match(/update public\.billing_reviews[\s\S]*?where id = p_review_id;/)?.[0];
    expect(upd!).toMatch(/status = 'approved'/i);
    expect(upd!).toMatch(/invoice_id = v_invoice_id/i);
    expect(upd!).toMatch(/approved_at = now\(\)/i);
    expect(upd!).toMatch(/estimate_total_cents = v_estimate_cents/i);
    expect(upd!).toMatch(/actual_total_cents = v_actual_cents/i);
  });

  it('cancel_billing_review is the 3-arg cross-tenant pattern, idempotent, with a state guard', () => {
    const fn = sql.match(/create or replace function public\.cancel_billing_review[\s\S]*?\$\$;/)?.[0];
    expect(fn).toBeTruthy();
    expect(fn!).toMatch(/v_org_id is null or v_org_id <> p_caller_org_id/i);
    expect(fn!).toMatch(/NOT_FOUND/);
    expect(fn!).not.toMatch(/FORBIDDEN/);
    expect(fn!).toMatch(/STATE_CONFLICT/);
    expect(fn!).toMatch(/v_status = 'cancelled'[\s\S]*?return p_review_id; -- idempotent/i);
    expect(fn!).toMatch(/v_status not in \('draft', 'approved'\)/i);
    expect(fn!).toMatch(/set status = 'cancelled', cancelled_at = now\(\)/i);
  });

  it('grants the RPCs to authenticated + service_role only', () => {
    expect(sql).toMatch(/revoke execute on function public\.approve_billing_review\(uuid, uuid, uuid, text\)\s*from public, anon/i);
    expect(sql).toMatch(/grant execute on function public\.approve_billing_review\(uuid, uuid, uuid, text\)\s*to authenticated, service_role/i);
    expect(sql).toMatch(/revoke execute on function public\.cancel_billing_review\(uuid, uuid, uuid\)\s*from public, anon/i);
    expect(sql).toMatch(/grant execute on function public\.cancel_billing_review\(uuid, uuid, uuid\)\s*to authenticated, service_role/i);
  });
});
