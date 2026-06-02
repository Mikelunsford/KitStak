-- ============================================================================
-- Migration: 0087_rls_select_wrap.sql
-- Wave: 10
-- Phase: Review remediation (WS-F / F1). RLS read-path performance.
-- Closes: F-Wave10-REVIEW-REMEDIATION (RLS-SELECT-WRAP)
-- Date: 2026-06-01
--
-- DOWN MIGRATION (operator-only; not auto-run):
--   No structural change. Each policy below is restored to its prior body by
--   replaying the CREATE POLICY from its source migration with the BARE
--   function calls (public.current_org_id(), public.current_user_role()) in
--   place of the (SELECT ...) wrapped form:
--     audit_log_select          -> 0001_foundation.sql
--     quotes_select/_write       -> 0014_sales_quotes.sql
--     quote_line_items_select/_write -> 0014_sales_quotes.sql
--     invoices_select/_write     -> 0018_invoicing_invoices.sql
--     invoice_line_items_select/_write -> 0018_invoicing_invoices.sql
--     stock_levels_select        -> 0030_inventory_warehouses_stock.sql
--     stock_movements_select     -> 0030_inventory_warehouses_stock.sql
--     projects_select/_write     -> 0016_sales_projects.sql
--     project_line_items_select/_write -> 0044_project_line_items.sql
--     customers_select/_write    -> 0007_crm_customers_contacts.sql
--     contacts_select/_write     -> 0007_crm_customers_contacts.sql
--     leads_select/_write        -> 0008_crm_activities_leads_opportunities.sql
--     opportunities_select/_write -> 0008_crm_activities_leads_opportunities.sql
--   Reverting only changes the planner's per-row re-evaluation behaviour; the
--   USING / WITH CHECK SEMANTICS are byte-for-byte identical, so a revert is
--   purely a performance regression, never a security or correctness change.
--
-- Constitutional alignment:
--   * RLS rules. Pattern A / Pattern B classification is UNCHANGED for every
--     policy. The predicates are logically identical: org_id = current_org_id()
--     and role IN (...) and parent-join EXISTS (...). Only the call form
--     changes: BARE current_org_id() / current_user_role() are wrapped as
--     (SELECT public.current_org_id()) / (SELECT public.current_user_role()).
--   * Forward-only. No edit to any already-applied migration. DROP POLICY IF
--     EXISTS + CREATE POLICY is idempotent and re-runnable.
--   * No money, idempotency, or audit_log schema change. audit_log_select is
--     recreated identically (same USING predicate), staying SELECT-only;
--     audit_log remains service-role-write-only and append-only.
--
-- Why:
--   Postgres re-evaluates a BARE STABLE function call inside an RLS USING /
--   WITH CHECK clause once PER ROW. Wrapping the call in a scalar subquery,
--   (SELECT public.current_org_id()), lets the planner hoist it to an
--   InitPlan evaluated ONCE per statement. This is the Supabase-documented RLS
--   read-path best practice (R-W10 LOW perf). The win scales with row count,
--   so this migration is SCOPED to the high-read tenant tables (the audit
--   ledger, the quote/invoice/project documents and their line-item children,
--   the CRM entities, and the inventory ledgers). The remaining lower-traffic
--   tenant tables are tracked as a follow-up (see closeout journal) and can be
--   wrapped in a later forward migration with no behavioural risk.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- audit_log: Pattern A SELECT-only (service-role writes). High read volume.
-- ---------------------------------------------------------------------------

drop policy if exists audit_log_select on public.audit_log;
create policy audit_log_select on public.audit_log
  for select to authenticated
  using (org_id = (select public.current_org_id()));

-- ---------------------------------------------------------------------------
-- quotes: Pattern A.
-- ---------------------------------------------------------------------------

drop policy if exists quotes_select on public.quotes;
create policy quotes_select on public.quotes
  for select to authenticated
  using (org_id = (select public.current_org_id()));

drop policy if exists quotes_write on public.quotes;
create policy quotes_write on public.quotes
  for all to authenticated
  using (
    org_id = (select public.current_org_id())
    and (select public.current_user_role()) in ('org_owner', 'org_admin', 'sales', 'accounting')
  )
  with check (
    org_id = (select public.current_org_id())
    and (select public.current_user_role()) in ('org_owner', 'org_admin', 'sales', 'accounting')
  );

