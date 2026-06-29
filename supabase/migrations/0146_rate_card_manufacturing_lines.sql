-- ============================================================================
-- Migration: 0146_rate_card_manufacturing_lines.sql
-- Wave: Estimate Engine + Job Builder (ADR 0006), Phase 3 (Manufacturing
--   pricing primitives follow-on)
-- Phase: Seed the two manufacturing rate-card primitives into every existing
--   default rate card so the Estimate Engine prices them out of the box and the
--   operator can tune them in the rate-card editor:
--     - MFG-MACHINE-HR  machine time, per hour      ($75.00 default)
--     - MFG-RAW-UNIT    raw material, per unit       ($0.50 default)
--   Mirrors the DEFAULT_RATE_CARD additions in lib/estimate/rateCard.ts and its
--   byte-mirror supabase/functions/_shared/estimate/rateCard.ts. Pure DML
--   (config seed); no DDL, no schema change. The engine reads these codes from
--   the active card; a card without them already prices them at 0 (rateMicrosOf
--   returns 0 for a missing code), so this seed is additive and non-breaking.
-- Closes: ADR 0006 P3 manufacturing primitives. Plan
--   03-workspace/specs/2026-06-29-estimate-engine-and-job-builder-plan.md.
-- Date: 2026-06-29
--
-- Constitutional alignment:
--   - Money: rate_micros (millionths of a currency unit) BIGINT, no float.
--   - Idempotent: guarded by NOT EXISTS on (rate_card_id, code); a re-run or an
--     org that already has the code is a no-op. Forward-only.
--   - RLS: writes the existing rate_card_lines table (Pattern A, org_id
--     denormalized); no policy change.
--   - Only existing default, non-deleted cards are seeded (matching the 0144
--     seed). Non-default cards can add the lines via the rate-card editor.
--
-- DOWN MIGRATION (operator-only; forward-only repo, do not auto-apply):
--   delete from public.rate_card_lines
--   where code in ('MFG-MACHINE-HR', 'MFG-RAW-UNIT');
-- ============================================================================

insert into public.rate_card_lines (org_id, rate_card_id, code, group_key, label, rate_micros, position)
select rc.org_id, rc.id, v.code, v.group_key, v.label, v.rate_micros, v.position
from public.rate_cards rc
cross join (values
  ('MFG-MACHINE-HR', 'manufacturing', 'Machine time (per hour)', 75000000, 17),
  ('MFG-RAW-UNIT',   'manufacturing', 'Raw material (per unit)',    500000, 18)
) as v(code, group_key, label, rate_micros, position)
where rc.is_default and rc.deleted_at is null
and not exists (
  select 1 from public.rate_card_lines l
  where l.rate_card_id = rc.id and l.code = v.code
);
