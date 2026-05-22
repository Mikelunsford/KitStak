// Regression suite for UX-Q6 — receiving_orders.project_id FK linkage.
//
// Background (2026-05-21 UX revision walk, journal at
// 03-workspace/journal/2026-05-21-e2e-smoke-investigation.md): the
// operator's smoke walk surfaced that "New receiving order" launched
// from a project page never linked back to the project. Migration 0046
// had already added the column + FK in anticipation of this carry-
// through (G-RECV-FK-01), but the schema lay dormant because the
// ops-api ReceivingCreate schema stripped project_id at the API
// boundary and ReceivingOrderSchema omitted it on read.
//
// Migration 0062 is the structural assertion that locks in the column,
// the FK, and the partial index so the UX-Q6 PR's API + Zod + SPA
// changes have a guaranteed underlying schema. This regression suite
// mirrors the db-0059 pattern: a static content check against the
// migration file body since apps/web/test has no DB harness.

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
  '0062_receiving_orders_project_link.sql',
);

const sql = readFileSync(MIGRATION_PATH, 'utf8');

describe('migration 0062 — receiving_orders.project_id linkage (UX-Q6)', () => {
  it('adds the project_id column idempotently', () => {
    expect(sql).toMatch(
      /alter table public\.receiving_orders\s+add column if not exists project_id uuid/i,
    );
  });

  it('declares the FK constraint targeting projects(id) with ON DELETE SET NULL', () => {
    expect(sql).toMatch(
      /add constraint receiving_orders_project_id_fkey\s+foreign key \(project_id\) references public\.projects\(id\)\s+on delete set null/i,
    );
  });

  it('wraps the constraint add in a duplicate_object exception handler', () => {
    // ADD CONSTRAINT has no IF NOT EXISTS in Postgres; the do-block
    // exception handler is the constitutional convention used by 0046.
    expect(sql).toMatch(/do \$\$\s*begin\s+alter table public\.receiving_orders[\s\S]*?exception when duplicate_object then null;\s*end\$\$;/i);
  });

  it('declares the partial index with the deleted_at + project_id-not-null predicate', () => {
    expect(sql).toMatch(
      /create index if not exists receiving_orders_project_id_idx\s+on public\.receiving_orders \(project_id\)\s+where deleted_at is null and project_id is not null/i,
    );
  });

  it('declares a DOWN MIGRATION block flagged operator-only', () => {
    expect(sql).toMatch(/DOWN MIGRATION \(operator-only/);
    expect(sql).toMatch(/drop index if exists public\.receiving_orders_project_id_idx/);
    expect(sql).toMatch(/drop constraint if exists receiving_orders_project_id_fkey/);
    expect(sql).toMatch(/drop column if exists project_id/);
  });

  it('documents the constitutional alignment block', () => {
    expect(sql).toMatch(/Money rules\s+Untouched/);
    expect(sql).toMatch(/RLS rules\s+Untouched/);
    expect(sql).toMatch(/Audit rules\s+No new audit row required/);
    expect(sql).toMatch(/Migration rules\s+Forward-only\. Idempotent/);
  });

  it('does NOT touch the receiving_orders RLS policies', () => {
    // The new column inherits the existing Pattern A policy from 0032.
    // A UX-Q6 migration that re-declared the policies would be a
    // forward-only violation if the policy bodies drifted.
    expect(sql).not.toMatch(/create policy receiving_orders_select/i);
    expect(sql).not.toMatch(/create policy receiving_orders_write/i);
    expect(sql).not.toMatch(/drop policy.*receiving_orders/i);
  });

  it('does NOT touch the audit trigger machinery', () => {
    // project_id is metadata, not a state field. The existing
    // trg_audit_receiving_orders_state trigger (migration 0024) fires
    // AFTER UPDATE OF status; we deliberately do NOT extend it.
    expect(sql).not.toMatch(/create.*function.*trg_audit_receiving_orders/i);
    expect(sql).not.toMatch(/create or replace trigger.*audit.*receiving/i);
    expect(sql).not.toMatch(/kitstak_audit_state/i);
  });

  it('does NOT add a backfill — historical rows legitimately have project_id = NULL', () => {
    // Receiving orders that landed before UX-Q6 were not bound to a
    // project. Inferring a project_id from purchase_order_id or
    // payload would be wrong; the operator can link them by hand from
    // the detail page if desired. Absence of a backfill is intentional.
    expect(sql).not.toMatch(/do \$\$[\s\S]*?perform[\s\S]*?recompute/i);
    expect(sql).not.toMatch(/update public\.receiving_orders[\s\S]*?set project_id/i);
  });
});
