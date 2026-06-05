-- ============================================================================
-- Migration: 0090_threepl_accounts_numbering.sql
-- Wave: 12
-- Phase: 3PL commercial pivot, Phase A1 (Accounts model), step 2 of 2
-- Closes: wires three_pl_accounts.account_number into the existing org-scoped
--   numbering chassis (numbering_sequences + next_doc_number from 0004, last
--   extended in 0082). Prefix ACC- per
--   03-workspace/specs/2026-06-04-3pl-commercial-pivot-and-wms-pillar-plan.md
--   (Phase A1). The three-pl-api handler calls nextDocNumber on account create.
-- Date: 2026-06-04
--
-- DOWN MIGRATION (operator-only; not auto-run):
--   -- 1) Restore the 0082 doc_type CHECK (drops the three_pl_account entry).
--   alter table public.numbering_sequences
--     drop constraint if exists numbering_sequences_doc_type_check;
--   alter table public.numbering_sequences
--     add constraint numbering_sequences_doc_type_check
--     check (doc_type in (
--       'quote', 'invoice', 'credit_note', 'payment',
--       'project', 'purchase_order', 'vendor_bill', 'expense',
--       'journal_entry', 'receiving_order', 'production_run', 'shipment',
--       'manufacturing_run',
--       'sales_order', 'kitting_job', 'fulfillment',
--       'workforce_member', 'shift', 'work_assignment'
--     ));
--
--   -- 2) Delete the seeded rows.
--   delete from public.numbering_sequences
--     where doc_type = 'three_pl_account';
--
--   -- 3) Restore the 0082 seed_org_numbering body (drops the three_pl_account
--   --    doc_type / prefix). Operator copies from 0082.
--
-- Constitutional alignment:
--   Money rules        Untouched. No _cents column added.
--   RLS rules          numbering_sequences carries the policies set up in 0004
--                      (Pattern A, write gated to org_owner / org_admin). No
--                      change.
--   Audit rules        Untouched. numbering_sequences writes are infrequent
--                      operator-scoped config changes; audit happens at the
--                      handler boundary in settings-api per 0004's comment.
--   Migration rules    Forward-only. All DDL idempotent (drop-constraint-if-
--                      exists / add, drop-and-replace function, INSERT ON
--                      CONFLICT DO NOTHING for the seed). Re-runs are safe.
--                      Mirrors 0082 one-for-one.
--   State machine      Untouched.
--   Out of scope       The three-pl-api handler wiring (calling nextDocNumber on
--                      create) ships in the same Phase A1 PR but is application
--                      code, not DDL. account_service_definitions has no
--                      numbering prefix (lines under an account, not a document).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Extend the numbering_sequences.doc_type CHECK to allow the three_pl_account
--    doc_type. Drop and re-add with the full enum (authoritative as of 0082) so
--    the migration is reversible and explicit.
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
    -- Wave 12 3PL commercial layer
    'three_pl_account'
  ));

comment on constraint numbering_sequences_doc_type_check on public.numbering_sequences is
  'Enumerates every doc_type allowed in numbering_sequences. Extended in 0090 to add three_pl_account (ACC-) for the 3PL commercial layer (Wave 12).';

-- ---------------------------------------------------------------------------
-- 2) Seed a three_pl_account row for every existing org. ON CONFLICT DO NOTHING
--    keeps the migration idempotent. Prefix ACC-; pad_width 5; yearly reset
--    matches the existing chassis convention.
-- ---------------------------------------------------------------------------

insert into public.numbering_sequences (
  org_id, doc_type, prefix, pad_width, include_year, reset_period, next_value
)
select o.id, t.doc_type, t.prefix, 5, true, 'yearly', 1
from public.organizations o
cross join (
  values
    ('three_pl_account', 'ACC-')
) as t(doc_type, prefix)
on conflict (org_id, doc_type) do nothing;

-- ---------------------------------------------------------------------------
-- 3) Extend seed_org_numbering (last redefined in 0082) to include the
--    three_pl_account doc_type. provision_organization calls this on every new
--    org, so without the update future orgs would miss the seed and the
--    handler's nextDocNumber call would auto-seed via next_doc_number's fallback
--    insert, losing our chosen prefix / pad_width / reset policy.
--
--    The function body matches 0082 verbatim except for the doc_types and
--    prefixes arrays (one new entry appended).
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
    'manufacturing_run',
    'sales_order',
    'kitting_job',
    'fulfillment',
    'workforce_member',
    'shift',
    'work_assignment',
    'three_pl_account'
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
    'MFG-',
    'SO-',
    'KIT-',
    'FUL-',
    'EMP-',
    'SHF-',
    'WA-',
    'ACC-'
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
  'Seeds numbering_sequences rows for every doc_type. Called by provision_organization. Idempotent. Extended in 0090 to seed three_pl_account (ACC-) for the 3PL commercial layer (Wave 12).';
