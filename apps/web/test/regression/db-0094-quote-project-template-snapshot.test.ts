// Regression suite for Wave 12 / A4 — convert_quote_to_project must carry the
// source Job Builder template breadcrumb onto the project and freeze a snapshot
// of the template (header plus lines) into projects.job_template_snapshot, so
// later edits to the live template never rewrite a project's origin.
//
// Background (03-workspace/specs/2026-06-13-3pl-a3-quote-integration-closeout-
// and-a4-handoff.md): A3 (migration 0093) threaded job_type_id quote -> project
// but deliberately deferred the source_job_template_id breadcrumb and the
// snapshot to A4. Migration 0094:
//   1. adds quotes.source_job_template_id (spine -> add-on FK, ON DELETE SET NULL)
//   2. adds projects.source_job_template_id (same FK) and projects
//      .job_template_snapshot jsonb
//   3. CREATE OR REPLACE convert_quote_to_project (4-arg signature preserved)
//      that copies the breadcrumb and builds the org-scoped frozen snapshot.
//
// Like db-0059, this regression cannot exercise the DB function directly (no DB
// harness is wired into apps/web/test), so it asserts the migration declares the
// expected columns, FK behaviour, snapshot build, and carryover. The function
// was additionally validated on staging in an aborting transaction during the
// A4 build (project carried source_job_template_id and a 3-line snapshot).

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATION_PATH = join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'supabase',
  'migrations',
  '0094_quote_project_template_snapshot.sql',
);

const sql = readFileSync(MIGRATION_PATH, 'utf8');

describe('migration 0094 — quote/project template snapshot (A4)', () => {
  it('adds quotes.source_job_template_id as a nullable FK to job_templates with ON DELETE SET NULL', () => {
    expect(sql).toMatch(
      /alter table public\.quotes\s+add column if not exists source_job_template_id uuid\s+references public\.job_templates\(id\) on delete set null/i,
    );
  });

  it('adds projects.source_job_template_id as a nullable FK to job_templates with ON DELETE SET NULL', () => {
    expect(sql).toMatch(
      /alter table public\.projects\s+add column if not exists source_job_template_id uuid\s+references public\.job_templates\(id\) on delete set null/i,
    );
  });

  it('adds projects.job_template_snapshot as a jsonb column', () => {
    expect(sql).toMatch(
      /alter table public\.projects\s+add column if not exists job_template_snapshot jsonb/i,
    );
  });

  it('redefines convert_quote_to_project preserving the (uuid,uuid,uuid,text) signature', () => {
    // Signature must match 0093 exactly so the quotes-api handler's rpc() call
    // does not need a code change.
    expect(sql).toMatch(
      /create or replace function public\.convert_quote_to_project\(\s*p_quote_id uuid,\s*p_actor uuid,\s*p_caller_org_id uuid,\s*p_project_number text default null\s*\)/i,
    );
  });

  it('reads source_job_template_id from the in-org quote row (not a parameter)', () => {
    // The breadcrumb is read off the quote, never passed in, so the SECURITY
    // DEFINER RPC cannot be used to inject a foreign template.
    const rpcBody = sql.match(
      /create or replace function public\.convert_quote_to_project[\s\S]*?\$\$;/,
    )?.[0];
    expect(rpcBody).toBeTruthy();
    expect(rpcBody!).toMatch(/job_type_id, source_job_template_id\s+into/i);
    expect(rpcBody!).toMatch(/v_source_job_template_id/);
  });

  it('builds the snapshot org-scoped on both the template and its lines', () => {
    // jt.org_id = v_org_id and jtl.org_id = v_org_id keep a foreign template
    // from ever being frozen onto a project even if the pointer were cross-org.
    const rpcBody = sql.match(
      /create or replace function public\.convert_quote_to_project[\s\S]*?\$\$;/,
    )?.[0];
    expect(rpcBody!).toMatch(/from public\.job_templates jt[\s\S]*?where jt\.id\s*=\s*v_source_job_template_id\s+and jt\.org_id\s*=\s*v_org_id/i);
    expect(rpcBody!).toMatch(/from public\.job_template_lines jtl\s+where jtl\.template_id\s*=\s*jt\.id\s+and jtl\.org_id\s*=\s*v_org_id/i);
  });

  it('only snapshots when the quote carries a source template', () => {
    const rpcBody = sql.match(
      /create or replace function public\.convert_quote_to_project[\s\S]*?\$\$;/,
    )?.[0];
    expect(rpcBody!).toMatch(/if v_source_job_template_id is not null then[\s\S]*?into v_template_snapshot/i);
  });

  it('carries both the breadcrumb and the snapshot onto the projects INSERT', () => {
    const rpcBody = sql.match(
      /create or replace function public\.convert_quote_to_project[\s\S]*?\$\$;/,
    )?.[0];
    const insertBlock = rpcBody!.match(
      /insert into public\.projects \([\s\S]*?returning id into v_project_id;/,
    )?.[0];
    expect(insertBlock).toBeTruthy();
    expect(insertBlock!).toMatch(/source_job_template_id, job_template_snapshot/);
    expect(insertBlock!).toMatch(/v_source_job_template_id, v_template_snapshot/);
  });

  it('preserves the 0044 line-item carryover into project_line_items', () => {
    const rpcBody = sql.match(
      /create or replace function public\.convert_quote_to_project[\s\S]*?\$\$;/,
    )?.[0];
    expect(rpcBody!).toMatch(/insert into public\.project_line_items/i);
    expect(rpcBody!).toMatch(/from public\.quote_line_items qli/i);
    expect(rpcBody!).toMatch(/on conflict \(project_id, source_quote_line_item_id\)/i);
  });

  it('preserves the 0041 cross-tenant guard as NOT_FOUND (never 403)', () => {
    const rpcBody = sql.match(
      /create or replace function public\.convert_quote_to_project[\s\S]*?\$\$;/,
    )?.[0];
    expect(rpcBody!).toMatch(/v_org_id is null or v_org_id <> p_caller_org_id/i);
    expect(rpcBody!).toMatch(/NOT_FOUND: quote not found/);
    // Must not reintroduce the pre-0041 FORBIDDEN/403 branch.
    expect(rpcBody!).not.toMatch(/FORBIDDEN/);
  });

  it('grants execute on the 4-arg function to authenticated + service_role only', () => {
    expect(sql).toMatch(
      /revoke execute on function public\.convert_quote_to_project\(uuid, uuid, uuid, text\)\s*from public, anon/i,
    );
    expect(sql).toMatch(
      /grant execute on function public\.convert_quote_to_project\(uuid, uuid, uuid, text\)\s*to authenticated, service_role/i,
    );
  });
});
