-- ============================================================================
-- Migration: 0031_inventory_bom.sql
-- Wave: 2
-- Phase: Bill of Materials (Agent E)
-- Closes: R-W2-INV-02
-- Date: 2026-05-18
-- DOWN MIGRATION: operator-only. drop table public.bom_items. Not auto-run.
--
-- Constitutional alignment:
--   RLS rules         Pattern A on org_id.
--   Money rules       No money columns; cost lookup pivots through items.
--   Migration rules   Forward-only. All DDL idempotent.
-- ============================================================================

create table if not exists public.bom_items (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  parent_item_id uuid not null,
  component_item_id uuid not null,
  quantity_per numeric(18,4) not null default 1,
  unit_of_measure text,
  notes text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  unique (parent_item_id, component_item_id)
);

create index if not exists bom_items_parent_idx
  on public.bom_items (parent_item_id);

create index if not exists bom_items_component_idx
  on public.bom_items (component_item_id);

alter table public.bom_items enable row level security;

drop policy if exists bom_items_select on public.bom_items;
create policy bom_items_select on public.bom_items
  for select to authenticated
  using (org_id = public.current_org_id());

drop policy if exists bom_items_write on public.bom_items;
create policy bom_items_write on public.bom_items
  for all to authenticated
  using (
    org_id = public.current_org_id()
    and public.current_user_role() in ('org_owner', 'org_admin', 'ops')
  )
  with check (
    org_id = public.current_org_id()
    and public.current_user_role() in ('org_owner', 'org_admin', 'ops')
  );