-- ---------------------------------------------------------------------------
-- quote_line_items: Pattern B parent-join through quotes.org_id.
-- ---------------------------------------------------------------------------

drop policy if exists quote_line_items_select on public.quote_line_items;
create policy quote_line_items_select on public.quote_line_items
  for select to authenticated
  using (
    exists (
      select 1 from public.quotes q
       where q.id = quote_line_items.quote_id
         and q.org_id = (select public.current_org_id())
    )
  );

drop policy if exists quote_line_items_write on public.quote_line_items;
create policy quote_line_items_write on public.quote_line_items
  for all to authenticated
  using (
    exists (
      select 1 from public.quotes q
       where q.id = quote_line_items.quote_id
         and q.org_id = (select public.current_org_id())
         and (select public.current_user_role()) in
             ('org_owner', 'org_admin', 'sales', 'accounting')
    )
  )
  with check (
    exists (
      select 1 from public.quotes q
       where q.id = quote_line_items.quote_id
         and q.org_id = (select public.current_org_id())
         and (select public.current_user_role()) in
             ('org_owner', 'org_admin', 'sales', 'accounting')
    )
  );

-- ---------------------------------------------------------------------------
-- invoices: Pattern A.
-- ---------------------------------------------------------------------------

drop policy if exists invoices_select on public.invoices;
create policy invoices_select on public.invoices
  for select to authenticated
  using (org_id = (select public.current_org_id()));

drop policy if exists invoices_write on public.invoices;
create policy invoices_write on public.invoices
  for all to authenticated
  using (
    org_id = (select public.current_org_id())
    and (select public.current_user_role()) in ('org_owner', 'org_admin', 'accounting', 'sales')
  )
  with check (
    org_id = (select public.current_org_id())
    and (select public.current_user_role()) in ('org_owner', 'org_admin', 'accounting', 'sales')
  );

-- ---------------------------------------------------------------------------
-- invoice_line_items: Pattern B parent-join through invoices.org_id.
-- ---------------------------------------------------------------------------

drop policy if exists invoice_line_items_select on public.invoice_line_items;
create policy invoice_line_items_select on public.invoice_line_items
  for select to authenticated
  using (
    exists (
      select 1 from public.invoices i
       where i.id = invoice_line_items.invoice_id
         and i.org_id = (select public.current_org_id())
    )
  );

drop policy if exists invoice_line_items_write on public.invoice_line_items;
create policy invoice_line_items_write on public.invoice_line_items
  for all to authenticated
  using (
    exists (
      select 1 from public.invoices i
       where i.id = invoice_line_items.invoice_id
         and i.org_id = (select public.current_org_id())
         and (select public.current_user_role()) in ('org_owner', 'org_admin', 'accounting', 'sales')
    )
  )
  with check (
    exists (
      select 1 from public.invoices i
       where i.id = invoice_line_items.invoice_id
         and i.org_id = (select public.current_org_id())
         and (select public.current_user_role()) in ('org_owner', 'org_admin', 'accounting', 'sales')
    )
  );

-- ---------------------------------------------------------------------------
-- stock_levels: Pattern A SELECT-only (trigger-maintained). High read volume.
-- ---------------------------------------------------------------------------

drop policy if exists stock_levels_select on public.stock_levels;
create policy stock_levels_select on public.stock_levels
  for select to authenticated
  using (org_id = (select public.current_org_id()));

-- ---------------------------------------------------------------------------
-- stock_movements: Pattern A SELECT-only append-only ledger. High read volume.
-- ---------------------------------------------------------------------------

drop policy if exists stock_movements_select on public.stock_movements;
create policy stock_movements_select on public.stock_movements
  for select to authenticated
  using (org_id = (select public.current_org_id()));

-- ---------------------------------------------------------------------------
-- projects: Pattern A.
-- ---------------------------------------------------------------------------

drop policy if exists projects_select on public.projects;
create policy projects_select on public.projects
  for select to authenticated
  using (org_id = (select public.current_org_id()));

