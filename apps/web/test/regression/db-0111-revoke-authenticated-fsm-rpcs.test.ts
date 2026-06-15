// Regression suite for Wave 12 RPC-grant hardening (migration 0111).
// F-Wave12-WMS-FSM-RPC-GRANT-HARDEN-01. The state-changing action / transition
// RPCs were granted EXECUTE to BOTH authenticated and service_role at their
// defining migrations. The SPA never calls an RPC directly (zero .rpc() in
// apps/web/src) and the edge invokes them via admin() (service_role), so the
// authenticated grant is an unused PostgREST attack surface: a hand-rolled POST
// to /rest/v1/rpc/<fn> from an authenticated session could reach these SECURITY
// DEFINER functions and try to bypass the edge requireCap gate or spoof
// p_caller_org_id. 0111 revokes authenticated EXECUTE on those 18 RPCs only,
// keeping service_role (so the edge is unaffected) and the RLS-context helpers
// (current_org_id / current_user_role) intact.
//
// Static content checks (mirror db-0110 / db-0109 style). The functional revoke
// (authenticated cannot execute, service_role still can, the RLS helpers
// unaffected) was validated on staging in an aborting transaction during the
// build, with the catalog signatures verified against pg_proc on prod.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const sql = readFileSync(
  join(
    __dirname, '..', '..', '..', '..',
    'supabase', 'migrations', '0111_revoke_authenticated_execute_on_fsm_action_rpcs.sql',
  ),
  'utf8',
);

// Statement body only: drop `--` comment lines so the header prose (which names
// the RLS helpers and shows a DOWN re-grant example) cannot false-match.
const body = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

// The 18 action / transition RPCs whose authenticated EXECUTE grant 0111 revokes,
// with their exact catalog signatures (verified against pg_proc on prod 2026-06-15).
const REVOKE_TARGETS: ReadonlyArray<readonly [string, string]> = [
  ['start_job_run', 'uuid, uuid, uuid'],
  ['complete_job_run', 'uuid, uuid, uuid'],
  ['close_job_run', 'uuid, uuid, uuid'],
  ['cancel_job_run', 'uuid, uuid, uuid'],
  ['post_job_run_daily_log', 'uuid, uuid, uuid'],
  ['release_supply_plan', 'uuid, uuid, uuid'],
  ['cancel_supply_plan', 'uuid, uuid, uuid'],
  ['fulfill_supply_plan', 'uuid, uuid, uuid'],
  ['approve_billing_review', 'uuid, uuid, uuid, text'],
  ['cancel_billing_review', 'uuid, uuid, uuid'],
  ['start_putaway_task', 'uuid, uuid, uuid'],
  ['complete_putaway_task', 'uuid, uuid, uuid'],
  ['cancel_putaway_task', 'uuid, uuid, uuid'],
  ['quarantine_lot', 'uuid, uuid, uuid'],
  ['post_journal_entry', 'uuid'],
  ['close_period', 'uuid, integer, integer'],
  ['reopen_period', 'uuid, integer, integer'],
  ['convert_quote_to_project', 'uuid, uuid, uuid, text'],
];

function esc(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

describe('migration 0111 RPC-grant hardening', () => {
  it('revokes authenticated EXECUTE on all 18 action / transition RPCs, by exact signature', () => {
    expect(REVOKE_TARGETS).toHaveLength(18);
    for (const [fn, args] of REVOKE_TARGETS) {
      const re = new RegExp(
        `revoke\\s+execute\\s+on\\s+function\\s+public\\.${esc(fn)}\\(\\s*${esc(args)}\\s*\\)\\s+from\\s+authenticated`,
        'i',
      );
      expect(body, `0111 must revoke authenticated execute on ${fn}(${args})`).toMatch(re);
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
    // 0111 only revokes; it never grants (the DOWN re-grant lives in comments).
    expect(body).not.toMatch(/grant\s+execute/i);
  });

  it('declares the constitutional header', () => {
    expect(sql).toMatch(/Wave:\s*12/);
    expect(sql).toMatch(/Closes:\s*F-Wave12-WMS-FSM-RPC-GRANT-HARDEN-01/);
    expect(sql).toMatch(/DOWN MIGRATION/);
    expect(sql).toMatch(/Constitutional alignment/i);
  });
});
