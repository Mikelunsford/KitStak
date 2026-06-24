// Regression for ADR 0004 unit 4: duplicate_quote tier-awareness (migration 0135).
// The 0129 duplicate_quote predated native tiers (0132) and line billing_interval
// (0131), so its line copy silently dropped both: duplicating a tiered quote lost
// the tiers (cloned lines tier_id null), and a monthly line reset to one_time. 0135
// clones the source's tiers (new ids) and remaps each cloned line's tier_id to its
// new tier, and copies billing_interval through, while keeping the non-tiered path
// byte-identical and the post-0133 service_role-only grant.
//
// Like db-0129 / db-0134 this asserts the migration SQL; the functional clone
// (tiers cloned with new ids, lines remapped, billing_interval preserved, FK
// satisfied, totals recomputed) was validated on staging in an aborting
// transaction during the build.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const sql = readFileSync(
  join(
    __dirname, '..', '..', '..', '..',
    'supabase', 'migrations', '0135_duplicate_quote_tier_aware.sql',
  ),
  'utf8',
);

describe('migration 0135 - duplicate_quote tier-aware (ADR 0004)', () => {
  it('redefines duplicate_quote(uuid,uuid,uuid) as SECURITY DEFINER, org-gated', () => {
    expect(sql).toMatch(
      /create or replace function public\.duplicate_quote\(\s*p_source_quote_id uuid,\s*p_actor uuid,\s*p_caller_org_id uuid\s*\)/i,
    );
    expect(sql).toMatch(/security definer/i);
    expect(sql).toMatch(/NOT_FOUND: quote not found/);
  });

  it('clones the source tiers with new ids (materialized map) onto the new quote', () => {
    expect(sql).toMatch(/with src_tiers as materialized/i);
    expect(sql).toMatch(/gen_random_uuid\(\) as new_id/i);
    expect(sql).toMatch(/insert into public\.quote_tiers/i);
    // The cloned tiers belong to the NEW quote.
    expect(sql).toMatch(/select\s+new_id, v_new_quote_id/i);
  });

  it('remaps each cloned line tier_id to its new tier via a left join (null stays null)', () => {
    expect(sql).toMatch(/left join src_tiers st on st\.old_id = li\.tier_id/i);
    // The line copy uses the remapped new_id, not the source tier_id.
    expect(sql).toMatch(/li\.is_taxable,\s*li\.billing_interval, st\.new_id,/i);
  });

  it('copies billing_interval through (the 0131 column the 0129 copy dropped)', () => {
    expect(sql).toMatch(/billing_interval, tier_id,/i); // insert column list
    expect(sql).toMatch(/li\.billing_interval/i); // select
  });

  it('recomputes the cloned quote totals via the authoritative helper', () => {
    expect(sql).toMatch(/perform public\.recompute_quote_totals\(v_new_quote_id\)/i);
  });

  it('preserves the post-0133 grant baseline (service_role only, never re-grants authenticated)', () => {
    expect(sql).toMatch(
      /revoke execute on function public\.duplicate_quote\(uuid, uuid, uuid\)\s+from public, anon, authenticated/i,
    );
    expect(sql).toMatch(
      /grant execute on function public\.duplicate_quote\(uuid, uuid, uuid\)\s+to service_role/i,
    );
    expect(sql).not.toMatch(
      /grant execute on function public\.duplicate_quote\(uuid, uuid, uuid\)\s+to[^;]*authenticated/i,
    );
  });

  it('declares the constitutional header', () => {
    expect(sql).toMatch(/Migration:\s*0135_/);
    expect(sql).toMatch(/Wave:.*ADR 0004/i);
    expect(sql).toMatch(/DOWN MIGRATION/);
    expect(sql).toMatch(/Grants/);
  });
});
