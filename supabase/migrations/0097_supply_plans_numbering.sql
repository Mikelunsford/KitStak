-- ============================================================================
-- Migration: 0097_supply_plans_numbering.sql
-- Wave: 12
-- Phase: 3PL commercial pivot, Phase A5 (Supply Plan), step 3 of 3.
-- Closes: wires supply_plans.plan_number into the existing org-scoped numbering
--   chassis (numbering_sequences + next_doc_number from 0004, last extended in
--   0092). Prefix SUP- per
--   03-workspace/specs/2026-06-04-3pl-commercial-pivot-and-wms-pillar-plan.md
--   (section 6.1). The three-pl-api handler calls nextDocNumber on supply-plan
--   create (A5 app layer, next slice).
-- Date: 2026-06-13
--
-- DOWN MIGRATION (operator-only; not auto-run):
--   -- 1) Restore the 0092 doc_type CHECK (drops the supply_plan entry).
--   alter table public.numbering_sequences
--     drop constraint if exists numbering_sequences_doc_type_check;
--   alter table public.numbering_sequences
--     add constraint numbering_sequences_doc_type_check
--     check (doc_type in (
--       'quote', 'invoice', 'credit_note', 'payment',
--       'project', 'purchase_order', 'vendor_bill', 'expense',
--       'journal_entry', 'receiving_order', 'production_run', 'shipment',
--       'manufacturing_run', 'sales_order', 'kitting_job', 'fulfillment',
--       'workforce_member', 'shift', 'work_assignment',
--       'three_pl_account', 'job_template'
--     ));
--   -- 2) Delete the seeded rows.
--   delete from public.numbering_sequences where doc_type = 'supply_plan';
--   -- 3) Restore the 0092 seed_org_numbering body. Operator copies from 0092.
--
-- Constitutional alignment:
--   Money rules        Untouched. No _cents column added.
--   RLS rules          numbering_sequences carries the 0004 policies (Pattern A,
--                      write gated to org_owner / org_admin). No change.
--   Audit rules        Untouched. numbering_sequences writes are infrequent
--                      operator-scoped config changes.
--   Migration rules    Forward-only. All DDL idempotent (drop-constraint-if-
--                      exists / add, drop-and-replace function, INSERT ON
--                      CONFLICT DO NOTHING for the seed). Mirrors 0092
--                      one-for-one.
--   State machine      Untouched.
--   Out of scope       The three-pl-api handler wiring is A5 app-layer code, not
--                      DDL. supply_plan_lines has no numbering prefix.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Extend the doc_type CHECK to allow supply_plan. Drop and re-add with the
--    full enum (authoritative as of 0092) so the migration is reversible.
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
    'manufacturing_run',
    -- Wave 10 Co-Pack and Ecom pillar
    'sales_order', 'kitting_job', 'fulfillment',
    -- Wave 11 KitForce pillar
    'workforce_member', 'shift', 'work_assignment',
    -- Wave 12 3PL commercial layer accounts (0090)
    'three_pl_account',
    -- Wave 12 3PL commercial layer Job Builder (0092)
    'job_template',
    -- Wave 12 3PL commercial layer Supply Plan (this migration, 0097)
    'supply_plan'
  ));

comment on constraint numbering_sequences_doc_type_check on public.numbering_sequences is
  'Enumerates every doc_type allowed in numbering_sequences. Extended in 0097 to add supply_plan (SUP-) for the 3PL Supply Plan (Wave 12).';

-- ---------------------------------------------------------------------------
-- 2) Seed a supply_plan row for every existing org. ON CONFLICT DO NOTHING
--    keeps the migration idempotent. Prefix SUP-; pad_width 5; yearly reset.
-- ---------------------------------------------------------------------------

insert into public.numbering_sequences (
  org_id, doc_type, prefix, pad_width, include_year, reset_period, next_value
)
select o.id, t.doc_type, t.prefix, 5, true, 'yearly', 1
from public.organizations o
cross join (
  values
    ('supply_plan', 'SUP-')
) as t(doc_type, prefix)
on conflict (org_id, doc_type) do nothing;

-- ---------------------------------------------------------------------------
-- 3) Extend seed_org_numbering (last redefined in 0092) to include supply_plan.
--    Body matches 0092 verbatim except for the two arrays (one new entry each).
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
    'quote', 'invoice', 'credit_note', 'payment',
    'purchase_order', 'vendor_bill', 'expense',
    'receiving_order', 'shipment', 'production_run',
    'manufacturing_run', 'sales_order', 'kitting_job', 'fulfillment',
    'workforce_member', 'shift', 'work_assignment',
    'three_pl_account', 'job_template', 'supply_plan'
  ];
  v_prefixes text[] := array[
    'Q-', 'INV-', 'CN-', 'PMT-',
    'PO-', 'VB-', 'EXP-',
    'RCV-', 'SHP-', 'RUN-',
    'MFG-', 'SO-', 'KIT-', 'FUL-',
    'EMP-', 'SHF-', 'WA-',
    'ACC-', 'JB-', 'SUP-'
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
  'Seeds numbering_sequences rows for every doc_type. Called by provision_organization. Idempotent. Extended in 0097 to seed supply_plan (SUP-) for the 3PL Supply Plan (Wave 12).';
