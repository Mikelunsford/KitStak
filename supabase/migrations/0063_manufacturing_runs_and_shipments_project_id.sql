-- ============================================================================
-- Migration: 0063_manufacturing_runs_and_shipments_project_id.sql
-- Wave: C (E2E Audit v3 follow-up, bundled C5)
-- Phase: Project linkage hardening for cost reporting + deep-link flows
-- Closes: F-Wave9-UX-Q6-SHIPMENT-LIST-FILTER-01 (server-side project_id filter
--         on /shipments), opens the schema path for Manufacturing -> Project
--         cost rollups (Pillar 2 -> Pillar 1 cost surface).
-- Date: 2026-05-22
--
-- DOWN MIGRATION (operator-only; not auto-run):
--   -- Dropping the linkage loses cost-rollup data the SPA depends on once
--   -- the C3 / C4 PRs ship; operator-only.
--   drop index if exists public.shipments_project_id_idx;
--   drop index if exists public.manufacturing_runs_project_id_idx;
--   alter table public.manufacturing_runs
--     drop constraint if exists manufacturing_runs_project_id_fkey;
--   alter table public.manufacturing_runs drop column if exists project_id;
--   -- shipments.project_id was added by 0046 (G-SHIP-FK-01); the column +
--   -- FK + index there are independent of this migration and must NOT be
--   -- dropped here. Only the new `_id_idx` alias added below would be
--   -- dropped.
--
-- Constitutional alignment:
--   Money rules       Untouched. No monetary columns added; the FK and index
--                     do not affect _cents storage or banker's-rounding math.
--                     The C2 / C4 PRs that follow this one wire the
--                     manufacturing-run unit_cost_cents rollup against the
--                     project the run is bound to; the FK declared here is
--                     the precondition for that rollup query plan.
--   RLS rules         Untouched. Both tables already carry Pattern A RLS
--                     (org_id = current_org_id() + role gate):
--                       - manufacturing_runs via 0052 lines 207-222
--                       - shipments           via 0032 (3PL ops chassis)
--                     The new project_id column is read and written under
--                     the same gate. The FK constrains the *value* of
--                     project_id (must point to an existing row in
--                     public.projects) and does NOT bypass RLS. Cross-tenant
--                     project_id writes still 404 at the handler level
--                     because the projects row is invisible under the org
--                     gate. ON DELETE SET NULL means deleting a project
--                     within the same org nulls the linkage rather than
--                     cascading the delete (mirrors 0046 / 0062 convention).
--   Audit rules       No new audit row required. project_id is metadata
--                     (workflow linkage), not state. The existing
--                     trg_audit_manufacturing_runs_status trigger
--                     (0052 lines 385-444) fires AFTER UPDATE OF status, so
--                     a project_id-only UPDATE is silently absorbed. The
--                     existing shipment audit triggers (0033 / 0036) follow
--                     the same convention. This matches how customer_id,
--                     vendor_id, and (on receiving_orders) project_id
--                     already behave on their respective tables.
--   Migration rules   Forward-only. All DDL idempotent (column add uses
--                     IF NOT EXISTS; constraint add wrapped in do-block
--                     exception handler; index add uses IF NOT EXISTS).
--                     The shipments DDL is a no-op on every environment
--                     that has already applied 0046; the manufacturing_runs
--                     DDL is the live structural change introduced by this
--                     migration. Charter intent (parity between the two
--                     tables) is preserved by declaring both halves in this
--                     one file so a future read of the migrations log can
--                     locate the linkage decision at a single point in
--                     history.
--   Branding          No user-facing copy added by this migration.
--
-- Background (Wave C of the E2E Audit v3 follow-up):
--   Wave 9 closed the receiving -> project linkage (0061 / 0062 + ops-api
--   ReceivingCreate schema + ReceivingOrderSchema + ProjectDetailPage
--   filter). Two adjacent linkages remained:
--
--     1) shipments.project_id existed at the DB level (0046, G-SHIP-FK-01)
--        but had no server-side query filter and no SPA hook plumbing the
--        project_id round-trip. ProjectDetailPage carried a duck-typed
--        cast against `unknown` to compensate. Closes
--        F-Wave9-UX-Q6-SHIPMENT-LIST-FILTER-01.
--
--     2) manufacturing_runs had no project_id at all. The Pillar 2 cost
--        surface (KitCost rollups, project-level material burn) needs a
--        run -> project hop so a run's consumed line items can be totalled
--        against the project budget.
--
--   This migration is the structural assertion for both halves. PRs C2-C4
--   in this wave wire the handlers, side-cars, and SPA against the
--   resulting columns.
--
--   Operator decision (locked 2026-05-22): both linkages are nullable,
--   on delete set null, with a partial index narrowed to live rows with a
--   non-null project_id. This is the same shape used by
--   receiving_orders_project_id_idx (0062 lines 112-114),
--   expenses_project_idx (0046 lines 163-165), and the original
--   shipments_project_idx (0046 lines 141-143). Index name follows the
--   `<table>_<column>_idx` constitutional convention; 0046's
--   `shipments_project_idx` predates the convention and is left in place
--   to avoid an operator-facing DROP INDEX during a forward-only deploy
--   (the planner will pick one; a follow-up may consolidate).
--
-- Investigation: 03-workspace/journal/2026-05-22-smoke-fix-wave-closeout.md
--                03-workspace/journal/2026-05-21-e2e-smoke-investigation.md
-- ============================================================================

-- ---------------------------------------------------------------------------
-- manufacturing_runs.project_id (new nullable column + FK + partial index).
-- The live structural change in this migration. ON DELETE SET NULL keeps
-- the run intact when the project is deleted (deleting the cost rollup
-- target should not cascade-delete the consumed materials record).
-- ---------------------------------------------------------------------------

alter table public.manufacturing_runs
  add column if not exists project_id uuid;

do $$
begin
  alter table public.manufacturing_runs
    add constraint manufacturing_runs_project_id_fkey
    foreign key (project_id) references public.projects(id)
    on delete set null;
exception when duplicate_object then null;
end$$;

create index if not exists manufacturing_runs_project_id_idx
  on public.manufacturing_runs (project_id)
  where deleted_at is null and project_id is not null;

-- ---------------------------------------------------------------------------
-- shipments.project_id (idempotent no-op on environments that applied
-- 0046; declarative parity for future readers of the migrations log).
--
-- Charter intent: the two linkages travel together. Declaring both halves
-- in one migration means future operators reading the migrations log can
-- locate the cross-pillar project_id decision at a single point in
-- history, even though the shipments half was structurally created by
-- 0046. The IF-NOT-EXISTS / exception-handler / IF-NOT-EXISTS triple
-- makes every statement here a no-op when re-applied on any branch that
-- already has 0046.
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

-- The `_id_idx` variant added here matches the constitutional convention.
-- 0046's `shipments_project_idx` (without `_id_`) carries the same
-- predicate and is left in place; both can coexist. A follow-up
-- F-Wave-C-SHIP-INDEX-CONSOLIDATE-01 may merge them once the operator
-- confirms no query plan depends on the older name.
create index if not exists shipments_project_id_idx
  on public.shipments (project_id)
  where deleted_at is null and project_id is not null;
