// Regression suite for B4 — projects.budget_cents must be derived from
// project_line_items so the project detail page does not render $0.00 after
// convert_quote_to_project.
//
// Background (2026-05-21 E2E smoke walk, journal at
// 03-workspace/journal/2026-05-21-e2e-smoke-investigation.md): the
// convert_quote_to_project RPC from 0044_project_line_items.sql INSERTs
// into projects without setting budget_cents (defaults to 0 per
// 0016_sales_projects.sql:53). The SPA detail page reads
// projects.budget_cents directly (ProjectDetailPage.tsx:213) so the
// operator saw "Budget: $0.00" after converting a $5,000 quote.
//
// Fix (migration 0059):
//   1. recompute_project_totals(uuid) — sums per-line totals into
//      projects.budget_cents.
//   2. AFTER INSERT/UPDATE/DELETE trigger on project_line_items calling it.
//   3. CREATE OR REPLACE convert_quote_to_project that PERFORMs the
//      recompute between the project_line_items insert and the quotes
//      update.
//   4. One-shot backfill DO-block recomputing every existing project that
//      has at least one line.
//
// This regression cannot exercise the DB function directly (no DB harness
// is wired into apps/web/test). Instead it asserts the migration declares
// the expected helper, trigger, RPC-redefinition, and backfill — a static
// content check in line with how the contract suite verifies invariants
// that cannot be evaluated dynamically in CI.

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
  '0059_project_budget_recompute.sql',
);

const sql = readFileSync(MIGRATION_PATH, 'utf8');

describe('migration 0059 — projects.budget_cents recompute (B4)', () => {
  it('declares recompute_project_totals as a SECURITY DEFINER function on (uuid)', () => {
    expect(sql).toMatch(
      /create or replace function public\.recompute_project_totals\(p_project_id uuid\)/i,
    );
    expect(sql).toMatch(/security definer/i);
  });

  it('sums per-line totals using the 0045 invoice-conversion formula', () => {
    // Mirrors 0045_convert_project_to_invoice.sql:147-149 so the budget
    // matches what the project would invoice for if converted today.
    expect(sql).toMatch(/sum\(\s*round\(\(pli\.quantity \* pli\.unit_price_cents\)::numeric\)::bigint/);
    expect(sql).toMatch(/pli\.quantity \* pli\.unit_price_cents \* pli\.discount_percent \/ 100\.0/);
  });

  it('updates projects.budget_cents and updated_at (and nothing else)', () => {
    const updateBlock = sql.match(/update public\.projects[\s\S]*?where id = p_project_id;/);
    expect(updateBlock).not.toBeNull();
    expect(updateBlock![0]).toMatch(/set budget_cents = v_budget/);
    expect(updateBlock![0]).toMatch(/updated_at = now\(\)/);
    // Must NOT touch state (that would fire the audit trigger from 0017).
    expect(updateBlock![0]).not.toMatch(/\bstate\s*=/i);
  });

  it('declares the project_line_items recompute trigger AFTER INSERT/UPDATE/DELETE', () => {
    expect(sql).toMatch(/create or replace function public\.trg_project_line_items_recompute\(\)/i);
    expect(sql).toMatch(
      /create trigger project_line_items_recompute[\s\S]*?after insert or update or delete on public\.project_line_items/i,
    );
    expect(sql).toMatch(/execute function public\.trg_project_line_items_recompute\(\)/i);
  });

  it('uses old.project_id on DELETE and new.project_id otherwise', () => {
    // Mirrors the DELETE-branch shape from 0019:181-204
    // (trg_payment_allocations_recompute).
    expect(sql).toMatch(/if tg_op = 'DELETE' then[\s\S]*?v_project_id := old\.project_id;/);
    expect(sql).toMatch(/else[\s\S]*?v_project_id := new\.project_id;/);
  });

  it('redefines convert_quote_to_project preserving the (uuid,uuid,uuid,text) signature', () => {
    // Signature must match 0044:308 exactly so the quotes-api handler's
    // rpc() call does not need a code change.
    expect(sql).toMatch(
      /create or replace function public\.convert_quote_to_project\(\s*p_quote_id uuid,\s*p_actor uuid,\s*p_caller_org_id uuid,\s*p_project_number text default null\s*\)/i,
    );
  });

  it('calls recompute_project_totals after the line-item insert and before the quotes update', () => {
    // Order matters: the project header must reflect the budget by the
    // time the RPC returns. The recompute helper is `perform`ed twice in
    // this migration — once inside the trigger function (earlier in the
    // file) and once inside the redefined convert_quote_to_project. We
    // scope this assertion to the RPC body.
    const rpcMatch = sql.match(
      /create or replace function public\.convert_quote_to_project[\s\S]*?\$\$;/,
    );
    expect(rpcMatch).not.toBeNull();
    const rpcBody = rpcMatch![0];
    const insertIdx = rpcBody.indexOf('insert into public.project_line_items');
    const recomputeIdx = rpcBody.indexOf('perform public.recompute_project_totals(v_project_id)');
    const quotesUpdateIdx = rpcBody.indexOf('update public.quotes');
    expect(insertIdx).toBeGreaterThan(0);
    expect(recomputeIdx).toBeGreaterThan(insertIdx);
    expect(quotesUpdateIdx).toBeGreaterThan(recomputeIdx);
  });

  it('runs a one-shot backfill over every project that has at least one line', () => {
    const backfill = sql.match(/do \$\$[\s\S]*?end\$\$;/);
    expect(backfill).not.toBeNull();
    expect(backfill![0]).toMatch(/from public\.projects/);
    expect(backfill![0]).toMatch(
      /exists\s*\(\s*select 1[\s\S]*?from public\.project_line_items pli[\s\S]*?where pli\.project_id = p\.id/i,
    );
    expect(backfill![0]).toMatch(/perform public\.recompute_project_totals\(v_row\.id\)/);
  });

  it('does NOT introduce a deleted_at predicate inside the recompute function (project_line_items has no soft delete)', () => {
    // project_line_items has no deleted_at column per 0044:121-139. The
    // recompute SUM must not filter on a non-existent column or it will
    // error at apply time. We scope the check to the recompute function
    // body (the migration header intentionally documents the absence).
    const fnMatch = sql.match(
      /create or replace function public\.recompute_project_totals[\s\S]*?\$\$;/,
    );
    expect(fnMatch).not.toBeNull();
    expect(fnMatch![0]).not.toMatch(/deleted_at/i);
  });

  it('grants execute on the new function to authenticated + service_role only', () => {
    expect(sql).toMatch(
      /revoke execute on function public\.recompute_project_totals\(uuid\)\s*from public, anon/i,
    );
    expect(sql).toMatch(
      /grant execute on function public\.recompute_project_totals\(uuid\)\s*to authenticated, service_role/i,
    );
  });
});
