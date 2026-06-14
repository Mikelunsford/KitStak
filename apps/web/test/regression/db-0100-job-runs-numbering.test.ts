// Regression suite for Wave 12 / A6 step 3 — migration 0100 wires
// job_runs.run_number into the org-scoped numbering chassis with the JR- prefix
// (decision 1: RUN- collides with the spine production_run doc_type). Static
// content checks; validated on staging during the A6 build (next_doc_number
// yielded JR-2026-00001 after seed_org_numbering ran for the org).

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const sql = readFileSync(
  join(__dirname, '..', '..', '..', '..', 'supabase', 'migrations', '0100_job_runs_numbering.sql'),
  'utf8',
);

// The DOWN MIGRATION header comment inlines the prior (0097) constraint text, so
// match against the executable DDL only (comment lines stripped) to avoid
// asserting against the commented restore block.
const ddl = sql
  .split('\n')
  .filter((l) => !l.trimStart().startsWith('--'))
  .join('\n');

describe('migration 0100 — job run numbering (A6)', () => {
  it('extends the doc_type CHECK with job_run as a strict superset of 0097', () => {
    const check = ddl.match(/add constraint numbering_sequences_doc_type_check[\s\S]*?\)\);/)?.[0];
    expect(check!).toContain("'job_run'");
    // still a superset of the 0097 list
    expect(check!).toContain("'supply_plan'");
    expect(check!).toContain("'job_template'");
    expect(check!).toContain("'three_pl_account'");
  });

  it('seeds a job_run row with the JR- prefix for every existing org', () => {
    const seed = ddl.match(/insert into public\.numbering_sequences[\s\S]*?on conflict \(org_id, doc_type\) do nothing;/)?.[0];
    expect(seed!).toMatch(/\('job_run', 'JR-'\)/);
  });

  it('extends seed_org_numbering with job_run / JR- positionally aligned', () => {
    const fn = ddl.match(/create or replace function public\.seed_org_numbering[\s\S]*?\$\$;/)?.[0];
    expect(fn!).toMatch(/'supply_plan', 'job_run'\s*\]/);
    expect(fn!).toMatch(/'SUP-', 'JR-'\s*\]/);
  });

  it('JR- is distinct from the production_run RUN- prefix (decision 1)', () => {
    // RUN- still maps to production_run, not job_run.
    expect(ddl).toMatch(/'RUN-'/);
    expect(ddl).not.toMatch(/'job_run', 'RUN-'/);
  });
});
