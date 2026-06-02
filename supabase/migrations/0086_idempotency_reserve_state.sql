-- ============================================================================
-- Migration: 0086_idempotency_reserve_state.sql
-- Wave: 10
-- Phase: Idempotency hardening (review remediation WS-B / B2).
-- Closes: F-Wave10-REVIEW-REMEDIATION (idempotency RESERVE-BEFORE-EXECUTE).
-- Date: 2026-06-01
--
-- Constitutional alignment:
--   * Idempotency rules. PK (key, user_id, org_id, route_hash) is UNCHANGED.
--   * Forward-only. New columns + a relaxed NOT NULL; no edit to 0001.
--   * Idempotent DDL (IF EXISTS / IF NOT EXISTS, guarded column add/alter).
--
-- Why:
--   The edge idempotency wrapper now RESERVES a pending row before running a
--   handler (INSERT ... ON CONFLICT DO NOTHING on the PK) and only stamps the
--   response after the handler completes. A reserved-but-not-yet-completed row
--   has no status_code yet, so status_code must be NULLABLE. A `state` column
--   distinguishes an in-flight reservation ('pending') from a finished,
--   replayable row ('completed').
--
--   Existing rows pre-date the reservation flow and are, by definition, fully
--   recorded completions. The new column therefore defaults to 'completed' so
--   the backfill is a no-op for historical data and replay behaviour is
--   unchanged for them.
--
-- DOWN MIGRATION (operator-only; not auto-run):
--   -- 1. Re-tighten status_code. Any pending rows must be cleared first or the
--   --    SET NOT NULL will fail:
--   --      delete from public.idempotency_keys where status_code is null;
--   --      alter table public.idempotency_keys
--   --        alter column status_code set not null;
--   -- 2. drop the state column + its check constraint:
--   --      alter table public.idempotency_keys
--   --        drop constraint if exists idempotency_keys_state_check;
--   --      alter table public.idempotency_keys drop column if exists state;
--   --    NOTE: reverting REINTRODUCES the lookup/insert race the reserve flow
--   --    closes. Do not revert without an alternative concurrency guard.
-- ----------------------------------------------------------------------------

-- Relax status_code so a reserved (pending) row can exist before the handler
-- response is known. Completed rows still carry a non-null status_code.
alter table public.idempotency_keys
  alter column status_code drop not null;

-- Lifecycle marker. Default 'completed' so every pre-existing row (all of
-- which are finished completions) backfills correctly with no data touch.
alter table public.idempotency_keys
  add column if not exists state text not null default 'completed';

-- Constrain the domain to the two valid lifecycle states.
alter table public.idempotency_keys
  drop constraint if exists idempotency_keys_state_check;

alter table public.idempotency_keys
  add constraint idempotency_keys_state_check
  check (state in ('pending', 'completed'));
