-- ============================================================================
-- Migration: 0046_fk_hardening_sweep.sql
-- Wave: 6
-- Phase: 6.5 (workflow integration remediation)
-- Closes: G-QUOTE-SCHEMA-01, G-PROJECT-SCHEMA-01, G-INV-FK-01, G-PAY-SCHEMA-01,
--         G-RECV-FK-01, G-SHIP-FK-01, G-EXP-FK-01
-- Date: 2026-05-18
-- DOWN MIGRATION: operator-only. Drop the named constraints / columns in
--   reverse order. Not auto-run. Removing the project_id columns on
--   receiving_orders, shipments, and expenses would lose linkage data.
--
-- Constitutional alignment:
--   RLS rules        Untouched. Existing Pattern A policies on each table
--                    continue to govern access; FK constraints do not
--                    bypass RLS. The new project_id columns are nullable
--                    so existing rows pass without backfill.
--   Audit rules      Untouched. Schema-only changes.
--   Money rules      Untouched. No monetary columns added.
--   Migration rules  Forward-only. All ADD CONSTRAINT / ADD COLUMN
--                    statements wrapped in do-block exception handlers so
--                    re-application is a no-op. Postgres has IF NOT EXISTS
--                    on ADD COLUMN but not on ADD CONSTRAINT; the exception
--                    handler covers both.
--
-- Background: the Phase 6 audit found seven FK columns that were declared
-- as bare uuid in Wave 2 migrations and never wired to their parents.
-- The constraint additions harden the chain so cross-domain conversions
-- (convert_quote_to_project, convert_project_to_invoice) cannot accidentally
-- write a dangling FK. The three new project_id columns close the schema
-- gap that blocked receiving / shipment / expense project tagging.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- quotes.customer_id -> customers(id)  (G-QUOTE-SCHEMA-01)
-- ---------------------------------------------------------------------------

do $$
begin
  alter table public.quotes
    add constraint quotes_customer_id_fkey
    foreign key (customer_id) references public.customers(id)
    on delete set null;
exception when duplicate_object then null;
end$$;

-- ---------------------------------------------------------------------------
-- projects.customer_id -> customers(id)  (G-PROJECT-SCHEMA-01)
-- source_quote_id FK already declared in migration 0016.
-- ---------------------------------------------------------------------------

do $$
begin
  alter table public.projects
    add constraint projects_customer_id_fkey
    foreign key (customer_id) references public.customers(id)
    on delete set null;
exception when duplicate_object then null;
end$$;

-- ---------------------------------------------------------------------------
-- invoices: customer_id, project_id, quote_id  (G-INV-FK-01)
-- All three were bare uuid in 0018; declare them as FKs now.
-- ---------------------------------------------------------------------------

do $$
begin
  alter table public.invoices
    add constraint invoices_customer_id_fkey
    foreign key (customer_id) references public.customers(id)
    on delete set null;
exception when duplicate_object then null;
end$$;

do $$
begin
  alter table public.invoices
    add constraint invoices_project_id_fkey
    foreign key (project_id) references public.projects(id)
    on delete set null;
exception when duplicate_object then null;
end$$;

do $$
begin
  alter table public.invoices
    add constraint invoices_quote_id_fkey
    foreign key (quote_id) references public.quotes(id)
    on delete set null;
exception when duplicate_object then null;
end$$;

-- ---------------------------------------------------------------------------
-- payments.customer_id -> customers(id)  (G-PAY-SCHEMA-01)
-- ---------------------------------------------------------------------------

do $$
begin
  alter table public.payments
    add constraint payments_customer_id_fkey
    foreign key (customer_id) references public.customers(id)
    on delete set null;
exception when duplicate_object then null;
end$$;

-- ---------------------------------------------------------------------------
-- receiving_orders.project_id (new nullable column + FK)  (G-RECV-FK-01)
-- ---------------------------------------------------------------------------

alter table public.receiving_orders
  add column if not exists project_id uuid;

do $$
begin
  alter table public.receiving_orders
    add constraint receiving_orders_project_id_fkey
    foreign key (project_id) references public.projects(id)
    on delete set null;
exception when duplicate_object then null;
end$$;

create index if not exists receiving_orders_project_idx
  on public.receiving_orders (project_id)
  where deleted_at is null and project_id is not null;

-- ---------------------------------------------------------------------------
-- shipments.project_id (new nullable column + FK)  (G-SHIP-FK-01)
-- ---------------------------------------------------------------------------

alter table public.shipments
  add column if not exists project_id uuid;

do $$
begin
  alter table public.shipments
    add constraint shipments_project_id_fkey
    foreign key (project_id) references public.projects(id)
    on delete set null;
exception when duplicate_object then null;
end$$;

create index if not exists shipments_project_idx
  on public.shipments (project_id)
  where deleted_at is null and project_id is not null;

-- ---------------------------------------------------------------------------
-- expenses.project_id (new nullable column + FK)  (G-EXP-FK-01, operator
-- approved). Closes the schema gap that blocked project-cost tracking for
-- reimbursable expenses.
-- ---------------------------------------------------------------------------

alter table public.expenses
  add column if not exists project_id uuid;

do $$
begin
  alter table public.expenses
    add constraint expenses_project_id_fkey
    foreign key (project_id) references public.projects(id)
    on delete set null;
exception when duplicate_object then null;
end$$;

create index if not exists expenses_project_idx
  on public.expenses (project_id)
  where deleted_at is null and project_id is not null;
