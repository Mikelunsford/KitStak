-- ============================================================================
-- Migration: 0103_billing_reviews_numbering.sql
-- Wave: 12
-- Phase: 3PL commercial pivot, Phase A7 (Billing Review and Job Profitability),
--   step 2 of 3.
-- Closes: wires billing_reviews.review_number into the existing org-scoped
--   numbering chassis (numbering_sequences + next_doc_number from 0004, last
--   extended in 0100). Prefix BILL- per
--   03-workspace/specs/2026-06-14-3pl-a7-billing-profitability-handoff.md
--   (decision 1: BILL- is free; the chassis prefixes in use are Q-, INV-, CN-,
--   PMT-, PO-, VB-, EXP-, RCV-, SHP-, RUN-, MFG-, SO-, KIT-, FUL-, EMP-, SHF-,
--   WA-, ACC-, JB-, SUP-, JR-). The three-pl-api handler calls nextDocNumber on
--   billing-review create (A7 app layer, next slice).
-- Date: 2026-06-14
--
-- DOWN MIGRATION (operator-only; not auto-run):
--   -- 1) Restore the 0100 doc_type CHECK (drops the billing_review entry).
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
--       'three_pl_account', 'job_template', 'supply_plan', 'job_run'
--     ));
--   -- 2) Delete the seeded rows.
--   delete from public.numbering_sequences where doc_type = 'billing_review';
--   -- 3) Restore the 0100 seed_org_numbering body. Operator copies from 0100.
--
-- Constitutional alignment:
--   Money rules        Untouched. No _cents column added.
--   RLS rules          numbering_sequences carries the 0004 policies (Pattern A,
--                      write gated to org_owner / org_admin). No change.
--   Audit rules        Untouched. numbering_sequences writes are infrequent
--                      operator-scoped config changes.
--   Migration rules    Forward-only. All DDL idempotent (drop-constraint-if-
--                      exists / add, drop-and-replace function, INSERT ON
--                      CONFLICT DO NOTHING for the seed). Mirrors 0100
--                      one-for-one.
--   State machine      Untouched.
--   Out of scope       The three-pl-api handler wiring is A7 app-layer code, not
--                      DDL.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Extend the doc_type CHECK to allow billing_review. Drop and re-add with the
--    full enum (authoritative as of 0100) so the migration is reversible.
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
    -- Wave 12 3PL commercial layer Supply Plan (0097)
    'supply_plan',
    -- Wave 12 3PL commercial layer Job Run (0100)
    'job_run',
    -- Wave 12 3PL commercial layer Billing Review (this migration, 0103)
    'billing_review'
  ));

comment on constraint numbering_sequences_doc_type_check on public.numbering_sequences is
  'Enumerates every doc_type allowed in numbering_sequences. Extended in 0103 to add billing_review (BILL-) for the 3PL Billing Review (Wave 12). BILL- is distinct from the spine invoice INV- prefix the approve path consumes.';

-- ---------------------------------------------------------------------------
-- 2) Seed a billing_review row for every existing org. ON CONFLICT DO NOTHING
--    keeps the migration idempotent. Prefix BILL-; pad_width 5; yearly reset.
-- ---------------------------------------------------------------------------

insert into public.numbering_sequences (
  org_id, doc_type, prefix, pad_width, include_year, reset_period, next_value
)
select o.id, t.doc_type, t.prefix, 5, true, 'yearly', 1
from public.organizations o
cross join (
  values
    ('billing_review', 'BILL-')
) as t(doc_type, prefix)
on conflict (org_id, doc_type) do nothing;

-- ---------------------------------------------------------------------------
-- 3) Extend seed_org_numbering (last redefined in 0100) to include
--    billing_review. Body matches 0100 verbatim except for the two arrays (one
--    new entry each, appended positionally).
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
    'three_pl_account', 'job_template', 'supply_plan', 'job_run', 'billing_review'
  ];
  v_prefixes text[] := array[
    'Q-', 'INV-', 'CN-', 'PMT-',
    'PO-', 'VB-', 'EXP-',
    'RCV-', 'SHP-', 'RUN-',
    'MFG-', 'SO-', 'KIT-', 'FUL-',
    'EMP-', 'SHF-', 'WA-',
    'ACC-', 'JB-', 'SUP-', 'JR-', 'BILL-'
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
  'Seeds numbering_sequences rows for every doc_type. Called by provision_organization. Idempotent. Extended in 0103 to seed billing_review (BILL-) for the 3PL Billing Review (Wave 12).';
