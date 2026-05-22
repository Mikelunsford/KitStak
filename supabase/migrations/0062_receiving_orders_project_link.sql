-- ============================================================================
-- Migration: 0062_receiving_orders_project_link.sql
-- Wave: 9
-- Phase: UX revision follow-ups (Q6)
-- Closes: F-Wave9-UX-Q6-RECEIVING-PROJECT-LINK-01
-- Date: 2026-05-22
--
-- DOWN MIGRATION (operator-only; not auto-run):
--   -- Dropping the link is operator-only because it loses linkage data the
--   -- ProjectDetailPage and ReceivingOrdersListPage now depend on.
--   drop index if exists public.receiving_orders_project_id_idx;
--   alter table public.receiving_orders
--     drop constraint if exists receiving_orders_project_id_fkey;
--   alter table public.receiving_orders drop column if exists project_id;
--
-- Constitutional alignment:
--   Money rules       Untouched. No monetary columns added; the FK and index
--                     do not affect _cents storage or banker's-rounding math.
--   RLS rules         Untouched. receiving_orders carries Pattern A
--                     (org_id = current_org_id()) from migration 0032
--                     lines 49-66; the new column is read and written under
--                     the same gate. The FK constrains the *value* of
--                     project_id (must point to an existing row in
--                     public.projects) and does NOT bypass RLS. Cross-tenant
--                     project_id writes still 404 at the handler level
--                     because the projects row is invisible under the org
--                     gate. ON DELETE SET NULL means deleting a project
--                     within the same org nulls the receiving order's
--                     linkage rather than cascading the delete.
--   Audit rules       No new audit row required. project_id is metadata
--                     (workflow linkage), not state. The existing
--                     trg_audit_receiving_orders_state trigger fires AFTER
--                     UPDATE OF status, so a project_id-only UPDATE is
--                     silently absorbed. This matches how customer_id and
--                     vendor_id behave on the same table.
--   Migration rules   Forward-only. Idempotent (column add uses IF NOT
--                     EXISTS; constraint add wrapped in do-block exception
--                     handler; index add uses IF NOT EXISTS). Safe to
--                     re-apply after 0046 already declared the same
--                     structure.
--   Branding          No user-facing copy added by this migration.
--
-- Background (UX-Q6 from the 2026-05-21 UX revision walk):
--   The operator's E2E smoke walk surfaced that "New receiving order"
--   launched from a project page never linked back to the project, even
--   though migration 0046 (Wave 6) had already added the column + FK in
--   anticipation of this carry-through. The schema lay dormant because
--   the ops-api ReceivingCreate Zod schema did not enumerate project_id
--   (silently stripped server-side), and the SPA ReceivingOrderSchema
--   omitted the column on read (the ProjectDetailPage filter used a
--   duck-typed cast against `unknown`).
--
--   This migration is the structural assertion that locks in the column,
--   the FK, and the partial index so the UX-Q6 PR's API + Zod + SPA
--   changes have a guaranteed underlying schema. 0046 created the
--   structure; 0062 records the operator's UX-Q6 decision and gives the
--   regression test (db-0062-receiving-project-fk.test.ts) a stable
--   filename to assert against.
--
--   Operator decision (locked 2026-05-22): receiving_orders carries the
--   project_id linkage, NOT shipments. Shipments already carry their own
--   project_id from 0046 (G-SHIP-FK-01) and the UX-Q4 shipment-to-invoice
--   deep link depends on it; the UX-Q6 question of *where to add the
--   inbound linkage* was resolved in favor of receiving so that the
--   inbound chain (PO -> receiving -> project) and the outbound chain
--   (project -> shipment -> invoice) each carry their own project hop.
--
-- Investigation: 03-workspace/journal/2026-05-21-e2e-smoke-investigation.md
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Column. Idempotent (no-op if 0046 already added it).
-- ---------------------------------------------------------------------------

alter table public.receiving_orders
  add column if not exists project_id uuid;

-- ---------------------------------------------------------------------------
-- 2) Foreign key. Postgres has no IF NOT EXISTS on ADD CONSTRAINT, so wrap
--    in a do-block exception handler. Idempotent on re-application after
--    0046 already declared the same constraint name.
-- ---------------------------------------------------------------------------

do $$
begin
  alter table public.receiving_orders
    add constraint receiving_orders_project_id_fkey
    foreign key (project_id) references public.projects(id)
    on delete set null;
exception when duplicate_object then null;
end$$;

-- ---------------------------------------------------------------------------
-- 3) Partial index. UX-Q6 introduces two new lookup patterns:
--      (a) ProjectDetailPage listing receiving orders by project_id (the
--          new section above SHIPMENTS).
--      (b) ReceivingOrdersListPage filtering by ?project_id= (the new
--          query-param filter mirroring UX-Q5's status/state filters).
--    The partial WHERE clause keeps the index narrow: only live
--    (deleted_at IS NULL) rows with a non-null project_id are included.
--
--    Index name preserved as `receiving_orders_project_id_idx` to match
--    the constitutional convention (table_column_idx). 0046 used
--    `receiving_orders_project_idx`; this migration adds the explicit
--    `_id_idx` variant. Both indexes carry the same predicate so the
--    planner will pick one; we keep both to avoid an operator-facing
--    DROP INDEX during a forward-only deploy. A follow-up
--    F-Wave9-UX-Q6-INDEX-CONSOLIDATE-01 may merge them once the operator
--    confirms no query plan depends on the older name.
-- ---------------------------------------------------------------------------

create index if not exists receiving_orders_project_id_idx
  on public.receiving_orders (project_id)
  where deleted_at is null and project_id is not null;
