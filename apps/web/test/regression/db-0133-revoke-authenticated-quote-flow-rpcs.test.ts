// Regression for the post-quote-flow RPC-grant hardening (migration 0133).
// duplicate_quote (0129) and seed_org_default_job_types (0130) were defined with
// the pre-sweep 0094 grant pattern (EXECUTE to authenticated, service_role),
// re-introducing a direct authenticated grant that the 0111 / 0117 sweep had
// removed from every other SECURITY DEFINER public function. The SPA never calls
// an RPC directly (zero .rpc() in apps/web/src) and the edge invokes both via
// admin() (service_role), so the authenticated grant is an unused PostgREST
// attack surface: an authenticated POST to /rest/v1/rpc/<fn> with known UUID
// arguments could trigger an unauthorized cross-org write. 0133 revokes
// authenticated EXECUTE on both, keeping service_role.
//
// Static content checks (mirror db-0111). The functional revoke (authenticated
// cannot execute, service_role still can) was validated on staging in an aborting
// transaction during the build, with the catalog signatures verified against
// pg_proc on prod and staging (both at max_migration 0132, 2026-06-23).

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const sql = readFileSync(
  join(
    __dirname, '..', '..', '..', '..',
    'supabase', 'migrations', '0133_revoke_authenticated_execute_quote_flow_rpcs.sql',
  ),
  'utf8',
);

// Statement body only: drop `--` comment lines so the header prose (which shows a
// DOWN re-grant example and names the RLS helpers) cannot false-match.
const body = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

// The two quote-flow RPCs whose authenticated EXECUTE grant 0133 revokes, with
// their exact catalog signatures (verified against pg_proc on prod 2026-06-23).
const REVOKE_TARGETS: ReadonlyArray<readonly [string, string]> = [
  ['duplicate_quote', 'uuid, uuid, uuid'],
  ['seed_org_default_job_types', 'uuid'],
];

function esc(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

describe('migration 0133 - quote-flow RPC-grant hardening', () => {
  it('revokes authenticated EXECUTE on both quote-flow RPCs, by exact signature', () => {
    for (const [fn, args] of REVOKE_TARGETS) {
      const re = new RegExp(
        `revoke\\s+execute\\s+on\\s+function\\s+public\\.${esc(fn)}\\(\\s*${esc(args)}\\s*\\)\\s+from\\s+authenticated`,
        'i',
      );
      expect(body, `0133 must revoke authenticated execute on ${fn}(${args})`).toMatch(re);
    }
  });

  it('does NOT revoke the RLS-context helpers (control against an over-broad revoke)', () => {
    // current_org_id / current_user_role are evaluated inside RLS USING / WITH
    // CHECK clauses as the authenticated user; revoking them breaks tenant
    // isolation app-wide. They must keep their authenticated grant.
    expect(body).not.toMatch(/revoke\s+execute\s+on\s+function\s+public\.current_org_id/i);
    expect(body).not.toMatch(/revoke\s+execute\s+on\s+function\s+public\.current_user_role/i);
  });

  it('is a permission-only change: no schema, RLS, money, or audit DDL and no re-grant', () => {
    expect(body).not.toMatch(/create\s+table/i);
    expect(body).not.toMatch(/alter\s+table/i);
    expect(body).not.toMatch(/create\s+(or\s+replace\s+)?function/i);
    expect(body).not.toMatch(/create\s+policy/i);
    expect(body).not.toMatch(/drop\s+(table|function|trigger|policy|constraint|index)/i);
    // 0133 only revokes; it never grants (the DOWN re-grant lives in comments).
    expect(body).not.toMatch(/grant\s+execute/i);
  });

  it('declares the constitutional header', () => {
    expect(sql).toMatch(/Migration:\s*0133_/);
    expect(sql).toMatch(/Closes:/);
    expect(sql).toMatch(/DOWN MIGRATION/);
    expect(sql).toMatch(/Constitutional alignment/i);
  });
});
