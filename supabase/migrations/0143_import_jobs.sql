-- ============================================================================
-- Migration: 0143_import_jobs.sql
-- Wave: CSV import — job-history ledger (Internal integrations follow-up)
-- Phase: Schema + RLS for a per-import-run history record. Every CSV commit
--   writes one import_jobs row (entity, status, row counts, a capped error
--   sample, who/when) so operators can see past runs on the Imports History
--   page. v1 imports stay synchronous; the table also carries 'pending' /
--   'processing' status values reserved for a future background-async phase.
-- Closes: ImportHistoryPage stub (no job ledger); the deferred half of the CSV
--   import feature (operator request 2026-06-28).
-- Date: 2026-06-28
--
-- DOWN MIGRATION (operator-only; forward-only repo, do not auto-apply):
--   drop table if exists public.import_jobs;
--
-- Constitutional alignment:
--   Money rules        No monetary columns. Row counts are plain integers, not
--                      money; no _cents fields, no floats.
--   RLS rules          Pattern A on import_jobs (org_id = current_org_id()).
--                      Tenant users SELECT their own org's job history only.
--                      Rows are written exclusively by the service role inside
--                      imports-api/commit, so there is NO authenticated INSERT /
--                      UPDATE / DELETE policy (mirrors the audit_log / service-
--                      role-write ledger pattern). Cross-tenant reads return
--                      200 + [] via the org filter, never another org's rows.
--   Audit rules        import_jobs is itself an operational import ledger, not a
--                      tenant business entity with a lifecycle, so it carries no
--                      audit_log trigger (consistent with idempotency_keys and
--                      audit_log, which are not self-audited). It is intentionally
--                      omitted from audit_log_entity_type_check.
--   Migration rules    Forward-only. All DDL idempotent (IF NOT EXISTS table +
--                      indexes, drop-then-create policies).
--   State machine      No FSM. status is set once at creation ('completed' or
--                      'failed' for synchronous v1). The CHECK admits 'pending'
--                      and 'processing' as a forward-compatible superset for a
--                      later async phase; no transition trigger is implied.
--   Grants             No new functions; nothing to grant or revoke.
--   Seed               None.
-- ============================================================================

create table if not exists public.import_jobs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  entity_type text not null
    check (entity_type in ('customer', 'item', 'vendor', 'invoice', 'expense')),
  status text not null
    check (status in ('pending', 'processing', 'completed', 'failed')),
  total_rows integer not null default 0,
  valid_rows integer not null default 0,
  inserted_rows integer not null default 0,
  error_count integer not null default 0,
  -- A capped sample of per-row errors (the commit handler truncates to bound
  -- row size); error_count carries the full count.
  errors jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid,
  completed_at timestamptz
);

create index if not exists import_jobs_org_created_idx
  on public.import_jobs(org_id, created_at desc);

alter table public.import_jobs enable row level security;

-- Any tenant user may read their own org's import history.
drop policy if exists import_jobs_select on public.import_jobs;
create policy import_jobs_select on public.import_jobs
  for select to authenticated
  using (org_id = public.current_org_id());

-- No authenticated INSERT / UPDATE / DELETE policy: import_jobs rows are written
-- only by the service role inside imports-api/commit. service_role bypasses RLS.