drop policy if exists projects_write on public.projects;
create policy projects_write on public.projects
  for all to authenticated
  using (
    org_id = (select public.current_org_id())
    and (select public.current_user_role()) in ('org_owner', 'org_admin', 'sales', 'ops', 'accounting')
  )
  with check (
    org_id = (select public.current_org_id())
    and (select public.current_user_role()) in ('org_owner', 'org_admin', 'sales', 'ops', 'accounting')
  );

-- ---------------------------------------------------------------------------
-- project_line_items: Pattern A (carries own org_id).
-- ---------------------------------------------------------------------------

drop policy if exists project_line_items_select on public.project_line_items;
create policy project_line_items_select on public.project_line_items
  for select to authenticated
  using (org_id = (select public.current_org_id()));

drop policy if exists project_line_items_write on public.project_line_items;
create policy project_line_items_write on public.project_line_items
  for all to authenticated
  using (
    org_id = (select public.current_org_id())
    and (select public.current_user_role()) in
        ('org_owner', 'org_admin', 'sales', 'ops', 'accounting')
  )
  with check (
    org_id = (select public.current_org_id())
    and (select public.current_user_role()) in
        ('org_owner', 'org_admin', 'sales', 'ops', 'accounting')
  );

-- ---------------------------------------------------------------------------
-- customers: Pattern A.
-- ---------------------------------------------------------------------------

drop policy if exists customers_select on public.customers;
create policy customers_select on public.customers
  for select to authenticated
  using (org_id = (select public.current_org_id()));

drop policy if exists customers_write on public.customers;
create policy customers_write on public.customers
  for all to authenticated
  using (
    org_id = (select public.current_org_id())
    and (select public.current_user_role()) in (
      'org_owner', 'org_admin', 'sales', 'ops'
    )
  )
  with check (
    org_id = (select public.current_org_id())
    and (select public.current_user_role()) in (
      'org_owner', 'org_admin', 'sales', 'ops'
    )
  );

-- ---------------------------------------------------------------------------
-- contacts: Pattern A.
-- ---------------------------------------------------------------------------

drop policy if exists contacts_select on public.contacts;
create policy contacts_select on public.contacts
  for select to authenticated
  using (org_id = (select public.current_org_id()));

drop policy if exists contacts_write on public.contacts;
create policy contacts_write on public.contacts
  for all to authenticated
  using (
    org_id = (select public.current_org_id())
    and (select public.current_user_role()) in (
      'org_owner', 'org_admin', 'sales', 'ops'
    )
  )
  with check (
    org_id = (select public.current_org_id())
    and (select public.current_user_role()) in (
      'org_owner', 'org_admin', 'sales', 'ops'
    )
  );

-- ---------------------------------------------------------------------------
-- leads: Pattern A.
-- ---------------------------------------------------------------------------

drop policy if exists leads_select on public.leads;
create policy leads_select on public.leads
  for select to authenticated
  using (org_id = (select public.current_org_id()));

drop policy if exists leads_write on public.leads;
create policy leads_write on public.leads
  for all to authenticated
  using (
    org_id = (select public.current_org_id())
    and (select public.current_user_role()) in (
      'org_owner', 'org_admin', 'sales'
    )
  )
  with check (
    org_id = (select public.current_org_id())
    and (select public.current_user_role()) in (
      'org_owner', 'org_admin', 'sales'
    )
  );

-- ---------------------------------------------------------------------------
-- opportunities: Pattern A.
-- ---------------------------------------------------------------------------

drop policy if exists opportunities_select on public.opportunities;
create policy opportunities_select on public.opportunities
  for select to authenticated
  using (org_id = (select public.current_org_id()));

drop policy if exists opportunities_write on public.opportunities;
create policy opportunities_write on public.opportunities
  for all to authenticated
  using (
    org_id = (select public.current_org_id())
    and (select public.current_user_role()) in (
      'org_owner', 'org_admin', 'sales'
    )
  )
  with check (
    org_id = (select public.current_org_id())
    and (select public.current_user_role()) in (
      'org_owner', 'org_admin', 'sales'
    )
  );
