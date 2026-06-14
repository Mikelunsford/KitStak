// Regression suite for Wave 12 / A5 step 3 — migration 0097 wires
// supply_plans.plan_number into the org-scoped numbering chassis with the SUP-
// prefix, mirroring 0090 (ACC-) and 0092 (JB-). Static content checks.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const sql = readFileSync(
  join(__dirname, '..', '..', '..', '..', 'supabase', 'migrations', '0097_supply_plans_numbering.sql'),
  'utf8',
);

// The DOWN MIGRATION header comment inlines the prior (0092) constraint text, so
// match against the executable DDL only (comment lines stripped) to avoid
// asserting against the commented restore block.
const ddl = sql
  .split('\n')
  .filter((l) => !l.trimStart().startsWith('--'))
  .join('\n');

describe('migration 0097 — supply plan numbering (A5)', () => {
  it('extends the doc_type CHECK with supply_plan as a strict superset of 0092', () => {
    const check = ddl.match(/add constraint numbering_sequences_doc_type_check[\s\S]*?\)\);/)?.[0];
    expect(check!).toContain("'supply_plan'");
    // prior 3PL doc_types still present
    expect(check!).toContain("'three_pl_account'");
    expect(check!).toContain("'job_template'");
  });

  it('seeds a supply_plan row with the SUP- prefix for every existing org', () => {
    const seed = ddl.match(/insert into public\.numbering_sequences[\s\S]*?on conflict \(org_id, doc_type\) do nothing;/)?.[0];
    expect(seed!).toMatch(/\('supply_plan', 'SUP-'\)/);
    expect(seed!).toMatch(/from public\.organizations o/i);
  });

  it('extends seed_org_numbering with supply_plan / SUP- (keeping the 0092 entries)', () => {
    const fn = ddl.match(/create or replace function public\.seed_org_numbering[\s\S]*?\$\$;/)?.[0];
    expect(fn!).toContain("'supply_plan'");
    expect(fn!).toContain("'SUP-'");
    expect(fn!).toContain("'job_template'");
    expect(fn!).toContain("'three_pl_account'");
  });

  it('keeps seed_org_numbering service-role only', () => {
    expect(ddl).toMatch(/revoke execute on function public\.seed_org_numbering\(uuid\)\s*from public, anon, authenticated/i);
    expect(ddl).toMatch(/grant execute on function public\.seed_org_numbering\(uuid\)\s*to service_role/i);
  });
});
