-- ============================================================================
-- Migration: 0119_journal_entry_numbering.sql
-- Wave: 13
-- Phase: UI/UX reconfiguration follow-up. Server-assigned document numbering
--   for manual journal entries (companion to the credit-note auto-number,
--   which needs no migration because the CN- row is already seeded).
-- Closes: F-UIUX-AUTONUMBER-JE-01. Wires finance-api manual journal-entry
--   create into the existing org-scoped numbering chassis (numbering_sequences
--   + next_doc_number from 0004, last extended in 0103). Prefix JE-M-.
--   The chassis prefixes already in use are Q-, INV-, CN-, PMT-, PO-, VB-,
--   EXP-, RCV-, SHP-, RUN-, MFG-, SO-, KIT-, FUL-, EMP-, SHF-, WA-, ACC-, JB-,
--   SUP-, JR-, BILL-. JE- is reserved by the 0024 auto-JE triggers, which mint
--   JE-INV-, JE-PAY-, JE-CN- entry numbers. To keep the manual lane out of the
--   JE- namespace (journal_entries carries unique(org_id, entry_number)), the
--   manual prefix is JE-M-. The finance-api handler calls nextDocNumber on
--   manual journal-entry create (app layer, this slice).
-- Date: 2026-06-17
--
-- DOWN MIGRATION (operator-only; not auto-run):
--   -- 1) Restore the 0103 doc_type CHECK (drops nothing new; journal_entry was
--   --    already enumerated, so the restore text is identical to step 1 below
--   --    minus this header note). Re-stated for reversibility.
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
--       'three_pl_account', 'job_template', 'supply_plan', 'job_run',
--       'billing_review'
--     ));
--   -- 2) Delete the seeded journal_entry rows.
--   delete from public.numbering_sequences where doc_type = 'journal_entry';
--   -- 3) Restore the 0103 seed_org_numbering body (drops the journal_entry /
--   --    JE-M- array entries). Operator copies the function body from 0103.
--
-- Constitutional alignment:
--   Money rules        Untouched. No _cents column added.
--   RLS rules          numbering_sequences carries the 0004 policies (Pattern A,
--                      write gated to org_owner / org_admin). No change.
--   Audit rules        Untouched. numbering_sequences writes are infrequent
--                      operator-scoped config changes. The 0024 auto-JE audit
--                      triggers and JE- entry-number minting are not touched.
--   Migration rules    Forward-only. All DDL idempotent (drop-constraint-if-
--                      exists / add, create-or-replace function, INSERT ON
--                      CONFLICT DO NOTHING for the seed). Mirrors 0103
--                      one-for-one.
--   State machine      Untouched.
--   Out of scope       The finance-api handler wiring is app-layer code, not
--                      DDL. journal_entry_lines has no numbering prefix. The
--                      0024 auto-JE writers (JE-INV-, JE-PAY-, JE-CN-) are
--                      untouched; manual entries use the distinct JE-M- lane.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Re-state the doc_type CHECK with the full enum (authoritative as of 0103)
--    so the migration is reversible. journal_entry was already enumerated in
--    0103; the drop-and-re-add is idempotent and keeps the constraint text
--    self-describing alongside the new seed below.
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
    -- Wave 12 3PL commercial layer Billing Review (0103)
    'billing_review'
  ));

comment on constraint numbering_sequences_doc_type_check on public.numbering_sequences is
  'Enumerates every doc_type allowed in numbering_sequences. Re-stated in 0119 (no new doc_type; journal_entry was already enumerated) alongside the manual journal-entry seed. Manual entries use the JE-M- prefix; the 0024 auto-JE triggers mint JE-INV-/JE-PAY-/JE-CN- entry numbers in the JE- namespace.';

-- ---------------------------------------------------------------------------
-- 2) Seed a journal_entry row for every existing org. ON CONFLICT DO NOTHING
--    keeps the migration idempotent. Prefix JE-M-; pad_width 5; yearly reset.
--    JE-M- is distinct from the JE- namespace the 0024 auto-JE writers use, so
--    a manual JE-M-2026-00001 never collides with an auto JE-INV-... on the
--    journal_entries unique(org_id, entry_number) index.
-- ---------------------------------------------------------------------------

insert into public.numbering_sequences (
  org_id, doc_type, prefix, pad_width, include_year, reset_period, next_value
)
select o.id, t.doc_type, t.prefix, 5, true, 'yearly', 1
from public.organizations o
cross join (
  values
    ('journal_entry', 'JE-M-')
) as t(doc_type, prefix)
on conflict (org_id, doc_type) do nothing;

-- ---------------------------------------------------------------------------
-- 3) Extend seed_org_numbering (last redefined in 0103) to include
--    journal_entry. Body matches 0103 verbatim except for the two arrays (one
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
    'three_pl_account', 'job_template', 'supply_plan', 'job_run', 'billing_review',
    'journal_entry'
  ];
  v_prefixes text[] := array[
    'Q-', 'INV-', 'CN-', 'PMT-',
    'PO-', 'VB-', 'EXP-',
    'RCV-', 'SHP-', 'RUN-',
    'MFG-', 'SO-', 'KIT-', 'FUL-',
    'EMP-', 'SHF-', 'WA-',
    'ACC-', 'JB-', 'SUP-', 'JR-', 'BILL-',
    'JE-M-'
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
  'Seeds numbering_sequences rows for every doc_type. Called by provision_organization. Idempotent. Extended in 0119 to seed journal_entry (JE-M-) for manual journal entries. JE-M- is distinct from the JE- namespace the 0024 auto-JE triggers consume.';
