// Regression suite for F-Wave9-STAFF-INVITE-PATCH-01 audit coverage.
// Migration 0067 wired an AFTER INSERT audit trigger on org_memberships
// and that suite explicitly asserts the absence of an AFTER UPDATE wire.
// This migration (0068) adds the deferred UPDATE coverage so the PATCH
// handler's role-change and deactivate operations land in the per-org
// audit hash chain.
//
// Same posture as db-0067-org-membership-audit.test.ts: the apps/web
// harness has no DB connection, so the suite asserts migration text shape.
// Live trigger verification happens via Supabase MCP apply on staging
// before the prod apply.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..', '..', '..');
const MIGRATION_PATH = join(
  ROOT,
  'supabase',
  'migrations',
  '0068_org_membership_update_audit.sql',
);
const PRIOR_AUDIT_MIGRATION_PATH = join(
  ROOT,
  'supabase',
  'migrations',
  '0067_org_membership_audit.sql',
);

const sql = readFileSync(MIGRATION_PATH, 'utf8');
const priorSql = readFileSync(PRIOR_AUDIT_MIGRATION_PATH, 'utf8');

describe('migration 0068 - org_memberships UPDATE audit row (F-Wave9-STAFF-INVITE-PATCH-01)', () => {
  it('declares trg_org_memberships_updated_audit as a SECURITY DEFINER trigger function', () => {
    expect(sql).toMatch(
      /create or replace function public\.trg_org_memberships_updated_audit\(\)/i,
    );
    expect(sql).toMatch(/returns trigger/i);
    expect(sql).toMatch(/security definer/i);
  });

  it('wires the trigger AFTER UPDATE on org_memberships', () => {
    expect(sql).toMatch(
      /drop trigger if exists audit_org_memberships_updated on public\.org_memberships;/i,
    );
    expect(sql).toMatch(
      /create trigger audit_org_memberships_updated\s+after update on public\.org_memberships/i,
    );
    expect(sql).toMatch(
      /execute function public\.trg_org_memberships_updated_audit\(\)/i,
    );
  });

  it('uses action constant \'updated\' (matches identity-layer vocabulary)', () => {
    const fnBody = sql.match(
      /create or replace function public\.trg_org_memberships_updated_audit[\s\S]*?\$\$;/,
    );
    expect(fnBody).not.toBeNull();
    expect(fnBody![0]).toMatch(/'updated'/);
  });

  it('writes from_state from old.is_active and to_state from new.is_active', () => {
    const fnBody = sql.match(
      /create or replace function public\.trg_org_memberships_updated_audit[\s\S]*?\$\$;/,
    );
    expect(fnBody).not.toBeNull();
    expect(fnBody![0]).toMatch(
      /v_from_state := case when old\.is_active then 'active' else 'inactive' end/i,
    );
    expect(fnBody![0]).toMatch(
      /v_to_state\s*:= case when new\.is_active then 'active' else 'inactive' end/i,
    );
  });

  it('skips emission when neither role_id nor is_active changed (no audit pollution on touch-only updates)', () => {
    const fnBody = sql.match(
      /create or replace function public\.trg_org_memberships_updated_audit[\s\S]*?\$\$;/,
    );
    expect(fnBody).not.toBeNull();
    // Guard must check IS DISTINCT FROM on both columns and return early
    // when nothing audit-worthy changed.
    expect(fnBody![0]).toMatch(/new\.is_active is distinct from old\.is_active/i);
    expect(fnBody![0]).toMatch(/new\.role_id\s+is distinct from old\.role_id/i);
    expect(fnBody![0]).toMatch(/if not v_changed then[\s\S]*?return new;/i);
  });

  it('carries user_id + role_id + old_role_id in metadata so role transitions are queryable', () => {
    const fnBody = sql.match(
      /create or replace function public\.trg_org_memberships_updated_audit[\s\S]*?\$\$;/,
    );
    expect(fnBody).not.toBeNull();
    expect(fnBody![0]).toMatch(/'user_id',\s*new\.user_id/);
    expect(fnBody![0]).toMatch(/'role_id',\s*new\.role_id/);
    expect(fnBody![0]).toMatch(/'old_role_id',\s*old\.role_id/);
  });

  it('writes diff_json with both old and new values for is_active and role_id', () => {
    const fnBody = sql.match(
      /create or replace function public\.trg_org_memberships_updated_audit[\s\S]*?\$\$;/,
    );
    expect(fnBody).not.toBeNull();
    expect(fnBody![0]).toMatch(
      /'is_active', jsonb_build_object\('from', old\.is_active, 'to', new\.is_active\)/i,
    );
    expect(fnBody![0]).toMatch(
      /'role_id',\s*jsonb_build_object\('from', old\.role_id,\s*'to', new\.role_id\)/i,
    );
  });

  it('reuses kitstak_audit_canonical for the payload hash', () => {
    expect(sql).toMatch(
      /extensions\.digest\(\s*public\.kitstak_audit_canonical\(v_payload\),\s*'sha256'\s*\)/i,
    );
  });

  it('holds a per-org advisory lock and reads prev_hash scoped to new.org_id', () => {
    const fnBody = sql.match(
      /create or replace function public\.trg_org_memberships_updated_audit[\s\S]*?\$\$;/,
    );
    expect(fnBody).not.toBeNull();
    expect(fnBody![0]).toMatch(/pg_advisory_xact_lock\(v_lock_key\)/);
    expect(fnBody![0]).toMatch(/md5\(new\.org_id::text\)/);
    expect(fnBody![0]).toMatch(/where org_id = new\.org_id/i);
  });

  it('uses coalesce(auth.uid(), new.updated_by, new.created_by) for triggered_by', () => {
    // PATCH handler runs under SECURITY DEFINER service-role; auth.uid()
    // resolves inside the Edge function context. Backfills + cron writes
    // fall through to updated_by, then created_by as a last resort.
    const fnBody = sql.match(
      /create or replace function public\.trg_org_memberships_updated_audit[\s\S]*?\$\$;/,
    );
    expect(fnBody).not.toBeNull();
    expect(fnBody![0]).toMatch(
      /coalesce\(auth\.uid\(\),\s*new\.updated_by,\s*new\.created_by\)/i,
    );
  });

  it('grants execute on the new function to nobody but the table owner (REVOKE from public, anon)', () => {
    expect(sql).toMatch(
      /revoke execute on function public\.trg_org_memberships_updated_audit\(\)\s*from public, anon/i,
    );
  });

  it('does not edit migration 0067 (forward-only invariant)', () => {
    // The PATCH audit coverage lives entirely in 0068. Migration 0067 must
    // still declare the trigger function unchanged with the INSERT-only
    // wire it shipped.
    expect(priorSql).toMatch(
      /create or replace function public\.trg_org_memberships_created_audit/i,
    );
    expect(priorSql).toMatch(
      /create trigger audit_org_memberships_created\s+after insert/i,
    );
  });

  it('does not declare a backfill (historical UPDATEs are not recoverable)', () => {
    // Constitutional posture: PostgreSQL has no UPDATE history log, so we
    // cannot backfill audit rows for UPDATEs that already happened. The
    // chain starts at trigger-attach time. A backfill DO-block here would
    // either be a no-op or would invent history; both are wrong.
    expect(sql).not.toMatch(/do \$\$[\s\S]*?for\s+v_row\s+in[\s\S]*?org_memberships[\s\S]*?end\$\$;/i);
  });

  it('header documents F-Wave9-STAFF-INVITE-PATCH-01 closure and the operator-only DOWN MIGRATION', () => {
    expect(sql).toMatch(/F-Wave9-STAFF-INVITE-PATCH-01/);
    expect(sql).toMatch(/DOWN MIGRATION \(operator-only/i);
    expect(sql).toMatch(/Wave: 9/);
    expect(sql).toMatch(/2026-05-27/);
  });
});
