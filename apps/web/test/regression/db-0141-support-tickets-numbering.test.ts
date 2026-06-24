// Regression suite for migration 0141: register the 'feedback' doc_type on the
// numbering chassis so support tickets get a per-org FB- reference. Extends the
// doc_type CHECK (strict superset), seeds a sequence for every existing org,
// and extends seed_org_numbering so newly provisioned orgs get one too.
//
// Static content checks against the migration SQL.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const sql = readFileSync(
  join(__dirname, '..', '..', '..', '..', 'supabase', 'migrations', '0141_support_tickets_numbering.sql'),
  'utf8',
);

describe('migration 0141: support ticket numbering (feedback / FB-)', () => {
  it('extends the doc_type CHECK with feedback as a strict superset', () => {
    const check = sql.match(/add constraint numbering_sequences_doc_type_check[\s\S]*?\)\);/)?.[0];
    expect(check).toBeTruthy();
    expect(check!).toContain("'feedback'");
    // superset of the prior list
    expect(check!).toContain("'billing_review'");
    expect(check!).toContain("'invoice'");
    expect(check!).toContain("'quote'");
  });

  it('seeds a feedback sequence per existing org with the FB- prefix, idempotently', () => {
    const seed = sql.match(/insert into public\.numbering_sequences \([\s\S]*?on conflict \(org_id, doc_type\) do nothing;/)?.[0];
    expect(seed).toBeTruthy();
    expect(seed!).toMatch(/\('feedback', 'FB-'\)/i);
    expect(seed!).toMatch(/from public\.organizations o/i);
  });

  it('extends seed_org_numbering arrays with feedback / FB- for future orgs', () => {
    const fn = sql.match(/create or replace function public\.seed_org_numbering\(p_org_id uuid\)[\s\S]*?\$function\$;/)?.[0];
    expect(fn).toBeTruthy();
    expect(fn!).toMatch(/'feedback'\s*\n\s*\];/i);
    expect(fn!).toMatch(/'FB-'\s*\n\s*\];/i);
    // the prior tail entries are preserved (superset, not a replacement)
    expect(fn!).toContain("'billing_review'");
    expect(fn!).toContain("'journal_entry'");
    expect(fn!).toContain("'JE-M-'");
  });
});
