-- ============================================================================
-- Migration: 0084_shifts_shift_number.sql
-- Wave: 10
-- Phase: Pillar 4 (KitForce) follow-up
-- Closes: F-Wave10-SMOKE-SHIFT-NUMBER-01 (2026-06-01 smoke test)
-- Date: 2026-06-01
--
-- DOWN MIGRATION (operator-only; not auto-run):
--   drop index if exists public.shifts_org_shift_number_uniq;
--   alter table public.shifts drop column if exists shift_number;
--   (the kitforce-api handler keeps writing payload.shift_number, so no data
--    is lost on a down-migration; the column is additive.)
--
-- Why this migration exists:
--   The SHF- shift number is allocated by the kitforce-api POST /shifts handler
--   via the numbering chassis (doc_type 'shift', seeded in 0082), but the shifts
--   table (0079) was created without a dedicated column, so the handler stashed
--   the number in payload.shift_number. It was therefore never typed onto the
--   ShiftSchema and never surfaced in the UI (shifts read only as a member name).
--   The 2026-06-01 smoke flagged the missing number.
--
--   This adds the dedicated column (mirroring workforce_members.member_number
--   from 0078), backfills it from the existing payload.shift_number value on
--   every prior shift, and adds the same org-scoped partial unique index. The
--   handler is updated in the same PR to write the column (and accept an
--   optional override), and the Shift Zod canon gains shift_number in lockstep
--   across the _shared and apps/web mirrors.
--
-- Constitutional alignment:
--   RLS rules        Additive column on an existing Pattern A table; the
--                    existing shifts RLS policies (org_id = current_org_id())
--                    cover it unchanged. No policy edit.
--   Migration rules  Forward-only. Does not edit 0079. All DDL idempotent
--                    (ADD COLUMN IF NOT EXISTS, CREATE INDEX IF NOT EXISTS).
--   Numbering        Reuses the existing 'shift' numbering sequence (0082);
--                    no new sequence. The backfill reads the already-allocated
--                    number out of payload, so it never double-allocates.
-- ============================================================================

alter table public.shifts
  add column if not exists shift_number text;

-- Org-scoped uniqueness, nullable-friendly (mirrors workforce_members 0078).
create unique index if not exists shifts_org_shift_number_uniq
  on public.shifts (org_id, shift_number)
  where shift_number is not null;

-- Backfill from the number the handler already stashed in payload.shift_number.
-- Idempotent: only fills rows where the column is still null and a payload
-- value exists. Does not allocate new numbers (no chassis call here), so it
-- cannot collide with the sequence.
update public.shifts
   set shift_number = payload->>'shift_number'
 where shift_number is null
   and payload ? 'shift_number'
   and coalesce(payload->>'shift_number', '') <> '';

comment on column public.shifts.shift_number is
  'Org-scoped SHF- number from the shift numbering sequence (seeded 0082). Filled by the kitforce-api POST /shifts handler; backfilled from payload.shift_number in 0084. Nullable for forward-compat.';
