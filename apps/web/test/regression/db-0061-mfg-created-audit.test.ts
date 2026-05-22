// Regression suite for B10 — manufacturing_runs must emit an audit_log row
// at INSERT time so the History panel does not render "No history yet" for
// runs that have not yet transitioned out of 'draft'.
//
// Background (2026-05-21 E2E smoke walk, journal at
// 03-workspace/journal/2026-05-21-e2e-smoke-investigation.md):
//   trg_audit_manufacturing_runs_status (0052:385-437) writes to audit_log
//   only when status changes. It is wired AFTER UPDATE OF status, so a
//   newly-inserted draft run never produces a 'created' row.
//
// Fix (migration 0061):
//   1. trg_audit_manufacturing_runs_created — SECURITY DEFINER trigger
//      function firing AFTER INSERT, writing one audit_log row with
//      action='created', from_state=null, to_state=new.status.
//   2. Backfill DO-block writing the missing 'created' rows for every
//      historical manufacturing_runs row that lacks one. Idempotent via
//      a NOT EXISTS guard.
//   3. Migration 0052 must remain untouched (forward-only).
//
// This regression cannot exercise the DB trigger directly (no DB harness
// is wired into apps/web/test). It asserts the migration declares the
// expected function shape, trigger wiring, and backfill — the same
// static-content shape used by db-0059-project-budget-recompute.test.ts.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..', '..', '..');
const MIGRATION_PATH = join(
  ROOT,
  'supabase',
  'migrations',
  '0061_manufacturing_run_created_audit.sql',
);
const PRIOR_MIGRATION_PATH = join(
  ROOT,
  'supabase',
  'migrations',
  '0052_manufacturing_runs_schema.sql',
);

const sql = readFileSync(MIGRATION_PATH, 'utf8');
const priorSql = readFileSync(PRIOR_MIGRATION_PATH, 'utf8');

