// Regression suite for migration 0119: server-assigned numbering for manual
// journal entries. 0119 seeds a journal_entry numbering_sequences row for every
// org with the JE-M- prefix and extends seed_org_numbering to match. The JE-M-
// lane is deliberately distinct from the JE- namespace the 0024 auto-JE
// triggers mint (JE-INV-, JE-PAY-, JE-CN-) so manual and auto entries never
// collide on journal_entries.unique(org_id, entry_number). Static content
// checks; validated on staging during the build.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const sql = readFileSync(
  join(__dirname, '..', '..', '..', '..', 'supabase', 'migrations', '0119_journal_entry_numbering.sql'),
  'utf8',
);

// The DOWN MIGRATION header comment inlines the prior (0103) constraint text, so
// match against the executable DDL only (comment lines stripped) to avoid
// asserting against the commented restore block.
const ddl = sql
  .split('\n')
  .filter((l) => !l.trimStart().startsWith('--'))
  .join('\n');

describe('migration 0119: journal entry numbering (manual lane)', () => {
  it('re-states the doc_type CHECK as a superset including journal_entry', () => {
    const check = ddl.match(/add constraint numbering_sequences_doc_type_check[\s\S]*?\)\);/)?.[0];
    expect(check!).toContain("'journal_entry'");
    // still a superset of the 0103 list
    expect(check!).toContain("'billing_review'");
    expect(check!).toContain("'job_run'");
    expect(check!).toContain("'supply_plan'");
    expect(check!).toContain("'three_pl_account'");
  });

  it('seeds a journal_entry row with the JE-M- prefix for every existing org', () => {
    const seed = ddl.match(/insert into public\.numbering_sequences[\s\S]*?on conflict \(org_id, doc_type\) do nothing;/)?.[0];
    expect(seed!).toMatch(/\('journal_entry', 'JE-M-'\)/);
    // seeded across every org via the organizations cross join
    expect(seed!).toMatch(/from public\.organizations o/);
    expect(seed!).toMatch(/cross join/);
  });

  it('extends seed_org_numbering with journal_entry / JE-M- positionally aligned', () => {
    const fn = ddl.match(/create or replace function public\.seed_org_numbering[\s\S]*?\$\$;/)?.[0];
    expect(fn!).toMatch(/'billing_review',\s*'journal_entry'\s*\]/);
    expect(fn!).toMatch(/'BILL-',\s*'JE-M-'\s*\]/);
  });

  it('keeps the manual JE-M- prefix out of the JE- auto-JE namespace', () => {
    // The 0024 auto-JE triggers mint JE-INV-/JE-PAY-/JE-CN- numbers. The manual
    // lane must seed JE-M-, never a bare JE- prefix, to avoid colliding on the
    // journal_entries unique(org_id, entry_number) index.
    expect(ddl).toMatch(/'JE-M-'/);
    expect(ddl).not.toMatch(/'journal_entry', 'JE-'\)/);
  });
});
