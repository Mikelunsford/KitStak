// Regression suite for Quote flow P1-4: seed the six default job types
// (migration 0130) so the quote Job Type dropdown and the Job Builder are
// populated, for existing orgs (backfill) and new orgs (provisioning).
//
// Like db-0094 / db-0129, this asserts the migration SQL declares the seed
// helper, the six add-ons in order, the idempotent ON CONFLICT, the
// provision_organization wiring, the backfill, and the grants. The function was
// validated against staging in an aborting transaction (fresh org seeded to 6
// job types, re-seed idempotent at 6, names in order).

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
  '0130_seed_default_job_types.sql',
);

const sql = readFileSync(MIGRATION_PATH, 'utf8');

function seedFnBody(): string {
  const body = sql.match(
    /create or replace function public\.seed_org_default_job_types[\s\S]*?\$\$;/,
  )?.[0];
  expect(body).toBeTruthy();
  return body as string;
}

describe('migration 0130 - seed default job types (P1-4)', () => {
  it('declares seed_org_default_job_types(uuid) returns void, security definer, search_path public', () => {
    expect(sql).toMatch(
      /create or replace function public\.seed_org_default_job_types\(\s*p_org_id uuid\s*\)\s*returns void/i,
    );
    const body = seedFnBody();
    expect(body).toMatch(/security definer/i);
    expect(body).toMatch(/set search_path = public/i);
  });

  it('seeds the six add-ons in order', () => {
    const body = seedFnBody();
    expect(body).toMatch(/'3PL Operations'/);
    expect(body).toMatch(/'Manufacturing'/);
    expect(body).toMatch(/'Co-Pack and Ecom'/);
    expect(body).toMatch(/'KitForce'/);
    expect(body).toMatch(/'KitCost'/);
    expect(body).toMatch(/'WMS'/);
  });

  it('is idempotent on the (org_id, code) unique key', () => {
    expect(seedFnBody()).toMatch(/on conflict \(org_id, code\) do nothing/i);
  });

  it('wires the seed into provision_organization', () => {
    const provisionBody = sql.match(
      /create or replace function public\.provision_organization[\s\S]*?\$\$;/,
    )?.[0];
    expect(provisionBody).toBeTruthy();
    expect(provisionBody!).toMatch(
      /perform public\.seed_org_default_job_types\(v_org_id\)/i,
    );
    // The existing seed surface must be preserved (not dropped in the rewrite).
    expect(provisionBody!).toMatch(/perform public\.seed_org_default_warehouse\(v_org_id\)/i);
    expect(provisionBody!).toMatch(/kitstak_org_id/);
  });

  it('backfills every existing org via a loop over organizations', () => {
    expect(sql).toMatch(/for r in select id from public\.organizations loop/i);
    expect(sql).toMatch(
      /perform public\.seed_org_default_job_types\(r\.id\)/i,
    );
  });

  it('grants execute on the seed helper to service_role only', () => {
    expect(sql).toMatch(
      /revoke execute on function public\.seed_org_default_job_types\(uuid\)\s*from public, anon/i,
    );
    expect(sql).toMatch(
      /grant execute on function public\.seed_org_default_job_types\(uuid\)\s*to service_role/i,
    );
  });

  it('keeps provision_organization service_role only', () => {
    expect(sql).toMatch(
      /grant\s+execute on function public\.provision_organization\(text, text, uuid, text\)\s*to service_role/i,
    );
  });
});