describe('migration 0061 — manufacturing_runs INSERT audit row (B10)', () => {
  it('declares trg_audit_manufacturing_runs_created as a SECURITY DEFINER trigger function', () => {
    expect(sql).toMatch(
      /create or replace function public\.trg_audit_manufacturing_runs_created\(\)/i,
    );
    expect(sql).toMatch(/returns trigger/i);
    expect(sql).toMatch(/security definer/i);
  });

  it('wires the trigger AFTER INSERT (not AFTER UPDATE) on manufacturing_runs', () => {
    expect(sql).toMatch(
      /drop trigger if exists audit_manufacturing_runs_created on public\.manufacturing_runs;/i,
    );
    expect(sql).toMatch(
      /create trigger audit_manufacturing_runs_created\s+after insert on public\.manufacturing_runs/i,
    );
    expect(sql).toMatch(
      /execute function public\.trg_audit_manufacturing_runs_created\(\)/i,
    );
    // Explicit negative: must NOT wire as AFTER UPDATE — that would duplicate
    // the existing 0052 trigger and miss the 'draft' birth event.
    const triggerBlock = sql.match(
      /create trigger audit_manufacturing_runs_created[\s\S]*?execute function public\.trg_audit_manufacturing_runs_created\(\);/i,
    );
    expect(triggerBlock).not.toBeNull();
    expect(triggerBlock![0]).not.toMatch(/after update/i);
  });

  it('writes the literal action constant \'created\' (not status_change)', () => {
    const fnBody = sql.match(
      /create or replace function public\.trg_audit_manufacturing_runs_created[\s\S]*?\$\$;/,
    );
    expect(fnBody).not.toBeNull();
    expect(fnBody![0]).toMatch(/'created'/);
    expect(fnBody![0]).not.toMatch(/'status_change'/);
  });

  it('writes from_state=null and to_state=new.status into the audit_log row', () => {
    const fnBody = sql.match(
      /create or replace function public\.trg_audit_manufacturing_runs_created[\s\S]*?\$\$;/,
    );
    expect(fnBody).not.toBeNull();
    // The INSERT VALUES tuple must pass null for from_state and new.status
    // for to_state. Order matches the audit_log columns enumerated in 0052.
    expect(fnBody![0]).toMatch(
      /values\s*\(\s*new\.org_id,\s*'manufacturing_run',\s*new\.id,\s*null,\s*new\.status,\s*'created'/i,
    );
  });

  it('uses coalesce(auth.uid(), new.created_by) for triggered_by', () => {
    // Distinct from the 0052 status trigger which uses new.updated_by — a
    // creation event has no prior actor, so created_by is the right fallback.
    const fnBody = sql.match(
      /create or replace function public\.trg_audit_manufacturing_runs_created[\s\S]*?\$\$;/,
    );
    expect(fnBody).not.toBeNull();
    expect(fnBody![0]).toMatch(/coalesce\(auth\.uid\(\),\s*new\.created_by\)/i);
  });

  it('reuses kitstak_audit_canonical for the payload hash', () => {
    expect(sql).toMatch(
      /extensions\.digest\(\s*public\.kitstak_audit_canonical\(v_payload\),\s*'sha256'\s*\)/i,
    );
  });

  it('holds a per-org advisory lock and reads prev_hash scoped to new.org_id', () => {
    // Hash-chain correctness requires both: the advisory lock serializes
    // appends per org, and the prev_hash lookup must be org-scoped (a
    // global lookup would chain into another tenant's history).
    const fnBody = sql.match(
      /create or replace function public\.trg_audit_manufacturing_runs_created[\s\S]*?\$\$;/,
    );
    expect(fnBody).not.toBeNull();
    expect(fnBody![0]).toMatch(/pg_advisory_xact_lock\(v_lock_key\)/);
    expect(fnBody![0]).toMatch(/md5\(new\.org_id::text\)/);
    expect(fnBody![0]).toMatch(/where org_id = new\.org_id/i);
  });

  it('declares a backfill DO-block referencing manufacturing_runs with a NOT EXISTS guard', () => {
    const backfill = sql.match(/do \$\$[\s\S]*?end\$\$;/);
    expect(backfill).not.toBeNull();
    expect(backfill![0]).toMatch(/from public\.manufacturing_runs/i);
    // Idempotency: re-running must skip rows that already carry a 'created'
    // audit entry. NOT EXISTS predicate against audit_log is the gate.
    expect(backfill![0]).toMatch(/not exists/i);
    expect(backfill![0]).toMatch(/entity_type = 'manufacturing_run'/);
    expect(backfill![0]).toMatch(/action = 'created'/);
  });

  it('backfill iterates in chronological order so the hash chain reflects birth order', () => {
    const backfill = sql.match(/do \$\$[\s\S]*?end\$\$;/);
    expect(backfill).not.toBeNull();
    expect(backfill![0]).toMatch(/order by created_at/i);
  });

  it('grants execute on the new function to nobody but the table owner (REVOKE from public, anon)', () => {
    expect(sql).toMatch(
      /revoke execute on function public\.trg_audit_manufacturing_runs_created\(\)\s*from public, anon/i,
    );
  });

  it('does not edit migration 0052 (forward-only invariant)', () => {
    // The fix lives entirely in 0061. Migration 0052 must still wire the
    // existing audit trigger as AFTER UPDATE OF status — this is the
    // structural precondition the new migration depends on.
    expect(priorSql).toMatch(
      /create trigger audit_manufacturing_runs_status\s+after update of status on public\.manufacturing_runs/i,
    );
    // And the 0052 trigger keeps its UPDATE-only guard so the two triggers
    // do not double-write on UPDATE.
    expect(priorSql).toMatch(
      /if new\.status is null or new\.status = old\.status then\s+return new;\s+end if;/i,
    );
  });

  it('header documents B10 closure and the operator-only DOWN MIGRATION', () => {
    expect(sql).toMatch(/B10/);
    expect(sql).toMatch(/DOWN MIGRATION \(operator-only/i);
    expect(sql).toMatch(/F-Wave9-MFG-CREATED-AUDIT-01/);
    expect(sql).toMatch(/F-Wave9-AUDIT-CREATED-SYMMETRY-01/);
  });
});
