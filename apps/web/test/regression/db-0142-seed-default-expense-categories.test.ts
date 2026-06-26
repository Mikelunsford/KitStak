// Regression suite for R-W15-EDIT-02: seed the default expense categories
// (migration 0142) so the Expenses category dropdown is populated, for existing
// orgs (backfill) and new orgs (provisioning).
//
// Like db-0130, this asserts the migration SQL declares the seed helper, the
// default categories, the idempotent ON CONFLICT, the provision_organization
// wiring (preserving the existing seed surface, including the 0130 job-types
// seed it sits downstream of), the backfill, and the grants. It is a static
// SQL-text assertion suite (no DB connection), matching db-0130.

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
  '0142_seed_default_expense_categories.sql',
);

const sql = readFileSync(MIGRATION_PATH, 'utf8');

function seedFnBody(): string {
  const body = sql.match(
    /create or replace function public\.seed_org_default_expense_categories[\s\S]*?\$\$;/,
  )?.[0];
  expect(body).toBeTruthy();
  return body as string;
}

describe('migration 0142 - seed default expense categories (R-W15-EDIT-02)', () => {
  it('declares seed_org_default_expense_categories(uuid) returns void, security definer, search_path public', () => {
    expect(sql).toMatch(
      /create or replace function public\.seed_org_default_expense_categories\(\s*p_org_id uuid\s*\)\s*returns void/i,
    );
    const body = seedFnBody();
    expect(body).toMatch(/security definer/i);
    expect(body).toMatch(/set search_path = public/i);
  });

  it('seeds the default expense categories', () => {
    const body = seedFnBody();
    expect(body).toMatch(/'Freight'/);
    expect(body).toMatch(/'Packaging'/);
    expect(body).toMatch(/'Warehouse Supplies'/);
    expect(body).toMatch(/'Equipment'/);
    expect(body).toMatch(/'Software'/);
    expect(body).toMatch(/'Utilities'/);
    expect(body).toMatch(/'Labor'/);
    expect(body).toMatch(/'Other'/);
  });

  it('inserts only (org_id, code, display_name) (expense_categories has no sort_order)', () => {
    expect(seedFnBody()).toMatch(
      /insert into public\.expense_categories \(org_id, code, display_name\)/i,
    );
  });

  it('is idempotent on the (org_id, code) unique key', () => {
    expect(seedFnBody()).toMatch(/on conflict \(org_id, code\) do nothing/i);
  });

  it('wires the seed into provision_organization without dropping the existing seed surface', () => {
    const provisionBody = sql.match(
      /create or replace function public\.provision_organization[\s\S]*?\$\$;/,
    )?.[0];
    expect(provisionBody).toBeTruthy();
    expect(provisionBody!).toMatch(
      /perform public\.seed_org_default_expense_categories\(v_org_id\)/i,
    );
    // The existing seed surface must be preserved (not dropped in the rewrite),
    // including the 0130 job-types seed this migration sits downstream of.
    expect(provisionBody!).toMatch(/perform public\.seed_org_default_warehouse\(v_org_id\)/i);
    expect(provisionBody!).toMatch(/perform public\.seed_org_default_job_types\(v_org_id\)/i);
    expect(provisionBody!).toMatch(/kitstak_org_id/);
  });

  it('backfills every existing org via a loop over organizations', () => {
    expect(sql).toMatch(/for r in select id from public\.organizations loop/i);
    expect(sql).toMatch(
      /perform public\.seed_org_default_expense_categories\(r\.id\)/i,
    );
  });

  it('grants execute on the seed helper to service_role only', () => {
    expect(sql).toMatch(
      /revoke execute on function public\.seed_org_default_expense_categories\(uuid\)\s*from public, anon/i,
    );
    expect(sql).toMatch(
      /grant execute on function public\.seed_org_default_expense_categories\(uuid\)\s*to service_role/i,
    );
  });

  it('keeps provision_organization service_role only', () => {
    expect(sql).toMatch(
      /grant\s+execute on function public\.provision_organization\(text, text, uuid, text\)\s*to service_role/i,
    );
  });
});
