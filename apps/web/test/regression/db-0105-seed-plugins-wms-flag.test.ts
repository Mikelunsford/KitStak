// Regression suite for Wave 12 / B0 (WMS chassis). Migration 0105 appends
// 'plugins.wms' to the canonical flag set that seed_org_settings seeds, so
// every org gets a plugins.wms = false row (WMS is a paid add-on, off until
// flipped on). Static SQL content checks, mirroring the db-0097 shape.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const sql = readFileSync(
  join(__dirname, '..', '..', '..', '..', 'supabase', 'migrations', '0105_seed_plugins_wms_flag.sql'),
  'utf8',
);

// The DOWN MIGRATION header comment inlines the prior flag-set description, so
// match against the executable DDL only (comment lines stripped) to avoid
// asserting against the commented restore block.
const ddl = sql
  .split('\n')
  .filter((l) => !l.trimStart().startsWith('--'))
  .join('\n');

describe('migration 0105: seed plugins.wms flag (B0)', () => {
  it('redefines seed_org_settings', () => {
    expect(ddl).toMatch(
      /create or replace function public\.seed_org_settings\(p_org_id uuid\)/i,
    );
  });

  it('appends plugins.wms to the v_flags array, keeping the existing flags', () => {
    const fn = ddl.match(
      /create or replace function public\.seed_org_settings[\s\S]*?\$\$;/,
    )?.[0];
    expect(fn!).toContain("'plugins.wms'");
    // The five prior pillar plugin flags are still present and not reordered
    // away.
    expect(fn!).toContain("'plugins.three_pl'");
    expect(fn!).toContain("'plugins.manufacturing'");
    expect(fn!).toContain("'plugins.copack_ecom'");
    expect(fn!).toContain("'plugins.kitforce'");
    expect(fn!).toContain("'plugins.kitcost'");
    // And the five feature flags carried from 0064.
    expect(fn!).toContain("'feature.collaboration'");
    expect(fn!).toContain("'feature.global_search'");
    expect(fn!).toContain("'feature.imports'");
    expect(fn!).toContain("'feature.exports'");
    expect(fn!).toContain("'feature.customer_portal'");
  });

  it('seeds each flag is_enabled = false on conflict do nothing (so plugins.wms is OFF)', () => {
    const fn = ddl.match(
      /create or replace function public\.seed_org_settings[\s\S]*?\$\$;/,
    )?.[0];
    expect(fn!).toMatch(
      /insert into public\.org_feature_flags \(org_id, flag_key, is_enabled, config\)\s*values \(p_org_id, v_flag, false, '\{\}'::jsonb\)/i,
    );
    expect(fn!).toMatch(/on conflict \(org_id, flag_key\) do nothing/i);
  });

  it('keeps seed_org_settings service-role only', () => {
    expect(ddl).toMatch(
      /revoke execute on function public\.seed_org_settings\(uuid\)\s*from public, anon, authenticated/i,
    );
    expect(ddl).toMatch(
      /grant execute on function public\.seed_org_settings\(uuid\)\s*to service_role/i,
    );
  });

  it('includes an idempotent backfill loop over public.organizations', () => {
    const backfill = ddl.match(/do \$\$[\s\S]*?end\$\$;/)?.[0];
    expect(backfill!).toMatch(/for v_org_id in[\s\S]*?select id from public\.organizations/i);
    expect(backfill!).toMatch(/perform public\.seed_org_settings\(v_org_id\)/i);
  });

  it('does NOT touch RLS, money, idempotency, or audit_log DDL', () => {
    expect(ddl).not.toMatch(/create policy/i);
    expect(ddl).not.toMatch(/alter table[\s\S]*?enable row level security/i);
    expect(ddl).not.toMatch(/_cents/);
    expect(ddl).not.toMatch(/idempotency_keys/i);
    expect(ddl).not.toMatch(/audit_log/i);
  });
});
