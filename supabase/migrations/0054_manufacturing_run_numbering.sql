-- ============================================================================
-- Migration: 0054_manufacturing_run_numbering.sql
-- Wave: 9
-- Phase: Path A polish (post-Path A6 close)
-- Closes: F-Wave9-MFG-RUN-NUMBERING-01 (DB portion). Wires
--   manufacturing_runs.run_number into the existing org-scoped numbering
--   chassis (numbering_sequences + next_doc_number from 0004). Handler
--   change in supabase/functions/manufacturing-api/index.ts lands in the
--   same PR as this migration.
-- Date: 2026-05-21
--
-- DOWN MIGRATION (operator-only; not auto-run):
--   -- 1) Restore prior doc_type CHECK (drops the manufacturing_run entry).
--   alter table public.numbering_sequences
--     drop constraint if exists numbering_sequences_doc_type_check;
--   alter table public.numbering_sequences
--     add constraint numbering_sequences_doc_type_check
--     check (doc_type in (
--       'quote', 'invoice', 'credit_note', 'payment',
--       'project', 'purchase_order', 'vendor_bill', 'expense',
--       'journal_entry', 'receiving_order', 'production_run', 'shipment'
--     ));
--
--   -- 2) Delete the seeded rows.
--   delete from public.numbering_sequences where doc_type = 'manufacturing_run';
--
--   -- 3) Restore prior seed_org_numbering body (drops manufacturing_run from
--   --    the v_doc_types / v_prefixes arrays). Operator copies from 0038.
--
-- Constitutional alignment:
--   Money rules        Untouched. No _cents column added.
--   RLS rules          numbering_sequences carries the policies set up in
--                      0004 (Pattern A, write gated to org_owner / org_admin).
--                      No change.
--   Audit rules        Untouched. numbering_sequences writes are infrequent
--                      operator-scoped config changes; audit happens at the
--                      handler boundary in settings-api per 0004's comment.
--   Migration rules    Forward-only. All DDL idempotent (drop-constraint-
--                      if-exists / add, drop-and-replace function, INSERT
--                      ON CONFLICT DO NOTHING for the seed). Re-runs are
--                      safe.
--   State machine     Untouched.
--   Out of scope      The manufacturing-api handler wiring (calling
--                     nextDocNumber on create) ships in the same PR but
--                     is application code, not DDL.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Extend the numbering_sequences.doc_type CHECK to allow
--    'manufacturing_run'. The constraint was added inline in 0004 with the
--    auto-generated name `numbering_sequences_doc_type_check`; we drop and
--    re-add with the full enum so the migration is reversible and explicit.
-- ---------------------------------------------------------------------------

alter table public.numbering_sequences
  drop constraint if exists numbering_sequences_doc_type_check;

alter table public.numbering_sequences
  add constraint numbering_sequences_doc_type_check
  check (doc_type in (
    'quote', 'invoice', 'credit_note', 'payment',
    'project', 'purchase_order', 'vendor_bill', 'expense',
    'journal_entry', 'receiving_order', 'production_run', 'shipment',
    -- Wave 9 Manufacturing pillar
    'manufacturing_run'
  ));

comment on constraint numbering_sequences_doc_type_check on public.numbering_sequences is
  'Enumerates every doc_type allowed in numbering_sequences. Extended in 0054 to add manufacturing_run (Wave 9 Path A polish).';

-- ---------------------------------------------------------------------------
-- 2) Seed a manufacturing_run row for every existing org. The CHECK in 0004
--    only allowed 12 doc_types prior to this migration, so no manufacturing_run
--    rows exist today. ON CONFLICT DO NOTHING keeps the migration idempotent
--    if any org already carries one (e.g. a re-run after a partial rollback).
--    Default prefix MFG-; pad_width 5; yearly reset matches the existing
--    chassis convention.
-- ---------------------------------------------------------------------------

insert into public.numbering_sequences (
  org_id, doc_type, prefix, pad_width, include_year, reset_period, next_value
)
select
  o.id,
  'manufacturing_run',
  'MFG-',
  5,
  true,
  'yearly',
  1
from public.organizations o
on conflict (org_id, doc_type) do nothing;

-- ---------------------------------------------------------------------------
-- 3) Extend seed_org_numbering (originally defined in 0038) to include
--    'manufacturing_run'. provision_organization calls this on every new org,
--    so without the update, future orgs would miss the seed and the
--    handler's nextDocNumber call would auto-seed via next_doc_number's
--    fallback insert. That fallback works but loses our chosen prefix /
--    pad_width / reset policy, so we update the seed function for parity.
--
--    The function body matches 0038 verbatim except for the doc_types and
--    prefixes arrays.
-- ---------------------------------------------------------------------------

create or replace function public.seed_org_numbering(p_org_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted integer := 0;
  v_doc_type text;
  v_prefix   text;
  v_doc_types text[] := array[
    'quote',
    'invoice',
    'credit_note',
    'payment',
    'purchase_order',
    'vendor_bill',
    'expense',
    'receiving_order',
    'shipment',
    'production_run',
    'manufacturing_run'
  ];
  v_prefixes text[] := array[
    'Q-',
    'INV-',
    'CN-',
    'PMT-',
    'PO-',
    'VB-',
    'EXP-',
    'RCV-',
    'SHP-',
    'RUN-',
    'MFG-'
  ];
  v_i int;
begin
  if p_org_id is null then
    raise exception 'VALIDATION_ERROR: p_org_id is required' using errcode = '22023';
  end if;

  if not exists (
    select 1 from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname = 'numbering_sequences'
  ) then
    return 0;
  end if;

  for v_i in 1 .. array_length(v_doc_types, 1) loop
    v_doc_type := v_doc_types[v_i];
    v_prefix   := v_prefixes[v_i];

    begin
      insert into public.numbering_sequences (
        org_id, doc_type, prefix, next_value
      ) values (
        p_org_id, v_doc_type, v_prefix, 1
      )
      on conflict do nothing;
      get diagnostics v_i = ROW_COUNT;
      v_inserted := v_inserted + v_i;
    exception when undefined_column then
      begin
        insert into public.numbering_sequences (org_id, doc_type)
        values (p_org_id, v_doc_type)
        on conflict do nothing;
      exception when others then
        null;
      end;
    end;
  end loop;

  return v_inserted;
end;
$$;

revoke execute on function public.seed_org_numbering(uuid)
  from public, anon, authenticated;
grant execute on function public.seed_org_numbering(uuid)
  to service_role;

comment on function public.seed_org_numbering(uuid) is
  'Seeds numbering_sequences rows for every doc_type. Called by provision_organization. Idempotent. Extended in 0054 to seed manufacturing_run.';

-- ---------------------------------------------------------------------------
-- 4) Backfill existing manufacturing_runs.run_number IS NULL rows. Pre-PR
--    runs created during the Path A6 smoke walk carry a null run_number;
--    we assign them MFG-YYYY-NNNNN values by calling next_doc_number for
--    each. Per-org ordering by created_at preserves chronological numbering.
--    Wrapped in a DO block so the migration is a single statement.
-- ---------------------------------------------------------------------------

do $$
declare
  v_row record;
  v_number text;
begin
  for v_row in
    select id, org_id
      from public.manufacturing_runs
     where run_number is null
       and deleted_at is null
     order by org_id, created_at, id
  loop
    v_number := public.next_doc_number(v_row.org_id, 'manufacturing_run');
    update public.manufacturing_runs
       set run_number = v_number
     where id = v_row.id
       and run_number is null;
  end loop;
end$$;
