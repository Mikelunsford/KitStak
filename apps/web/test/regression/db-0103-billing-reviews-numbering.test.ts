// Regression suite for Wave 12 / A7 step 2: migration 0103 wires
// billing_reviews.review_number into the org-scoped numbering chassis with the
// BILL- prefix (handoff decision 1: BILL- is free). Static content checks;
// validated on staging during the A7 build.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const sql = readFileSync(
  join(__dirname, '..', '..', '..', '..', 'supabase', 'migrations', '0103_billing_reviews_numbering.sql'),
  'utf8',
);

// The DOWN MIGRATION header comment inlines the prior (0100) constraint text, so
// match against the executable DDL only (comment lines stripped) to avoid
// asserting against the commented restore block.
const ddl = sql
  .split('\n')
  .filter((l) => !l.trimStart().startsWith('--'))
  .join('\n');

describe('migration 0103: billing review numbering (A7)', () => {
  it('extends the doc_type CHECK with billing_review as a strict superset of 0100', () => {
    const check = ddl.match(/add constraint numbering_sequences_doc_type_check[\s\S]*?\)\);/)?.[0];
    expect(check!).toContain("'billing_review'");
    // still a superset of the 0100 list
    expect(check!).toContain("'job_run'");
    expect(check!).toContain("'supply_plan'");
    expect(check!).toContain("'job_template'");
    expect(check!).toContain("'three_pl_account'");
  });

  it('seeds a billing_review row with the BILL- prefix for every existing org', () => {
    const seed = ddl.match(/insert into public\.numbering_sequences[\s\S]*?on conflict \(org_id, doc_type\) do nothing;/)?.[0];
    expect(seed!).toMatch(/\('billing_review', 'BILL-'\)/);
  });

  it('extends seed_org_numbering with billing_review / BILL- positionally aligned', () => {
    const fn = ddl.match(/create or replace function public\.seed_org_numbering[\s\S]*?\$\$;/)?.[0];
    expect(fn!).toMatch(/'job_run', 'billing_review'\s*\]/);
    expect(fn!).toMatch(/'JR-', 'BILL-'\s*\]/);
  });

  it('BILL- is distinct from the spine invoice INV- prefix', () => {
    // BILL- is the review number; the approve path consumes the spine invoice
    // INV- prefix separately. No collision.
    expect(ddl).toMatch(/'INV-'/);
    expect(ddl).not.toMatch(/'billing_review', 'INV-'/);
  });
});
