-- ============================================================================
-- Migration: 0141_support_tickets_numbering.sql
-- Wave: Internal feedback / support ticketing (operator beta channel)
-- Phase: Register the 'feedback' doc_type on the numbering chassis so support
--   tickets get a per-org human reference (FB-2026-00001).
-- Closes: In-app beta feedback channel (founder request 2026-06-24)
-- Date: 2026-06-24
--
-- DOWN MIGRATION (operator-only; forward-only repo, do not auto-apply):
--   delete from public.numbering_sequences where doc_type = 'feedback';
--   -- numbering_sequences_doc_type_check and seed_org_numbering keep 'feedback'
--   -- present; both are supersets and harmless. Re-narrowing is operator-scripted.
--
-- Constitutional alignment:
--   Money rules        None. Numbering only.
--   RLS rules          numbering_sequences RLS unchanged (existing policy).
--   Audit rules        None. Numbering rows are not audited entities.
--   Migration rules    Forward-only. Idempotent: guarded constraint swap,
--                      ON CONFLICT DO NOTHING seed, CREATE OR REPLACE function.
--   Constraint         numbering_sequences_doc_type_check extended with
--                      'feedback' as a strict superset of the existing list.
--   Seed               One 'feedback' sequence per existing org (FB- prefix,
--                      pad 5, yearly reset). seed_org_numbering extended so
--                      newly provisioned orgs also get a feedback sequence.
-- ============================================================================

-- Extend the doc_type allowlist (strict superset).
alter table public.numbering_sequences
  drop constraint if exists numbering_sequences_doc_type_check;

alter table public.numbering_sequences
  add constraint numbering_sequences_doc_type_check
  check (doc_type in (
    'quote', 'invoice', 'credit_note', 'payment',
    'project', 'purchase_order', 'vendor_bill', 'expense',
    'journal_entry', 'receiving_order', 'production_run', 'shipment',
    'manufacturing_run', 'sales_order', 'kitting_job', 'fulfillment',
    'workforce_member', 'shift', 'work_assignment',
    'three_pl_account', 'job_template', 'supply_plan', 'job_run',
    'billing_review', 'feedback'
  ));

-- Seed a feedback sequence for every existing org.
insert into public.numbering_sequences (
  org_id, doc_type, prefix, pad_width, include_year, reset_period, next_value
)
select o.id, t.doc_type, t.prefix, 5, true, 'yearly', 1
from public.organizations o
cross join (
  values
    ('feedback', 'FB-')
) as t(doc_type, prefix)
on conflict (org_id, doc_type) do nothing;

-- Extend seed_org_numbering so future provisioned orgs get a feedback sequence.
-- Body preserved verbatim from the live definition; only the two arrays gain a
-- trailing 'feedback' / 'FB-' entry.
create or replace function public.seed_org_numbering(p_org_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $function$
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
    'journal_entry', 'feedback'
  ];
  v_prefixes text[] := array[
    'Q-', 'INV-', 'CN-', 'PMT-',
    'PO-', 'VB-', 'EXP-',
    'RCV-', 'SHP-', 'RUN-',
    'MFG-', 'SO-', 'KIT-', 'FUL-',
    'EMP-', 'SHF-', 'WA-',
    'ACC-', 'JB-', 'SUP-', 'JR-', 'BILL-',
    'JE-M-', 'FB-'
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
$function$;
