// Regression suite for F-Wave9-STAFF-INVITE-AUDIT-01. The staff invite
// chassis shipped in 0065 inserts org_memberships rows via the
// create_staff_membership RPC but did NOT extend audit_log.entity_type to
// include 'org_membership', and did not wire an AFTER INSERT trigger on
// the table. This migration (0067) closes both gaps.
//
// The apps/web test harness has no DB connection, so this suite asserts
// the migration text shape — same approach as
// db-0061-mfg-created-audit.test.ts and db-0059-project-budget-recompute.
// Live trigger + backfill verification happens via Supabase MCP apply on
// staging before the prod apply.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..', '..', '..');
const MIGRATION_PATH = join(
  ROOT,
  'supabase',
  'migrations',
  '0067_org_membership_audit.sql',
);
const PRIOR_INVITE_MIGRATION_PATH = join(
  ROOT,
  'supabase',
  'migrations',
  '0065_staff_invite_function.sql',
);

const sql = readFileSync(MIGRATION_PATH, 'utf8');
const priorSql = readFileSync(PRIOR_INVITE_MIGRATION_PATH, 'utf8');

describe('migration 0067 — org_memberships INSERT audit row (F-Wave9-STAFF-INVITE-AUDIT-01)', () => {
  it('extends audit_log_entity_type_check to include org_membership', () => {
    // Mirrors the 0036 pattern: drop the constraint if present, then re-add
    // with the full enumeration. The new entity_type must be present.
    expect(sql).toMatch(
      /drop constraint audit_log_entity_type_check/i,
    );
    expect(sql).toMatch(
      /add constraint audit_log_entity_type_check[\s\S]*?'org_membership'[\s\S]*?\)\)/i,
    );
  });

  it('preserves every prior entity_type already enumerated in 0052', () => {
    // Forward-only invariant: dropping + re-adding the constraint without
    // every prior entity_type would orphan existing audit_log rows. The
    // 0052 enumeration is the latest authoritative list; 0067 must extend
    // it, not subset it.
    const expectedTypes = [
      'organization',
      'customer', 'contact', 'activity', 'lead', 'opportunity',
      'item',
      'quote', 'quote_line_item', 'project', 'project_phase',
      'project_line_item',
      'invoice', 'invoice_line_item', 'payment', 'credit_note',
      'journal_entry', 'period_close',
      'vendor', 'purchase_order', 'po_line_item', 'vendor_bill', 'expense',
      'warehouse', 'stock_movement', 'receiving_order', 'production_run',
      'shipment',
      'attachment', 'comment', 'notification',
      'manufacturing_run',
      'manufacturing_run_consumed_line_item',
      'manufacturing_run_produced_line_item',
    ];
    for (const t of expectedTypes) {
      expect(sql).toMatch(new RegExp(`'${t}'`));
    }
  });

  it('declares trg_org_memberships_created_audit as a SECURITY DEFINER trigger function', () => {
    expect(sql).toMatch(
      /create or replace function public\.trg_org_memberships_created_audit\(\)/i,
    );
    expect(sql).toMatch(/returns trigger/i);
    expect(sql).toMatch(/security definer/i);
  });

  it('wires the trigger AFTER INSERT on org_memberships', () => {
    expect(sql).toMatch(
      /drop trigger if exists audit_org_memberships_created on public\.org_memberships;/i,
    );
    expect(sql).toMatch(
      /create trigger audit_org_memberships_created\s+after insert on public\.org_memberships/i,
    );
    expect(sql).toMatch(
      /execute function public\.trg_org_memberships_created_audit\(\)/i,
    );
    // Explicit negative: must NOT wire as AFTER UPDATE — org_memberships
    // has no formal status column today and an UPDATE trigger would
    // require a column guard the current schema does not support.
    const triggerBlock = sql.match(
      /create trigger audit_org_memberships_created[\s\S]*?execute function public\.trg_org_memberships_created_audit\(\);/i,
    );
    expect(triggerBlock).not.toBeNull();
    expect(triggerBlock![0]).not.toMatch(/after update/i);
  });

  it('writes the literal action constant \'invited\' (matches identity-layer vocabulary, not \'created\')', () => {
    const fnBody = sql.match(
      /create or replace function public\.trg_org_memberships_created_audit[\s\S]*?\$\$;/,
    );
    expect(fnBody).not.toBeNull();
    expect(fnBody![0]).toMatch(/'invited'/);
  });

  it('writes entity_type=org_membership, entity_id=new.id, and a NOT-NULL to_state derived from is_active', () => {
    const fnBody = sql.match(
      /create or replace function public\.trg_org_memberships_created_audit[\s\S]*?\$\$;/,
    );
    expect(fnBody).not.toBeNull();
    // audit_log.to_state is NOT NULL; the case expression resolves
    // is_active=true -> 'active', false -> 'inactive'. The INSERT must
    // pass v_to_state (a real string) into the to_state slot, not null.
    expect(fnBody![0]).toMatch(
      /case when new\.is_active then 'active' else 'inactive' end/i,
    );
    expect(fnBody![0]).toMatch(
      /values\s*\(\s*new\.org_id,\s*'org_membership',\s*new\.id,\s*null,\s*v_to_state,\s*'invited'/i,
    );
  });

  it('carries user_id + role_id in metadata so the audit row stands alone', () => {
    const fnBody = sql.match(
      /create or replace function public\.trg_org_memberships_created_audit[\s\S]*?\$\$;/,
    );
    expect(fnBody).not.toBeNull();
    // metadata is a JSONB column on audit_log; the trigger must populate
    // it with at least { user_id, role_id } so the audit reader does not
    // have to back-join to org_memberships to learn who got invited and
    // with what role.
    expect(fnBody![0]).toMatch(/'user_id',\s*new\.user_id/);
    expect(fnBody![0]).toMatch(/'role_id',\s*new\.role_id/);
  });

  it('uses coalesce(auth.uid(), new.created_by) for triggered_by (mirrors 0061)', () => {
    // create_staff_membership is SECURITY DEFINER + service_role-only;
    // auth.uid() resolves inside the calling Edge function context. When
    // service-role is invoked outside a JWT context (cron-style backfill,
    // operator script), auth.uid() returns null and we fall back to
    // new.created_by which the RPC stamps from p_invited_by.
    const fnBody = sql.match(
      /create or replace function public\.trg_org_memberships_created_audit[\s\S]*?\$\$;/,
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
      /create or replace function public\.trg_org_memberships_created_audit[\s\S]*?\$\$;/,
    );
    expect(fnBody).not.toBeNull();
    expect(fnBody![0]).toMatch(/pg_advisory_xact_lock\(v_lock_key\)/);
    expect(fnBody![0]).toMatch(/md5\(new\.org_id::text\)/);
    expect(fnBody![0]).toMatch(/where org_id = new\.org_id/i);
  });

  it('declares a backfill DO-block referencing org_memberships with a NOT EXISTS guard', () => {
    // Find the LAST do-block in the file — the first is the constraint
    // recreate, the second is the backfill.
    const blocks = [...sql.matchAll(/do \$\$[\s\S]*?end\$\$;/g)];
    expect(blocks.length).toBeGreaterThanOrEqual(2);
    const backfill = blocks[blocks.length - 1][0];
    expect(backfill).toMatch(/from public\.org_memberships/i);
    // Idempotency: re-running must skip rows that already carry an
    // 'invited' audit entry. NOT EXISTS predicate against audit_log is
    // the gate.
    expect(backfill).toMatch(/not exists/i);
    expect(backfill).toMatch(/entity_type = 'org_membership'/);
    expect(backfill).toMatch(/action = 'invited'/);
  });

  it('backfill iterates in chronological order so the hash chain reflects birth order', () => {
    const blocks = [...sql.matchAll(/do \$\$[\s\S]*?end\$\$;/g)];
    const backfill = blocks[blocks.length - 1][0];
    expect(backfill).toMatch(/order by created_at/i);
  });

  it('grants execute on the new function to nobody but the table owner (REVOKE from public, anon)', () => {
    expect(sql).toMatch(
      /revoke execute on function public\.trg_org_memberships_created_audit\(\)\s*from public, anon/i,
    );
  });

  it('does not edit migration 0065 (forward-only invariant)', () => {
    // The audit gap close lives entirely in 0067. Migration 0065 must
    // still declare create_staff_membership unchanged.
    expect(priorSql).toMatch(
      /create or replace function public\.create_staff_membership/i,
    );
  });

  it('header documents F-Wave9-STAFF-INVITE-AUDIT-01 closure and the operator-only DOWN MIGRATION', () => {
    expect(sql).toMatch(/F-Wave9-STAFF-INVITE-AUDIT-01/);
    expect(sql).toMatch(/DOWN MIGRATION \(operator-only/i);
    expect(sql).toMatch(/Wave: 9/);
    expect(sql).toMatch(/2026-05-27/);
  });
});
