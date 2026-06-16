-- ============================================================================
-- Migration: 0116_rls_policy_consolidation.sql
-- Wave: 13
-- Phase: C. Performance hardening of the RLS policy surface. The Supabase
--   performance advisor flagged two classes of policy inefficiency on the live
--   catalog (project zmnvwhqjahwidprnjxrq):
--     (1) 88 multiple_permissive_policies. Every tenant-scoped table carries a
--         <table>_select policy (FOR SELECT) AND a <table>_write policy
--         (FOR ALL). Because a FOR ALL policy also applies to SELECT, the
--         planner must OR two permissive policies on every SELECT, which is
--         redundant work at scale. This migration drops the FOR ALL <table>_write
--         policy and re-creates the write half as three command-scoped policies
--         (FOR INSERT, FOR UPDATE, FOR DELETE), so SELECT is governed by exactly
--         one policy (<table>_select). Access semantics are unchanged: the new
--         insert/update/delete policies carry the SAME predicate the FOR ALL
--         policy carried (qual == with_check on every affected table, verified
--         from the catalog), and SELECT keeps the same <table>_select predicate.
--     (2) 7 auth_rls_initplan. Policies that call current_org_id() /
--         current_user_role() / auth.uid() unwrapped re-evaluate the function
--         per row. Wrapping each call as (select fn()) lets the planner evaluate
--         it once per query (an InitPlan). current_org_id and current_user_role
--         are STABLE security-definer; auth.uid is STABLE. The wrap is a planner
--         hint only and preserves exact results. Every recreated policy below
--         uses the wrapped form. The 4 initplan-only tables (profiles,
--         idempotency_keys, notifications, and saved_views which also appears in
--         class 1) are rewrapped without any command-scope change.
--   This MUST NOT change who can see or do what. Pattern A (org_id =
--   current_org_id() plus role check), Pattern B (parent-join EXISTS), and the
--   self-row patterns (auth.uid()) are all preserved exactly. Cross-tenant reads
--   still return 200 + []; workflow POSTs still 404; bundle gates still 404;
--   per-route flag misses still 403 FEATURE_DISABLED. No predicate is widened or
--   narrowed.
-- Closes: R-W13-PERF-02
-- Date: 2026-06-15
--
-- DOWN MIGRATION (operator-only):
--   The DOWN MIGRATION block at the bottom of this file restores every policy to
--   its pre-0116 shape verbatim: it drops the command-scoped insert/update/delete
--   policies and re-creates the single FOR ALL <table>_write policy, and reverts
--   the initplan rewraps to their original (un-wrapped) predicates. To roll back,
--   an operator runs the statements in the DOWN MIGRATION block. No data is
--   touched; this is a policy-definition-only change and is fully reversible. Do
--   NOT edit this file after apply; write a new forward migration if a change is
--   ever needed.
--
-- Constitutional alignment:
--   - RLS-policy-only change. No table, column, index, trigger, money helper,
--     idempotency storage, audit_log, stock-ledger, or auto-JE/audit-trigger DDL
--     is touched. This is a STOP-AND-ASK surface (RLS): the file is authored and
--     committed on the feature branch but is NOT applied to any database. It
--     halts for operator review and a staging `pnpm test:rls` run before merge.
--   - Semantics preserved: predicates are byte-identical modulo (a) the
--     (select fn()) initplan wrap of STABLE functions and (b) splitting one
--     FOR ALL policy into FOR INSERT/UPDATE/DELETE with the same predicate. No
--     role list, org scope, or parent-join is altered. RLS still filters and
--     never throws.
--   - Idempotent: every statement is `drop policy if exists` followed by
--     `create policy`. Safe to re-apply.
--   - Derived from the authoritative pg_policies catalog, not hand enumeration.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Part 1: consolidate the 88 select + write tables (multiple_permissive_policies)
-- ----------------------------------------------------------------------------

-- account_service_definitions
drop policy if exists account_service_definitions_select on public.account_service_definitions;
drop policy if exists account_service_definitions_write on public.account_service_definitions;
drop policy if exists account_service_definitions_insert on public.account_service_definitions;
drop policy if exists account_service_definitions_update on public.account_service_definitions;
drop policy if exists account_service_definitions_delete on public.account_service_definitions;
create policy account_service_definitions_select on public.account_service_definitions
  for select to authenticated
  using ((org_id = (select current_org_id())));
create policy account_service_definitions_insert on public.account_service_definitions
  for insert to authenticated
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text, 'sales'::text]))));
create policy account_service_definitions_update on public.account_service_definitions
  for update to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text, 'sales'::text]))))
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text, 'sales'::text]))));
create policy account_service_definitions_delete on public.account_service_definitions
  for delete to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text, 'sales'::text]))));

-- activities
drop policy if exists activities_select on public.activities;
drop policy if exists activities_write on public.activities;
drop policy if exists activities_insert on public.activities;
drop policy if exists activities_update on public.activities;
drop policy if exists activities_delete on public.activities;
create policy activities_select on public.activities
  for select to authenticated
  using ((org_id = (select current_org_id())));
create policy activities_insert on public.activities
  for insert to authenticated
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'sales'::text, 'ops'::text]))));
create policy activities_update on public.activities
  for update to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'sales'::text, 'ops'::text]))))
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'sales'::text, 'ops'::text]))));
create policy activities_delete on public.activities
  for delete to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'sales'::text, 'ops'::text]))));

-- attachments
drop policy if exists attachments_select on public.attachments;
drop policy if exists attachments_write on public.attachments;
drop policy if exists attachments_insert on public.attachments;
drop policy if exists attachments_update on public.attachments;
drop policy if exists attachments_delete on public.attachments;
create policy attachments_select on public.attachments
  for select to authenticated
  using ((org_id = (select current_org_id())));
create policy attachments_insert on public.attachments
  for insert to authenticated
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'sales'::text, 'ops'::text, 'accounting'::text]))));
create policy attachments_update on public.attachments
  for update to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'sales'::text, 'ops'::text, 'accounting'::text]))))
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'sales'::text, 'ops'::text, 'accounting'::text]))));
create policy attachments_delete on public.attachments
  for delete to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'sales'::text, 'ops'::text, 'accounting'::text]))));

-- billing_reviews
drop policy if exists billing_reviews_select on public.billing_reviews;
drop policy if exists billing_reviews_write on public.billing_reviews;
drop policy if exists billing_reviews_insert on public.billing_reviews;
drop policy if exists billing_reviews_update on public.billing_reviews;
drop policy if exists billing_reviews_delete on public.billing_reviews;
create policy billing_reviews_select on public.billing_reviews
  for select to authenticated
  using ((org_id = (select current_org_id())));
create policy billing_reviews_insert on public.billing_reviews
  for insert to authenticated
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text, 'sales'::text, 'accounting'::text]))));
create policy billing_reviews_update on public.billing_reviews
  for update to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text, 'sales'::text, 'accounting'::text]))))
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text, 'sales'::text, 'accounting'::text]))));
create policy billing_reviews_delete on public.billing_reviews
  for delete to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text, 'sales'::text, 'accounting'::text]))));

-- bom_items
drop policy if exists bom_items_select on public.bom_items;
drop policy if exists bom_items_write on public.bom_items;
drop policy if exists bom_items_insert on public.bom_items;
drop policy if exists bom_items_update on public.bom_items;
drop policy if exists bom_items_delete on public.bom_items;
create policy bom_items_select on public.bom_items
  for select to authenticated
  using ((org_id = (select current_org_id())));
create policy bom_items_insert on public.bom_items
  for insert to authenticated
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))));
create policy bom_items_update on public.bom_items
  for update to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))))
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))));
create policy bom_items_delete on public.bom_items
  for delete to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))));

-- chart_of_accounts
drop policy if exists chart_of_accounts_select on public.chart_of_accounts;
drop policy if exists chart_of_accounts_write on public.chart_of_accounts;
drop policy if exists chart_of_accounts_insert on public.chart_of_accounts;
drop policy if exists chart_of_accounts_update on public.chart_of_accounts;
drop policy if exists chart_of_accounts_delete on public.chart_of_accounts;
create policy chart_of_accounts_select on public.chart_of_accounts
  for select to authenticated
  using ((org_id = (select current_org_id())));
create policy chart_of_accounts_insert on public.chart_of_accounts
  for insert to authenticated
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'accounting'::text]))));
create policy chart_of_accounts_update on public.chart_of_accounts
  for update to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'accounting'::text]))))
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'accounting'::text]))));
create policy chart_of_accounts_delete on public.chart_of_accounts
  for delete to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'accounting'::text]))));

-- comments
drop policy if exists comments_select on public.comments;
drop policy if exists comments_write on public.comments;
drop policy if exists comments_insert on public.comments;
drop policy if exists comments_update on public.comments;
drop policy if exists comments_delete on public.comments;
create policy comments_select on public.comments
  for select to authenticated
  using ((org_id = (select current_org_id())));
create policy comments_insert on public.comments
  for insert to authenticated
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'sales'::text, 'ops'::text, 'accounting'::text, 'viewer'::text]))));
create policy comments_update on public.comments
  for update to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'sales'::text, 'ops'::text, 'accounting'::text, 'viewer'::text]))))
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'sales'::text, 'ops'::text, 'accounting'::text, 'viewer'::text]))));
create policy comments_delete on public.comments
  for delete to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'sales'::text, 'ops'::text, 'accounting'::text, 'viewer'::text]))));

-- contacts
drop policy if exists contacts_select on public.contacts;
drop policy if exists contacts_write on public.contacts;
drop policy if exists contacts_insert on public.contacts;
drop policy if exists contacts_update on public.contacts;
drop policy if exists contacts_delete on public.contacts;
create policy contacts_select on public.contacts
  for select to authenticated
  using ((org_id = (select current_org_id())));
create policy contacts_insert on public.contacts
  for insert to authenticated
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'sales'::text, 'ops'::text]))));
create policy contacts_update on public.contacts
  for update to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'sales'::text, 'ops'::text]))))
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'sales'::text, 'ops'::text]))));
create policy contacts_delete on public.contacts
  for delete to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'sales'::text, 'ops'::text]))));

-- credit_note_allocations
drop policy if exists credit_note_allocations_select on public.credit_note_allocations;
drop policy if exists credit_note_allocations_write on public.credit_note_allocations;
drop policy if exists credit_note_allocations_insert on public.credit_note_allocations;
drop policy if exists credit_note_allocations_update on public.credit_note_allocations;
drop policy if exists credit_note_allocations_delete on public.credit_note_allocations;
create policy credit_note_allocations_select on public.credit_note_allocations
  for select to authenticated
  using ((EXISTS ( SELECT 1 FROM credit_notes cn WHERE ((cn.id = credit_note_allocations.credit_note_id) AND (cn.org_id = (select current_org_id()))))));
create policy credit_note_allocations_insert on public.credit_note_allocations
  for insert to authenticated
  with check ((EXISTS ( SELECT 1 FROM credit_notes cn WHERE ((cn.id = credit_note_allocations.credit_note_id) AND (cn.org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'accounting'::text]))))));
create policy credit_note_allocations_update on public.credit_note_allocations
  for update to authenticated
  using ((EXISTS ( SELECT 1 FROM credit_notes cn WHERE ((cn.id = credit_note_allocations.credit_note_id) AND (cn.org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'accounting'::text]))))))
  with check ((EXISTS ( SELECT 1 FROM credit_notes cn WHERE ((cn.id = credit_note_allocations.credit_note_id) AND (cn.org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'accounting'::text]))))));
create policy credit_note_allocations_delete on public.credit_note_allocations
  for delete to authenticated
  using ((EXISTS ( SELECT 1 FROM credit_notes cn WHERE ((cn.id = credit_note_allocations.credit_note_id) AND (cn.org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'accounting'::text]))))));

-- credit_notes
drop policy if exists credit_notes_select on public.credit_notes;
drop policy if exists credit_notes_write on public.credit_notes;
drop policy if exists credit_notes_insert on public.credit_notes;
drop policy if exists credit_notes_update on public.credit_notes;
drop policy if exists credit_notes_delete on public.credit_notes;
create policy credit_notes_select on public.credit_notes
  for select to authenticated
  using ((org_id = (select current_org_id())));
create policy credit_notes_insert on public.credit_notes
  for insert to authenticated
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'accounting'::text]))));
create policy credit_notes_update on public.credit_notes
  for update to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'accounting'::text]))))
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'accounting'::text]))));
create policy credit_notes_delete on public.credit_notes
  for delete to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'accounting'::text]))));

-- customer_pricing_overrides
drop policy if exists customer_pricing_overrides_select on public.customer_pricing_overrides;
drop policy if exists customer_pricing_overrides_write on public.customer_pricing_overrides;
drop policy if exists customer_pricing_overrides_insert on public.customer_pricing_overrides;
drop policy if exists customer_pricing_overrides_update on public.customer_pricing_overrides;
drop policy if exists customer_pricing_overrides_delete on public.customer_pricing_overrides;
create policy customer_pricing_overrides_select on public.customer_pricing_overrides
  for select to authenticated
  using ((org_id = (select current_org_id())));
create policy customer_pricing_overrides_insert on public.customer_pricing_overrides
  for insert to authenticated
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'accounting'::text, 'sales'::text]))));
create policy customer_pricing_overrides_update on public.customer_pricing_overrides
  for update to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'accounting'::text, 'sales'::text]))))
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'accounting'::text, 'sales'::text]))));
create policy customer_pricing_overrides_delete on public.customer_pricing_overrides
  for delete to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'accounting'::text, 'sales'::text]))));

-- customers
drop policy if exists customers_select on public.customers;
drop policy if exists customers_write on public.customers;
drop policy if exists customers_insert on public.customers;
drop policy if exists customers_update on public.customers;
drop policy if exists customers_delete on public.customers;
create policy customers_select on public.customers
  for select to authenticated
  using ((org_id = (select current_org_id())));
create policy customers_insert on public.customers
  for insert to authenticated
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'sales'::text, 'ops'::text]))));
create policy customers_update on public.customers
  for update to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'sales'::text, 'ops'::text]))))
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'sales'::text, 'ops'::text]))));
create policy customers_delete on public.customers
  for delete to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'sales'::text, 'ops'::text]))));

-- expense_categories
drop policy if exists expense_categories_select on public.expense_categories;
drop policy if exists expense_categories_write on public.expense_categories;
drop policy if exists expense_categories_insert on public.expense_categories;
drop policy if exists expense_categories_update on public.expense_categories;
drop policy if exists expense_categories_delete on public.expense_categories;
create policy expense_categories_select on public.expense_categories
  for select to authenticated
  using ((org_id = (select current_org_id())));
create policy expense_categories_insert on public.expense_categories
  for insert to authenticated
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'accounting'::text]))));
create policy expense_categories_update on public.expense_categories
  for update to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'accounting'::text]))))
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'accounting'::text]))));
create policy expense_categories_delete on public.expense_categories
  for delete to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'accounting'::text]))));

-- expenses
drop policy if exists expenses_select on public.expenses;
drop policy if exists expenses_write on public.expenses;
drop policy if exists expenses_insert on public.expenses;
drop policy if exists expenses_update on public.expenses;
drop policy if exists expenses_delete on public.expenses;
create policy expenses_select on public.expenses
  for select to authenticated
  using ((org_id = (select current_org_id())));
create policy expenses_insert on public.expenses
  for insert to authenticated
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'accounting'::text, 'ops'::text]))));
create policy expenses_update on public.expenses
  for update to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'accounting'::text, 'ops'::text]))))
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'accounting'::text, 'ops'::text]))));
create policy expenses_delete on public.expenses
  for delete to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'accounting'::text, 'ops'::text]))));

-- fulfillments
drop policy if exists fulfillments_select on public.fulfillments;
drop policy if exists fulfillments_write on public.fulfillments;
drop policy if exists fulfillments_insert on public.fulfillments;
drop policy if exists fulfillments_update on public.fulfillments;
drop policy if exists fulfillments_delete on public.fulfillments;
create policy fulfillments_select on public.fulfillments
  for select to authenticated
  using ((org_id = (select current_org_id())));
create policy fulfillments_insert on public.fulfillments
  for insert to authenticated
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))));
create policy fulfillments_update on public.fulfillments
  for update to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))))
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))));
create policy fulfillments_delete on public.fulfillments
  for delete to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))));

-- identity_providers
drop policy if exists identity_providers_select on public.identity_providers;
drop policy if exists identity_providers_write on public.identity_providers;
drop policy if exists identity_providers_insert on public.identity_providers;
drop policy if exists identity_providers_update on public.identity_providers;
drop policy if exists identity_providers_delete on public.identity_providers;
create policy identity_providers_select on public.identity_providers
  for select to authenticated
  using ((org_id = (select current_org_id())));
create policy identity_providers_insert on public.identity_providers
  for insert to authenticated
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text]))));
create policy identity_providers_update on public.identity_providers
  for update to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text]))))
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text]))));
create policy identity_providers_delete on public.identity_providers
  for delete to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text]))));

-- invoice_line_items
drop policy if exists invoice_line_items_select on public.invoice_line_items;
drop policy if exists invoice_line_items_write on public.invoice_line_items;
drop policy if exists invoice_line_items_insert on public.invoice_line_items;
drop policy if exists invoice_line_items_update on public.invoice_line_items;
drop policy if exists invoice_line_items_delete on public.invoice_line_items;
create policy invoice_line_items_select on public.invoice_line_items
  for select to authenticated
  using ((EXISTS ( SELECT 1 FROM invoices i WHERE ((i.id = invoice_line_items.invoice_id) AND (i.org_id = (select current_org_id()))))));
create policy invoice_line_items_insert on public.invoice_line_items
  for insert to authenticated
  with check ((EXISTS ( SELECT 1 FROM invoices i WHERE ((i.id = invoice_line_items.invoice_id) AND (i.org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'accounting'::text, 'sales'::text]))))));
create policy invoice_line_items_update on public.invoice_line_items
  for update to authenticated
  using ((EXISTS ( SELECT 1 FROM invoices i WHERE ((i.id = invoice_line_items.invoice_id) AND (i.org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'accounting'::text, 'sales'::text]))))))
  with check ((EXISTS ( SELECT 1 FROM invoices i WHERE ((i.id = invoice_line_items.invoice_id) AND (i.org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'accounting'::text, 'sales'::text]))))));
create policy invoice_line_items_delete on public.invoice_line_items
  for delete to authenticated
  using ((EXISTS ( SELECT 1 FROM invoices i WHERE ((i.id = invoice_line_items.invoice_id) AND (i.org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'accounting'::text, 'sales'::text]))))));

-- invoices
drop policy if exists invoices_select on public.invoices;
drop policy if exists invoices_write on public.invoices;
drop policy if exists invoices_insert on public.invoices;
drop policy if exists invoices_update on public.invoices;
drop policy if exists invoices_delete on public.invoices;
create policy invoices_select on public.invoices
  for select to authenticated
  using ((org_id = (select current_org_id())));
create policy invoices_insert on public.invoices
  for insert to authenticated
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'accounting'::text, 'sales'::text]))));
create policy invoices_update on public.invoices
  for update to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'accounting'::text, 'sales'::text]))))
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'accounting'::text, 'sales'::text]))));
create policy invoices_delete on public.invoices
  for delete to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'accounting'::text, 'sales'::text]))));

-- item_categories
drop policy if exists item_categories_select on public.item_categories;
drop policy if exists item_categories_write on public.item_categories;
drop policy if exists item_categories_insert on public.item_categories;
drop policy if exists item_categories_update on public.item_categories;
drop policy if exists item_categories_delete on public.item_categories;
create policy item_categories_select on public.item_categories
  for select to authenticated
  using ((org_id = (select current_org_id())));
create policy item_categories_insert on public.item_categories
  for insert to authenticated
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'sales'::text, 'ops'::text]))));
create policy item_categories_update on public.item_categories
  for update to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'sales'::text, 'ops'::text]))))
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'sales'::text, 'ops'::text]))));
create policy item_categories_delete on public.item_categories
  for delete to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'sales'::text, 'ops'::text]))));

-- items
drop policy if exists items_select on public.items;
drop policy if exists items_write on public.items;
drop policy if exists items_insert on public.items;
drop policy if exists items_update on public.items;
drop policy if exists items_delete on public.items;
create policy items_select on public.items
  for select to authenticated
  using ((org_id = (select current_org_id())));
create policy items_insert on public.items
  for insert to authenticated
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'sales'::text, 'ops'::text]))));
create policy items_update on public.items
  for update to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'sales'::text, 'ops'::text]))))
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'sales'::text, 'ops'::text]))));
create policy items_delete on public.items
  for delete to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'sales'::text, 'ops'::text]))));

-- job_run_daily_log_consumed_line_items
drop policy if exists job_run_daily_log_consumed_line_items_select on public.job_run_daily_log_consumed_line_items;
drop policy if exists job_run_daily_log_consumed_line_items_write on public.job_run_daily_log_consumed_line_items;
drop policy if exists job_run_daily_log_consumed_line_items_insert on public.job_run_daily_log_consumed_line_items;
drop policy if exists job_run_daily_log_consumed_line_items_update on public.job_run_daily_log_consumed_line_items;
drop policy if exists job_run_daily_log_consumed_line_items_delete on public.job_run_daily_log_consumed_line_items;
create policy job_run_daily_log_consumed_line_items_select on public.job_run_daily_log_consumed_line_items
  for select to authenticated
  using ((org_id = (select current_org_id())));
create policy job_run_daily_log_consumed_line_items_insert on public.job_run_daily_log_consumed_line_items
  for insert to authenticated
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text, 'sales'::text]))));
create policy job_run_daily_log_consumed_line_items_update on public.job_run_daily_log_consumed_line_items
  for update to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text, 'sales'::text]))))
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text, 'sales'::text]))));
create policy job_run_daily_log_consumed_line_items_delete on public.job_run_daily_log_consumed_line_items
  for delete to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text, 'sales'::text]))));

-- job_run_daily_log_produced_line_items
drop policy if exists job_run_daily_log_produced_line_items_select on public.job_run_daily_log_produced_line_items;
drop policy if exists job_run_daily_log_produced_line_items_write on public.job_run_daily_log_produced_line_items;
drop policy if exists job_run_daily_log_produced_line_items_insert on public.job_run_daily_log_produced_line_items;
drop policy if exists job_run_daily_log_produced_line_items_update on public.job_run_daily_log_produced_line_items;
drop policy if exists job_run_daily_log_produced_line_items_delete on public.job_run_daily_log_produced_line_items;
create policy job_run_daily_log_produced_line_items_select on public.job_run_daily_log_produced_line_items
  for select to authenticated
  using ((org_id = (select current_org_id())));
create policy job_run_daily_log_produced_line_items_insert on public.job_run_daily_log_produced_line_items
  for insert to authenticated
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text, 'sales'::text]))));
create policy job_run_daily_log_produced_line_items_update on public.job_run_daily_log_produced_line_items
  for update to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text, 'sales'::text]))))
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text, 'sales'::text]))));
create policy job_run_daily_log_produced_line_items_delete on public.job_run_daily_log_produced_line_items
  for delete to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text, 'sales'::text]))));

-- job_run_daily_logs
drop policy if exists job_run_daily_logs_select on public.job_run_daily_logs;
drop policy if exists job_run_daily_logs_write on public.job_run_daily_logs;
drop policy if exists job_run_daily_logs_insert on public.job_run_daily_logs;
drop policy if exists job_run_daily_logs_update on public.job_run_daily_logs;
drop policy if exists job_run_daily_logs_delete on public.job_run_daily_logs;
create policy job_run_daily_logs_select on public.job_run_daily_logs
  for select to authenticated
  using ((org_id = (select current_org_id())));
create policy job_run_daily_logs_insert on public.job_run_daily_logs
  for insert to authenticated
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text, 'sales'::text]))));
create policy job_run_daily_logs_update on public.job_run_daily_logs
  for update to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text, 'sales'::text]))))
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text, 'sales'::text]))));
create policy job_run_daily_logs_delete on public.job_run_daily_logs
  for delete to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text, 'sales'::text]))));

-- job_runs
drop policy if exists job_runs_select on public.job_runs;
drop policy if exists job_runs_write on public.job_runs;
drop policy if exists job_runs_insert on public.job_runs;
drop policy if exists job_runs_update on public.job_runs;
drop policy if exists job_runs_delete on public.job_runs;
create policy job_runs_select on public.job_runs
  for select to authenticated
  using ((org_id = (select current_org_id())));
create policy job_runs_insert on public.job_runs
  for insert to authenticated
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text, 'sales'::text]))));
create policy job_runs_update on public.job_runs
  for update to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text, 'sales'::text]))))
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text, 'sales'::text]))));
create policy job_runs_delete on public.job_runs
  for delete to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text, 'sales'::text]))));

-- job_template_lines
drop policy if exists job_template_lines_select on public.job_template_lines;
drop policy if exists job_template_lines_write on public.job_template_lines;
drop policy if exists job_template_lines_insert on public.job_template_lines;
drop policy if exists job_template_lines_update on public.job_template_lines;
drop policy if exists job_template_lines_delete on public.job_template_lines;
create policy job_template_lines_select on public.job_template_lines
  for select to authenticated
  using ((org_id = (select current_org_id())));
create policy job_template_lines_insert on public.job_template_lines
  for insert to authenticated
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text, 'sales'::text]))));
create policy job_template_lines_update on public.job_template_lines
  for update to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text, 'sales'::text]))))
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text, 'sales'::text]))));
create policy job_template_lines_delete on public.job_template_lines
  for delete to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text, 'sales'::text]))));

-- job_templates
drop policy if exists job_templates_select on public.job_templates;
drop policy if exists job_templates_write on public.job_templates;
drop policy if exists job_templates_insert on public.job_templates;
drop policy if exists job_templates_update on public.job_templates;
drop policy if exists job_templates_delete on public.job_templates;
create policy job_templates_select on public.job_templates
  for select to authenticated
  using ((org_id = (select current_org_id())));
create policy job_templates_insert on public.job_templates
  for insert to authenticated
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text, 'sales'::text]))));
create policy job_templates_update on public.job_templates
  for update to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text, 'sales'::text]))))
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text, 'sales'::text]))));
create policy job_templates_delete on public.job_templates
  for delete to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text, 'sales'::text]))));

-- job_types
drop policy if exists job_types_select on public.job_types;
drop policy if exists job_types_write on public.job_types;
drop policy if exists job_types_insert on public.job_types;
drop policy if exists job_types_update on public.job_types;
drop policy if exists job_types_delete on public.job_types;
create policy job_types_select on public.job_types
  for select to authenticated
  using ((org_id = (select current_org_id())));
create policy job_types_insert on public.job_types
  for insert to authenticated
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'sales'::text, 'ops'::text]))));
create policy job_types_update on public.job_types
  for update to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'sales'::text, 'ops'::text]))))
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'sales'::text, 'ops'::text]))));
create policy job_types_delete on public.job_types
  for delete to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'sales'::text, 'ops'::text]))));

-- journal_entries
drop policy if exists journal_entries_select on public.journal_entries;
drop policy if exists journal_entries_write on public.journal_entries;
drop policy if exists journal_entries_insert on public.journal_entries;
drop policy if exists journal_entries_update on public.journal_entries;
drop policy if exists journal_entries_delete on public.journal_entries;
create policy journal_entries_select on public.journal_entries
  for select to authenticated
  using ((org_id = (select current_org_id())));
create policy journal_entries_insert on public.journal_entries
  for insert to authenticated
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'accounting'::text]))));
create policy journal_entries_update on public.journal_entries
  for update to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'accounting'::text]))))
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'accounting'::text]))));
create policy journal_entries_delete on public.journal_entries
  for delete to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'accounting'::text]))));

-- journal_entry_lines
drop policy if exists journal_entry_lines_select on public.journal_entry_lines;
drop policy if exists journal_entry_lines_write on public.journal_entry_lines;
drop policy if exists journal_entry_lines_insert on public.journal_entry_lines;
drop policy if exists journal_entry_lines_update on public.journal_entry_lines;
drop policy if exists journal_entry_lines_delete on public.journal_entry_lines;
create policy journal_entry_lines_select on public.journal_entry_lines
  for select to authenticated
  using ((EXISTS ( SELECT 1 FROM journal_entries je WHERE ((je.id = journal_entry_lines.entry_id) AND (je.org_id = (select current_org_id()))))));
create policy journal_entry_lines_insert on public.journal_entry_lines
  for insert to authenticated
  with check ((EXISTS ( SELECT 1 FROM journal_entries je WHERE ((je.id = journal_entry_lines.entry_id) AND (je.org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'accounting'::text]))))));
create policy journal_entry_lines_update on public.journal_entry_lines
  for update to authenticated
  using ((EXISTS ( SELECT 1 FROM journal_entries je WHERE ((je.id = journal_entry_lines.entry_id) AND (je.org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'accounting'::text]))))))
  with check ((EXISTS ( SELECT 1 FROM journal_entries je WHERE ((je.id = journal_entry_lines.entry_id) AND (je.org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'accounting'::text]))))));
create policy journal_entry_lines_delete on public.journal_entry_lines
  for delete to authenticated
  using ((EXISTS ( SELECT 1 FROM journal_entries je WHERE ((je.id = journal_entry_lines.entry_id) AND (je.org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'accounting'::text]))))));

-- kitting_job_consumed_line_items
drop policy if exists kitting_job_consumed_line_items_select on public.kitting_job_consumed_line_items;
drop policy if exists kitting_job_consumed_line_items_write on public.kitting_job_consumed_line_items;
drop policy if exists kitting_job_consumed_line_items_insert on public.kitting_job_consumed_line_items;
drop policy if exists kitting_job_consumed_line_items_update on public.kitting_job_consumed_line_items;
drop policy if exists kitting_job_consumed_line_items_delete on public.kitting_job_consumed_line_items;
create policy kitting_job_consumed_line_items_select on public.kitting_job_consumed_line_items
  for select to authenticated
  using ((org_id = (select current_org_id())));
create policy kitting_job_consumed_line_items_insert on public.kitting_job_consumed_line_items
  for insert to authenticated
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))));
create policy kitting_job_consumed_line_items_update on public.kitting_job_consumed_line_items
  for update to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))))
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))));
create policy kitting_job_consumed_line_items_delete on public.kitting_job_consumed_line_items
  for delete to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))));

-- kitting_job_produced_line_items
drop policy if exists kitting_job_produced_line_items_select on public.kitting_job_produced_line_items;
drop policy if exists kitting_job_produced_line_items_write on public.kitting_job_produced_line_items;
drop policy if exists kitting_job_produced_line_items_insert on public.kitting_job_produced_line_items;
drop policy if exists kitting_job_produced_line_items_update on public.kitting_job_produced_line_items;
drop policy if exists kitting_job_produced_line_items_delete on public.kitting_job_produced_line_items;
create policy kitting_job_produced_line_items_select on public.kitting_job_produced_line_items
  for select to authenticated
  using ((org_id = (select current_org_id())));
create policy kitting_job_produced_line_items_insert on public.kitting_job_produced_line_items
  for insert to authenticated
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))));
create policy kitting_job_produced_line_items_update on public.kitting_job_produced_line_items
  for update to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))))
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))));
create policy kitting_job_produced_line_items_delete on public.kitting_job_produced_line_items
  for delete to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))));

-- kitting_jobs
drop policy if exists kitting_jobs_select on public.kitting_jobs;
drop policy if exists kitting_jobs_write on public.kitting_jobs;
drop policy if exists kitting_jobs_insert on public.kitting_jobs;
drop policy if exists kitting_jobs_update on public.kitting_jobs;
drop policy if exists kitting_jobs_delete on public.kitting_jobs;
create policy kitting_jobs_select on public.kitting_jobs
  for select to authenticated
  using ((org_id = (select current_org_id())));
create policy kitting_jobs_insert on public.kitting_jobs
  for insert to authenticated
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))));
create policy kitting_jobs_update on public.kitting_jobs
  for update to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))))
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))));
create policy kitting_jobs_delete on public.kitting_jobs
  for delete to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))));

-- leads
drop policy if exists leads_select on public.leads;
drop policy if exists leads_write on public.leads;
drop policy if exists leads_insert on public.leads;
drop policy if exists leads_update on public.leads;
drop policy if exists leads_delete on public.leads;
create policy leads_select on public.leads
  for select to authenticated
  using ((org_id = (select current_org_id())));
create policy leads_insert on public.leads
  for insert to authenticated
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'sales'::text]))));
create policy leads_update on public.leads
  for update to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'sales'::text]))))
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'sales'::text]))));
create policy leads_delete on public.leads
  for delete to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'sales'::text]))));

-- lots
drop policy if exists lots_select on public.lots;
drop policy if exists lots_write on public.lots;
drop policy if exists lots_insert on public.lots;
drop policy if exists lots_update on public.lots;
drop policy if exists lots_delete on public.lots;
create policy lots_select on public.lots
  for select to authenticated
  using ((org_id = (select current_org_id())));
create policy lots_insert on public.lots
  for insert to authenticated
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))));
create policy lots_update on public.lots
  for update to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))))
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))));
create policy lots_delete on public.lots
  for delete to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))));

-- manufacturing_run_consumed_line_items
drop policy if exists manufacturing_run_consumed_line_items_select on public.manufacturing_run_consumed_line_items;
drop policy if exists manufacturing_run_consumed_line_items_write on public.manufacturing_run_consumed_line_items;
drop policy if exists manufacturing_run_consumed_line_items_insert on public.manufacturing_run_consumed_line_items;
drop policy if exists manufacturing_run_consumed_line_items_update on public.manufacturing_run_consumed_line_items;
drop policy if exists manufacturing_run_consumed_line_items_delete on public.manufacturing_run_consumed_line_items;
create policy manufacturing_run_consumed_line_items_select on public.manufacturing_run_consumed_line_items
  for select to authenticated
  using ((org_id = (select current_org_id())));
create policy manufacturing_run_consumed_line_items_insert on public.manufacturing_run_consumed_line_items
  for insert to authenticated
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))));
create policy manufacturing_run_consumed_line_items_update on public.manufacturing_run_consumed_line_items
  for update to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))))
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))));
create policy manufacturing_run_consumed_line_items_delete on public.manufacturing_run_consumed_line_items
  for delete to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))));

-- manufacturing_run_produced_line_items
drop policy if exists manufacturing_run_produced_line_items_select on public.manufacturing_run_produced_line_items;
drop policy if exists manufacturing_run_produced_line_items_write on public.manufacturing_run_produced_line_items;
drop policy if exists manufacturing_run_produced_line_items_insert on public.manufacturing_run_produced_line_items;
drop policy if exists manufacturing_run_produced_line_items_update on public.manufacturing_run_produced_line_items;
drop policy if exists manufacturing_run_produced_line_items_delete on public.manufacturing_run_produced_line_items;
create policy manufacturing_run_produced_line_items_select on public.manufacturing_run_produced_line_items
  for select to authenticated
  using ((org_id = (select current_org_id())));
create policy manufacturing_run_produced_line_items_insert on public.manufacturing_run_produced_line_items
  for insert to authenticated
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))));
create policy manufacturing_run_produced_line_items_update on public.manufacturing_run_produced_line_items
  for update to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))))
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))));
create policy manufacturing_run_produced_line_items_delete on public.manufacturing_run_produced_line_items
  for delete to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))));

-- manufacturing_runs
drop policy if exists manufacturing_runs_select on public.manufacturing_runs;
drop policy if exists manufacturing_runs_write on public.manufacturing_runs;
drop policy if exists manufacturing_runs_insert on public.manufacturing_runs;
drop policy if exists manufacturing_runs_update on public.manufacturing_runs;
drop policy if exists manufacturing_runs_delete on public.manufacturing_runs;
create policy manufacturing_runs_select on public.manufacturing_runs
  for select to authenticated
  using ((org_id = (select current_org_id())));
create policy manufacturing_runs_insert on public.manufacturing_runs
  for insert to authenticated
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))));
create policy manufacturing_runs_update on public.manufacturing_runs
  for update to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))))
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))));
create policy manufacturing_runs_delete on public.manufacturing_runs
  for delete to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))));

-- numbering_sequences
drop policy if exists numbering_sequences_select on public.numbering_sequences;
drop policy if exists numbering_sequences_write on public.numbering_sequences;
drop policy if exists numbering_sequences_insert on public.numbering_sequences;
drop policy if exists numbering_sequences_update on public.numbering_sequences;
drop policy if exists numbering_sequences_delete on public.numbering_sequences;
create policy numbering_sequences_select on public.numbering_sequences
  for select to authenticated
  using ((org_id = (select current_org_id())));
create policy numbering_sequences_insert on public.numbering_sequences
  for insert to authenticated
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text]))));
create policy numbering_sequences_update on public.numbering_sequences
  for update to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text]))))
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text]))));
create policy numbering_sequences_delete on public.numbering_sequences
  for delete to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text]))));

-- opportunities
drop policy if exists opportunities_select on public.opportunities;
drop policy if exists opportunities_write on public.opportunities;
drop policy if exists opportunities_insert on public.opportunities;
drop policy if exists opportunities_update on public.opportunities;
drop policy if exists opportunities_delete on public.opportunities;
create policy opportunities_select on public.opportunities
  for select to authenticated
  using ((org_id = (select current_org_id())));
create policy opportunities_insert on public.opportunities
  for insert to authenticated
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'sales'::text]))));
create policy opportunities_update on public.opportunities
  for update to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'sales'::text]))))
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'sales'::text]))));
create policy opportunities_delete on public.opportunities
  for delete to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'sales'::text]))));

-- org_branding
drop policy if exists org_branding_select on public.org_branding;
drop policy if exists org_branding_write on public.org_branding;
drop policy if exists org_branding_insert on public.org_branding;
drop policy if exists org_branding_update on public.org_branding;
drop policy if exists org_branding_delete on public.org_branding;
create policy org_branding_select on public.org_branding
  for select to authenticated
  using ((org_id = (select current_org_id())));
create policy org_branding_insert on public.org_branding
  for insert to authenticated
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text]))));
create policy org_branding_update on public.org_branding
  for update to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text]))))
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text]))));
create policy org_branding_delete on public.org_branding
  for delete to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text]))));

-- org_domains
drop policy if exists org_domains_select on public.org_domains;
drop policy if exists org_domains_write on public.org_domains;
drop policy if exists org_domains_insert on public.org_domains;
drop policy if exists org_domains_update on public.org_domains;
drop policy if exists org_domains_delete on public.org_domains;
create policy org_domains_select on public.org_domains
  for select to authenticated
  using ((org_id = (select current_org_id())));
create policy org_domains_insert on public.org_domains
  for insert to authenticated
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text]))));
create policy org_domains_update on public.org_domains
  for update to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text]))))
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text]))));
create policy org_domains_delete on public.org_domains
  for delete to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text]))));

-- org_feature_flags
drop policy if exists org_feature_flags_select on public.org_feature_flags;
drop policy if exists org_feature_flags_write on public.org_feature_flags;
drop policy if exists org_feature_flags_insert on public.org_feature_flags;
drop policy if exists org_feature_flags_update on public.org_feature_flags;
drop policy if exists org_feature_flags_delete on public.org_feature_flags;
create policy org_feature_flags_select on public.org_feature_flags
  for select to authenticated
  using ((org_id = (select current_org_id())));
create policy org_feature_flags_insert on public.org_feature_flags
  for insert to authenticated
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text]))));
create policy org_feature_flags_update on public.org_feature_flags
  for update to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text]))))
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text]))));
create policy org_feature_flags_delete on public.org_feature_flags
  for delete to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text]))));

-- org_memberships
drop policy if exists org_memberships_select on public.org_memberships;
drop policy if exists org_memberships_write on public.org_memberships;
drop policy if exists org_memberships_insert on public.org_memberships;
drop policy if exists org_memberships_update on public.org_memberships;
drop policy if exists org_memberships_delete on public.org_memberships;
create policy org_memberships_select on public.org_memberships
  for select to authenticated
  using ((org_id = (select current_org_id())));
create policy org_memberships_insert on public.org_memberships
  for insert to authenticated
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text]))));
create policy org_memberships_update on public.org_memberships
  for update to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text]))))
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text]))));
create policy org_memberships_delete on public.org_memberships
  for delete to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text]))));

-- org_settings
drop policy if exists org_settings_select on public.org_settings;
drop policy if exists org_settings_write on public.org_settings;
drop policy if exists org_settings_insert on public.org_settings;
drop policy if exists org_settings_update on public.org_settings;
drop policy if exists org_settings_delete on public.org_settings;
create policy org_settings_select on public.org_settings
  for select to authenticated
  using ((org_id = (select current_org_id())));
create policy org_settings_insert on public.org_settings
  for insert to authenticated
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text]))));
create policy org_settings_update on public.org_settings
  for update to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text]))))
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text]))));
create policy org_settings_delete on public.org_settings
  for delete to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text]))));

-- organizations
drop policy if exists organizations_select on public.organizations;
drop policy if exists organizations_write on public.organizations;
drop policy if exists organizations_insert on public.organizations;
drop policy if exists organizations_update on public.organizations;
drop policy if exists organizations_delete on public.organizations;
create policy organizations_select on public.organizations
  for select to authenticated
  using ((id = (select current_org_id())));
create policy organizations_insert on public.organizations
  for insert to authenticated
  with check (((id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text]))));
create policy organizations_update on public.organizations
  for update to authenticated
  using (((id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text]))))
  with check (((id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text]))));
create policy organizations_delete on public.organizations
  for delete to authenticated
  using (((id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text]))));

-- payment_allocations
drop policy if exists payment_allocations_select on public.payment_allocations;
drop policy if exists payment_allocations_write on public.payment_allocations;
drop policy if exists payment_allocations_insert on public.payment_allocations;
drop policy if exists payment_allocations_update on public.payment_allocations;
drop policy if exists payment_allocations_delete on public.payment_allocations;
create policy payment_allocations_select on public.payment_allocations
  for select to authenticated
  using ((EXISTS ( SELECT 1 FROM payments p WHERE ((p.id = payment_allocations.payment_id) AND (p.org_id = (select current_org_id()))))));
create policy payment_allocations_insert on public.payment_allocations
  for insert to authenticated
  with check ((EXISTS ( SELECT 1 FROM payments p WHERE ((p.id = payment_allocations.payment_id) AND (p.org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'accounting'::text]))))));
create policy payment_allocations_update on public.payment_allocations
  for update to authenticated
  using ((EXISTS ( SELECT 1 FROM payments p WHERE ((p.id = payment_allocations.payment_id) AND (p.org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'accounting'::text]))))))
  with check ((EXISTS ( SELECT 1 FROM payments p WHERE ((p.id = payment_allocations.payment_id) AND (p.org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'accounting'::text]))))));
create policy payment_allocations_delete on public.payment_allocations
  for delete to authenticated
  using ((EXISTS ( SELECT 1 FROM payments p WHERE ((p.id = payment_allocations.payment_id) AND (p.org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'accounting'::text]))))));

-- payment_methods
drop policy if exists payment_methods_select on public.payment_methods;
drop policy if exists payment_methods_write on public.payment_methods;
drop policy if exists payment_methods_insert on public.payment_methods;
drop policy if exists payment_methods_update on public.payment_methods;
drop policy if exists payment_methods_delete on public.payment_methods;
create policy payment_methods_select on public.payment_methods
  for select to authenticated
  using ((org_id = (select current_org_id())));
create policy payment_methods_insert on public.payment_methods
  for insert to authenticated
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'accounting'::text, 'sales'::text]))));
create policy payment_methods_update on public.payment_methods
  for update to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'accounting'::text, 'sales'::text]))))
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'accounting'::text, 'sales'::text]))));
create policy payment_methods_delete on public.payment_methods
  for delete to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'accounting'::text, 'sales'::text]))));

-- payments
drop policy if exists payments_select on public.payments;
drop policy if exists payments_write on public.payments;
drop policy if exists payments_insert on public.payments;
drop policy if exists payments_update on public.payments;
drop policy if exists payments_delete on public.payments;
create policy payments_select on public.payments
  for select to authenticated
  using ((org_id = (select current_org_id())));
create policy payments_insert on public.payments
  for insert to authenticated
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'accounting'::text]))));
create policy payments_update on public.payments
  for update to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'accounting'::text]))))
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'accounting'::text]))));
create policy payments_delete on public.payments
  for delete to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'accounting'::text]))));

-- period_close
drop policy if exists period_close_select on public.period_close;
drop policy if exists period_close_write on public.period_close;
drop policy if exists period_close_insert on public.period_close;
drop policy if exists period_close_update on public.period_close;
drop policy if exists period_close_delete on public.period_close;
create policy period_close_select on public.period_close
  for select to authenticated
  using ((org_id = (select current_org_id())));
create policy period_close_insert on public.period_close
  for insert to authenticated
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'accounting'::text]))));
create policy period_close_update on public.period_close
  for update to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'accounting'::text]))))
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'accounting'::text]))));
create policy period_close_delete on public.period_close
  for delete to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'accounting'::text]))));

-- po_line_items
drop policy if exists po_line_items_select on public.po_line_items;
drop policy if exists po_line_items_write on public.po_line_items;
drop policy if exists po_line_items_insert on public.po_line_items;
drop policy if exists po_line_items_update on public.po_line_items;
drop policy if exists po_line_items_delete on public.po_line_items;
create policy po_line_items_select on public.po_line_items
  for select to authenticated
  using ((EXISTS ( SELECT 1 FROM purchase_orders po WHERE ((po.id = po_line_items.purchase_order_id) AND (po.org_id = (select current_org_id()))))));
create policy po_line_items_insert on public.po_line_items
  for insert to authenticated
  with check ((EXISTS ( SELECT 1 FROM purchase_orders po WHERE ((po.id = po_line_items.purchase_order_id) AND (po.org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text, 'accounting'::text]))))));
create policy po_line_items_update on public.po_line_items
  for update to authenticated
  using ((EXISTS ( SELECT 1 FROM purchase_orders po WHERE ((po.id = po_line_items.purchase_order_id) AND (po.org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text, 'accounting'::text]))))))
  with check ((EXISTS ( SELECT 1 FROM purchase_orders po WHERE ((po.id = po_line_items.purchase_order_id) AND (po.org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text, 'accounting'::text]))))));
create policy po_line_items_delete on public.po_line_items
  for delete to authenticated
  using ((EXISTS ( SELECT 1 FROM purchase_orders po WHERE ((po.id = po_line_items.purchase_order_id) AND (po.org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text, 'accounting'::text]))))));

-- pricing_tiers
drop policy if exists pricing_tiers_select on public.pricing_tiers;
drop policy if exists pricing_tiers_write on public.pricing_tiers;
drop policy if exists pricing_tiers_insert on public.pricing_tiers;
drop policy if exists pricing_tiers_update on public.pricing_tiers;
drop policy if exists pricing_tiers_delete on public.pricing_tiers;
create policy pricing_tiers_select on public.pricing_tiers
  for select to authenticated
  using ((org_id = (select current_org_id())));
create policy pricing_tiers_insert on public.pricing_tiers
  for insert to authenticated
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'accounting'::text, 'sales'::text]))));
create policy pricing_tiers_update on public.pricing_tiers
  for update to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'accounting'::text, 'sales'::text]))))
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'accounting'::text, 'sales'::text]))));
create policy pricing_tiers_delete on public.pricing_tiers
  for delete to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'accounting'::text, 'sales'::text]))));

-- production_runs
drop policy if exists production_runs_select on public.production_runs;
drop policy if exists production_runs_write on public.production_runs;
drop policy if exists production_runs_insert on public.production_runs;
drop policy if exists production_runs_update on public.production_runs;
drop policy if exists production_runs_delete on public.production_runs;
create policy production_runs_select on public.production_runs
  for select to authenticated
  using ((org_id = (select current_org_id())));
create policy production_runs_insert on public.production_runs
  for insert to authenticated
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))));
create policy production_runs_update on public.production_runs
  for update to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))))
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))));
create policy production_runs_delete on public.production_runs
  for delete to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))));

-- project_line_items
drop policy if exists project_line_items_select on public.project_line_items;
drop policy if exists project_line_items_write on public.project_line_items;
drop policy if exists project_line_items_insert on public.project_line_items;
drop policy if exists project_line_items_update on public.project_line_items;
drop policy if exists project_line_items_delete on public.project_line_items;
create policy project_line_items_select on public.project_line_items
  for select to authenticated
  using ((org_id = (select current_org_id())));
create policy project_line_items_insert on public.project_line_items
  for insert to authenticated
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'sales'::text, 'ops'::text, 'accounting'::text]))));
create policy project_line_items_update on public.project_line_items
  for update to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'sales'::text, 'ops'::text, 'accounting'::text]))))
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'sales'::text, 'ops'::text, 'accounting'::text]))));
create policy project_line_items_delete on public.project_line_items
  for delete to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'sales'::text, 'ops'::text, 'accounting'::text]))));

-- project_phases
drop policy if exists project_phases_select on public.project_phases;
drop policy if exists project_phases_write on public.project_phases;
drop policy if exists project_phases_insert on public.project_phases;
drop policy if exists project_phases_update on public.project_phases;
drop policy if exists project_phases_delete on public.project_phases;
create policy project_phases_select on public.project_phases
  for select to authenticated
  using ((EXISTS ( SELECT 1 FROM projects p WHERE ((p.id = project_phases.project_id) AND (p.org_id = (select current_org_id()))))));
create policy project_phases_insert on public.project_phases
  for insert to authenticated
  with check ((EXISTS ( SELECT 1 FROM projects p WHERE ((p.id = project_phases.project_id) AND (p.org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'sales'::text, 'ops'::text, 'accounting'::text]))))));
create policy project_phases_update on public.project_phases
  for update to authenticated
  using ((EXISTS ( SELECT 1 FROM projects p WHERE ((p.id = project_phases.project_id) AND (p.org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'sales'::text, 'ops'::text, 'accounting'::text]))))))
  with check ((EXISTS ( SELECT 1 FROM projects p WHERE ((p.id = project_phases.project_id) AND (p.org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'sales'::text, 'ops'::text, 'accounting'::text]))))));
create policy project_phases_delete on public.project_phases
  for delete to authenticated
  using ((EXISTS ( SELECT 1 FROM projects p WHERE ((p.id = project_phases.project_id) AND (p.org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'sales'::text, 'ops'::text, 'accounting'::text]))))));

-- projects
drop policy if exists projects_select on public.projects;
drop policy if exists projects_write on public.projects;
drop policy if exists projects_insert on public.projects;
drop policy if exists projects_update on public.projects;
drop policy if exists projects_delete on public.projects;
create policy projects_select on public.projects
  for select to authenticated
  using ((org_id = (select current_org_id())));
create policy projects_insert on public.projects
  for insert to authenticated
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'sales'::text, 'ops'::text, 'accounting'::text]))));
create policy projects_update on public.projects
  for update to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'sales'::text, 'ops'::text, 'accounting'::text]))))
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'sales'::text, 'ops'::text, 'accounting'::text]))));
create policy projects_delete on public.projects
  for delete to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'sales'::text, 'ops'::text, 'accounting'::text]))));

-- purchase_orders
drop policy if exists purchase_orders_select on public.purchase_orders;
drop policy if exists purchase_orders_write on public.purchase_orders;
drop policy if exists purchase_orders_insert on public.purchase_orders;
drop policy if exists purchase_orders_update on public.purchase_orders;
drop policy if exists purchase_orders_delete on public.purchase_orders;
create policy purchase_orders_select on public.purchase_orders
  for select to authenticated
  using ((org_id = (select current_org_id())));
create policy purchase_orders_insert on public.purchase_orders
  for insert to authenticated
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text, 'accounting'::text]))));
create policy purchase_orders_update on public.purchase_orders
  for update to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text, 'accounting'::text]))))
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text, 'accounting'::text]))));
create policy purchase_orders_delete on public.purchase_orders
  for delete to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text, 'accounting'::text]))));

-- putaway_tasks
drop policy if exists putaway_tasks_select on public.putaway_tasks;
drop policy if exists putaway_tasks_write on public.putaway_tasks;
drop policy if exists putaway_tasks_insert on public.putaway_tasks;
drop policy if exists putaway_tasks_update on public.putaway_tasks;
drop policy if exists putaway_tasks_delete on public.putaway_tasks;
create policy putaway_tasks_select on public.putaway_tasks
  for select to authenticated
  using ((org_id = (select current_org_id())));
create policy putaway_tasks_insert on public.putaway_tasks
  for insert to authenticated
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))));
create policy putaway_tasks_update on public.putaway_tasks
  for update to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))))
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))));
create policy putaway_tasks_delete on public.putaway_tasks
  for delete to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))));

-- quote_approvals
drop policy if exists quote_approvals_select on public.quote_approvals;
drop policy if exists quote_approvals_write on public.quote_approvals;
drop policy if exists quote_approvals_insert on public.quote_approvals;
drop policy if exists quote_approvals_update on public.quote_approvals;
drop policy if exists quote_approvals_delete on public.quote_approvals;
create policy quote_approvals_select on public.quote_approvals
  for select to authenticated
  using ((EXISTS ( SELECT 1 FROM quotes q WHERE ((q.id = quote_approvals.quote_id) AND (q.org_id = (select current_org_id()))))));
create policy quote_approvals_insert on public.quote_approvals
  for insert to authenticated
  with check ((EXISTS ( SELECT 1 FROM quotes q WHERE ((q.id = quote_approvals.quote_id) AND (q.org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'sales'::text, 'accounting'::text]))))));
create policy quote_approvals_update on public.quote_approvals
  for update to authenticated
  using ((EXISTS ( SELECT 1 FROM quotes q WHERE ((q.id = quote_approvals.quote_id) AND (q.org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'sales'::text, 'accounting'::text]))))))
  with check ((EXISTS ( SELECT 1 FROM quotes q WHERE ((q.id = quote_approvals.quote_id) AND (q.org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'sales'::text, 'accounting'::text]))))));
create policy quote_approvals_delete on public.quote_approvals
  for delete to authenticated
  using ((EXISTS ( SELECT 1 FROM quotes q WHERE ((q.id = quote_approvals.quote_id) AND (q.org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'sales'::text, 'accounting'::text]))))));

-- quote_line_items
drop policy if exists quote_line_items_select on public.quote_line_items;
drop policy if exists quote_line_items_write on public.quote_line_items;
drop policy if exists quote_line_items_insert on public.quote_line_items;
drop policy if exists quote_line_items_update on public.quote_line_items;
drop policy if exists quote_line_items_delete on public.quote_line_items;
create policy quote_line_items_select on public.quote_line_items
  for select to authenticated
  using ((EXISTS ( SELECT 1 FROM quotes q WHERE ((q.id = quote_line_items.quote_id) AND (q.org_id = (select current_org_id()))))));
create policy quote_line_items_insert on public.quote_line_items
  for insert to authenticated
  with check ((EXISTS ( SELECT 1 FROM quotes q WHERE ((q.id = quote_line_items.quote_id) AND (q.org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'sales'::text, 'accounting'::text]))))));
create policy quote_line_items_update on public.quote_line_items
  for update to authenticated
  using ((EXISTS ( SELECT 1 FROM quotes q WHERE ((q.id = quote_line_items.quote_id) AND (q.org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'sales'::text, 'accounting'::text]))))))
  with check ((EXISTS ( SELECT 1 FROM quotes q WHERE ((q.id = quote_line_items.quote_id) AND (q.org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'sales'::text, 'accounting'::text]))))));
create policy quote_line_items_delete on public.quote_line_items
  for delete to authenticated
  using ((EXISTS ( SELECT 1 FROM quotes q WHERE ((q.id = quote_line_items.quote_id) AND (q.org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'sales'::text, 'accounting'::text]))))));

-- quote_templates
drop policy if exists quote_templates_select on public.quote_templates;
drop policy if exists quote_templates_write on public.quote_templates;
drop policy if exists quote_templates_insert on public.quote_templates;
drop policy if exists quote_templates_update on public.quote_templates;
drop policy if exists quote_templates_delete on public.quote_templates;
create policy quote_templates_select on public.quote_templates
  for select to authenticated
  using ((org_id = (select current_org_id())));
create policy quote_templates_insert on public.quote_templates
  for insert to authenticated
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'sales'::text, 'accounting'::text]))));
create policy quote_templates_update on public.quote_templates
  for update to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'sales'::text, 'accounting'::text]))))
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'sales'::text, 'accounting'::text]))));
create policy quote_templates_delete on public.quote_templates
  for delete to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'sales'::text, 'accounting'::text]))));

-- quotes
drop policy if exists quotes_select on public.quotes;
drop policy if exists quotes_write on public.quotes;
drop policy if exists quotes_insert on public.quotes;
drop policy if exists quotes_update on public.quotes;
drop policy if exists quotes_delete on public.quotes;
create policy quotes_select on public.quotes
  for select to authenticated
  using ((org_id = (select current_org_id())));
create policy quotes_insert on public.quotes
  for insert to authenticated
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'sales'::text, 'accounting'::text]))));
create policy quotes_update on public.quotes
  for update to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'sales'::text, 'accounting'::text]))))
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'sales'::text, 'accounting'::text]))));
create policy quotes_delete on public.quotes
  for delete to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'sales'::text, 'accounting'::text]))));

-- receiving_order_line_items
drop policy if exists receiving_order_line_items_select on public.receiving_order_line_items;
drop policy if exists receiving_order_line_items_write on public.receiving_order_line_items;
drop policy if exists receiving_order_line_items_insert on public.receiving_order_line_items;
drop policy if exists receiving_order_line_items_update on public.receiving_order_line_items;
drop policy if exists receiving_order_line_items_delete on public.receiving_order_line_items;
create policy receiving_order_line_items_select on public.receiving_order_line_items
  for select to authenticated
  using ((org_id = (select current_org_id())));
create policy receiving_order_line_items_insert on public.receiving_order_line_items
  for insert to authenticated
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))));
create policy receiving_order_line_items_update on public.receiving_order_line_items
  for update to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))))
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))));
create policy receiving_order_line_items_delete on public.receiving_order_line_items
  for delete to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))));

-- receiving_orders
drop policy if exists receiving_orders_select on public.receiving_orders;
drop policy if exists receiving_orders_write on public.receiving_orders;
drop policy if exists receiving_orders_insert on public.receiving_orders;
drop policy if exists receiving_orders_update on public.receiving_orders;
drop policy if exists receiving_orders_delete on public.receiving_orders;
create policy receiving_orders_select on public.receiving_orders
  for select to authenticated
  using ((org_id = (select current_org_id())));
create policy receiving_orders_insert on public.receiving_orders
  for insert to authenticated
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))));
create policy receiving_orders_update on public.receiving_orders
  for update to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))))
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))));
create policy receiving_orders_delete on public.receiving_orders
  for delete to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))));

-- sales_channels
drop policy if exists sales_channels_select on public.sales_channels;
drop policy if exists sales_channels_write on public.sales_channels;
drop policy if exists sales_channels_insert on public.sales_channels;
drop policy if exists sales_channels_update on public.sales_channels;
drop policy if exists sales_channels_delete on public.sales_channels;
create policy sales_channels_select on public.sales_channels
  for select to authenticated
  using ((org_id = (select current_org_id())));
create policy sales_channels_insert on public.sales_channels
  for insert to authenticated
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text, 'sales'::text]))));
create policy sales_channels_update on public.sales_channels
  for update to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text, 'sales'::text]))))
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text, 'sales'::text]))));
create policy sales_channels_delete on public.sales_channels
  for delete to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text, 'sales'::text]))));

-- sales_order_line_items
drop policy if exists sales_order_line_items_select on public.sales_order_line_items;
drop policy if exists sales_order_line_items_write on public.sales_order_line_items;
drop policy if exists sales_order_line_items_insert on public.sales_order_line_items;
drop policy if exists sales_order_line_items_update on public.sales_order_line_items;
drop policy if exists sales_order_line_items_delete on public.sales_order_line_items;
create policy sales_order_line_items_select on public.sales_order_line_items
  for select to authenticated
  using ((org_id = (select current_org_id())));
create policy sales_order_line_items_insert on public.sales_order_line_items
  for insert to authenticated
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text, 'sales'::text]))));
create policy sales_order_line_items_update on public.sales_order_line_items
  for update to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text, 'sales'::text]))))
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text, 'sales'::text]))));
create policy sales_order_line_items_delete on public.sales_order_line_items
  for delete to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text, 'sales'::text]))));

-- sales_orders
drop policy if exists sales_orders_select on public.sales_orders;
drop policy if exists sales_orders_write on public.sales_orders;
drop policy if exists sales_orders_insert on public.sales_orders;
drop policy if exists sales_orders_update on public.sales_orders;
drop policy if exists sales_orders_delete on public.sales_orders;
create policy sales_orders_select on public.sales_orders
  for select to authenticated
  using ((org_id = (select current_org_id())));
create policy sales_orders_insert on public.sales_orders
  for insert to authenticated
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text, 'sales'::text]))));
create policy sales_orders_update on public.sales_orders
  for update to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text, 'sales'::text]))))
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text, 'sales'::text]))));
create policy sales_orders_delete on public.sales_orders
  for delete to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text, 'sales'::text]))));

-- saml_configs
drop policy if exists saml_configs_select on public.saml_configs;
drop policy if exists saml_configs_write on public.saml_configs;
drop policy if exists saml_configs_insert on public.saml_configs;
drop policy if exists saml_configs_update on public.saml_configs;
drop policy if exists saml_configs_delete on public.saml_configs;
create policy saml_configs_select on public.saml_configs
  for select to authenticated
  using ((EXISTS ( SELECT 1 FROM sso_connections sc WHERE ((sc.id = saml_configs.sso_connection_id) AND (sc.org_id = (select current_org_id()))))));
create policy saml_configs_insert on public.saml_configs
  for insert to authenticated
  with check ((EXISTS ( SELECT 1 FROM sso_connections sc WHERE ((sc.id = saml_configs.sso_connection_id) AND (sc.org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text]))))));
create policy saml_configs_update on public.saml_configs
  for update to authenticated
  using ((EXISTS ( SELECT 1 FROM sso_connections sc WHERE ((sc.id = saml_configs.sso_connection_id) AND (sc.org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text]))))))
  with check ((EXISTS ( SELECT 1 FROM sso_connections sc WHERE ((sc.id = saml_configs.sso_connection_id) AND (sc.org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text]))))));
create policy saml_configs_delete on public.saml_configs
  for delete to authenticated
  using ((EXISTS ( SELECT 1 FROM sso_connections sc WHERE ((sc.id = saml_configs.sso_connection_id) AND (sc.org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text]))))));

-- saved_views
drop policy if exists saved_views_select on public.saved_views;
drop policy if exists saved_views_write on public.saved_views;
drop policy if exists saved_views_insert on public.saved_views;
drop policy if exists saved_views_update on public.saved_views;
drop policy if exists saved_views_delete on public.saved_views;
create policy saved_views_select on public.saved_views
  for select to authenticated
  using (((org_id = (select current_org_id())) AND ((owner_user_id = (select auth.uid())) OR (is_shared = true))));
create policy saved_views_insert on public.saved_views
  for insert to authenticated
  with check (((org_id = (select current_org_id())) AND (owner_user_id = (select auth.uid()))));
create policy saved_views_update on public.saved_views
  for update to authenticated
  using (((org_id = (select current_org_id())) AND (owner_user_id = (select auth.uid()))))
  with check (((org_id = (select current_org_id())) AND (owner_user_id = (select auth.uid()))));
create policy saved_views_delete on public.saved_views
  for delete to authenticated
  using (((org_id = (select current_org_id())) AND (owner_user_id = (select auth.uid()))));

-- shifts
drop policy if exists shifts_select on public.shifts;
drop policy if exists shifts_write on public.shifts;
drop policy if exists shifts_insert on public.shifts;
drop policy if exists shifts_update on public.shifts;
drop policy if exists shifts_delete on public.shifts;
create policy shifts_select on public.shifts
  for select to authenticated
  using ((org_id = (select current_org_id())));
create policy shifts_insert on public.shifts
  for insert to authenticated
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))));
create policy shifts_update on public.shifts
  for update to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))))
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))));
create policy shifts_delete on public.shifts
  for delete to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))));

-- shipment_line_items
drop policy if exists shipment_line_items_select on public.shipment_line_items;
drop policy if exists shipment_line_items_write on public.shipment_line_items;
drop policy if exists shipment_line_items_insert on public.shipment_line_items;
drop policy if exists shipment_line_items_update on public.shipment_line_items;
drop policy if exists shipment_line_items_delete on public.shipment_line_items;
create policy shipment_line_items_select on public.shipment_line_items
  for select to authenticated
  using ((org_id = (select current_org_id())));
create policy shipment_line_items_insert on public.shipment_line_items
  for insert to authenticated
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))));
create policy shipment_line_items_update on public.shipment_line_items
  for update to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))))
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))));
create policy shipment_line_items_delete on public.shipment_line_items
  for delete to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))));

-- shipments
drop policy if exists shipments_select on public.shipments;
drop policy if exists shipments_write on public.shipments;
drop policy if exists shipments_insert on public.shipments;
drop policy if exists shipments_update on public.shipments;
drop policy if exists shipments_delete on public.shipments;
create policy shipments_select on public.shipments
  for select to authenticated
  using ((org_id = (select current_org_id())));
create policy shipments_insert on public.shipments
  for insert to authenticated
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))));
create policy shipments_update on public.shipments
  for update to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))))
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))));
create policy shipments_delete on public.shipments
  for delete to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))));

-- sso_connections
drop policy if exists sso_connections_select on public.sso_connections;
drop policy if exists sso_connections_write on public.sso_connections;
drop policy if exists sso_connections_insert on public.sso_connections;
drop policy if exists sso_connections_update on public.sso_connections;
drop policy if exists sso_connections_delete on public.sso_connections;
create policy sso_connections_select on public.sso_connections
  for select to authenticated
  using ((org_id = (select current_org_id())));
create policy sso_connections_insert on public.sso_connections
  for insert to authenticated
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text]))));
create policy sso_connections_update on public.sso_connections
  for update to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text]))))
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text]))));
create policy sso_connections_delete on public.sso_connections
  for delete to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text]))));

-- supply_plan_lines
drop policy if exists supply_plan_lines_select on public.supply_plan_lines;
drop policy if exists supply_plan_lines_write on public.supply_plan_lines;
drop policy if exists supply_plan_lines_insert on public.supply_plan_lines;
drop policy if exists supply_plan_lines_update on public.supply_plan_lines;
drop policy if exists supply_plan_lines_delete on public.supply_plan_lines;
create policy supply_plan_lines_select on public.supply_plan_lines
  for select to authenticated
  using ((org_id = (select current_org_id())));
create policy supply_plan_lines_insert on public.supply_plan_lines
  for insert to authenticated
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text, 'sales'::text]))));
create policy supply_plan_lines_update on public.supply_plan_lines
  for update to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text, 'sales'::text]))))
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text, 'sales'::text]))));
create policy supply_plan_lines_delete on public.supply_plan_lines
  for delete to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text, 'sales'::text]))));

-- supply_plans
drop policy if exists supply_plans_select on public.supply_plans;
drop policy if exists supply_plans_write on public.supply_plans;
drop policy if exists supply_plans_insert on public.supply_plans;
drop policy if exists supply_plans_update on public.supply_plans;
drop policy if exists supply_plans_delete on public.supply_plans;
create policy supply_plans_select on public.supply_plans
  for select to authenticated
  using ((org_id = (select current_org_id())));
create policy supply_plans_insert on public.supply_plans
  for insert to authenticated
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text, 'sales'::text]))));
create policy supply_plans_update on public.supply_plans
  for update to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text, 'sales'::text]))))
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text, 'sales'::text]))));
create policy supply_plans_delete on public.supply_plans
  for delete to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text, 'sales'::text]))));

-- taxes
drop policy if exists taxes_select on public.taxes;
drop policy if exists taxes_write on public.taxes;
drop policy if exists taxes_insert on public.taxes;
drop policy if exists taxes_update on public.taxes;
drop policy if exists taxes_delete on public.taxes;
create policy taxes_select on public.taxes
  for select to authenticated
  using ((org_id = (select current_org_id())));
create policy taxes_insert on public.taxes
  for insert to authenticated
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'accounting'::text, 'sales'::text]))));
create policy taxes_update on public.taxes
  for update to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'accounting'::text, 'sales'::text]))))
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'accounting'::text, 'sales'::text]))));
create policy taxes_delete on public.taxes
  for delete to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'accounting'::text, 'sales'::text]))));

-- three_pl_accounts
drop policy if exists three_pl_accounts_select on public.three_pl_accounts;
drop policy if exists three_pl_accounts_write on public.three_pl_accounts;
drop policy if exists three_pl_accounts_insert on public.three_pl_accounts;
drop policy if exists three_pl_accounts_update on public.three_pl_accounts;
drop policy if exists three_pl_accounts_delete on public.three_pl_accounts;
create policy three_pl_accounts_select on public.three_pl_accounts
  for select to authenticated
  using ((org_id = (select current_org_id())));
create policy three_pl_accounts_insert on public.three_pl_accounts
  for insert to authenticated
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text, 'sales'::text]))));
create policy three_pl_accounts_update on public.three_pl_accounts
  for update to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text, 'sales'::text]))))
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text, 'sales'::text]))));
create policy three_pl_accounts_delete on public.three_pl_accounts
  for delete to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text, 'sales'::text]))));

-- time_entries
drop policy if exists time_entries_select on public.time_entries;
drop policy if exists time_entries_write on public.time_entries;
drop policy if exists time_entries_insert on public.time_entries;
drop policy if exists time_entries_update on public.time_entries;
drop policy if exists time_entries_delete on public.time_entries;
create policy time_entries_select on public.time_entries
  for select to authenticated
  using ((org_id = (select current_org_id())));
create policy time_entries_insert on public.time_entries
  for insert to authenticated
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))));
create policy time_entries_update on public.time_entries
  for update to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))))
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))));
create policy time_entries_delete on public.time_entries
  for delete to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))));

-- units
drop policy if exists units_select on public.units;
drop policy if exists units_write on public.units;
drop policy if exists units_insert on public.units;
drop policy if exists units_update on public.units;
drop policy if exists units_delete on public.units;
create policy units_select on public.units
  for select to authenticated
  using ((org_id = (select current_org_id())));
create policy units_insert on public.units
  for insert to authenticated
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'sales'::text, 'ops'::text]))));
create policy units_update on public.units
  for update to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'sales'::text, 'ops'::text]))))
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'sales'::text, 'ops'::text]))));
create policy units_delete on public.units
  for delete to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'sales'::text, 'ops'::text]))));

-- value_added_services
drop policy if exists value_added_services_select on public.value_added_services;
drop policy if exists value_added_services_write on public.value_added_services;
drop policy if exists value_added_services_insert on public.value_added_services;
drop policy if exists value_added_services_update on public.value_added_services;
drop policy if exists value_added_services_delete on public.value_added_services;
create policy value_added_services_select on public.value_added_services
  for select to authenticated
  using ((org_id = (select current_org_id())));
create policy value_added_services_insert on public.value_added_services
  for insert to authenticated
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'sales'::text, 'ops'::text]))));
create policy value_added_services_update on public.value_added_services
  for update to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'sales'::text, 'ops'::text]))))
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'sales'::text, 'ops'::text]))));
create policy value_added_services_delete on public.value_added_services
  for delete to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'sales'::text, 'ops'::text]))));

-- vendor_bill_payments
drop policy if exists vendor_bill_payments_select on public.vendor_bill_payments;
drop policy if exists vendor_bill_payments_write on public.vendor_bill_payments;
drop policy if exists vendor_bill_payments_insert on public.vendor_bill_payments;
drop policy if exists vendor_bill_payments_update on public.vendor_bill_payments;
drop policy if exists vendor_bill_payments_delete on public.vendor_bill_payments;
create policy vendor_bill_payments_select on public.vendor_bill_payments
  for select to authenticated
  using ((EXISTS ( SELECT 1 FROM vendor_bills vb WHERE ((vb.id = vendor_bill_payments.vendor_bill_id) AND (vb.org_id = (select current_org_id()))))));
create policy vendor_bill_payments_insert on public.vendor_bill_payments
  for insert to authenticated
  with check ((EXISTS ( SELECT 1 FROM vendor_bills vb WHERE ((vb.id = vendor_bill_payments.vendor_bill_id) AND (vb.org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'accounting'::text]))))));
create policy vendor_bill_payments_update on public.vendor_bill_payments
  for update to authenticated
  using ((EXISTS ( SELECT 1 FROM vendor_bills vb WHERE ((vb.id = vendor_bill_payments.vendor_bill_id) AND (vb.org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'accounting'::text]))))))
  with check ((EXISTS ( SELECT 1 FROM vendor_bills vb WHERE ((vb.id = vendor_bill_payments.vendor_bill_id) AND (vb.org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'accounting'::text]))))));
create policy vendor_bill_payments_delete on public.vendor_bill_payments
  for delete to authenticated
  using ((EXISTS ( SELECT 1 FROM vendor_bills vb WHERE ((vb.id = vendor_bill_payments.vendor_bill_id) AND (vb.org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'accounting'::text]))))));

-- vendor_bills
drop policy if exists vendor_bills_select on public.vendor_bills;
drop policy if exists vendor_bills_write on public.vendor_bills;
drop policy if exists vendor_bills_insert on public.vendor_bills;
drop policy if exists vendor_bills_update on public.vendor_bills;
drop policy if exists vendor_bills_delete on public.vendor_bills;
create policy vendor_bills_select on public.vendor_bills
  for select to authenticated
  using ((org_id = (select current_org_id())));
create policy vendor_bills_insert on public.vendor_bills
  for insert to authenticated
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'accounting'::text]))));
create policy vendor_bills_update on public.vendor_bills
  for update to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'accounting'::text]))))
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'accounting'::text]))));
create policy vendor_bills_delete on public.vendor_bills
  for delete to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'accounting'::text]))));

-- vendors
drop policy if exists vendors_select on public.vendors;
drop policy if exists vendors_write on public.vendors;
drop policy if exists vendors_insert on public.vendors;
drop policy if exists vendors_update on public.vendors;
drop policy if exists vendors_delete on public.vendors;
create policy vendors_select on public.vendors
  for select to authenticated
  using ((org_id = (select current_org_id())));
create policy vendors_insert on public.vendors
  for insert to authenticated
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text, 'accounting'::text]))));
create policy vendors_update on public.vendors
  for update to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text, 'accounting'::text]))))
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text, 'accounting'::text]))));
create policy vendors_delete on public.vendors
  for delete to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text, 'accounting'::text]))));

-- warehouse_locations
drop policy if exists warehouse_locations_select on public.warehouse_locations;
drop policy if exists warehouse_locations_write on public.warehouse_locations;
drop policy if exists warehouse_locations_insert on public.warehouse_locations;
drop policy if exists warehouse_locations_update on public.warehouse_locations;
drop policy if exists warehouse_locations_delete on public.warehouse_locations;
create policy warehouse_locations_select on public.warehouse_locations
  for select to authenticated
  using ((org_id = (select current_org_id())));
create policy warehouse_locations_insert on public.warehouse_locations
  for insert to authenticated
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))));
create policy warehouse_locations_update on public.warehouse_locations
  for update to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))))
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))));
create policy warehouse_locations_delete on public.warehouse_locations
  for delete to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))));

-- warehouses
drop policy if exists warehouses_select on public.warehouses;
drop policy if exists warehouses_write on public.warehouses;
drop policy if exists warehouses_insert on public.warehouses;
drop policy if exists warehouses_update on public.warehouses;
drop policy if exists warehouses_delete on public.warehouses;
create policy warehouses_select on public.warehouses
  for select to authenticated
  using ((org_id = (select current_org_id())));
create policy warehouses_insert on public.warehouses
  for insert to authenticated
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))));
create policy warehouses_update on public.warehouses
  for update to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))))
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))));
create policy warehouses_delete on public.warehouses
  for delete to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))));

-- work_assignments
drop policy if exists work_assignments_select on public.work_assignments;
drop policy if exists work_assignments_write on public.work_assignments;
drop policy if exists work_assignments_insert on public.work_assignments;
drop policy if exists work_assignments_update on public.work_assignments;
drop policy if exists work_assignments_delete on public.work_assignments;
create policy work_assignments_select on public.work_assignments
  for select to authenticated
  using ((org_id = (select current_org_id())));
create policy work_assignments_insert on public.work_assignments
  for insert to authenticated
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))));
create policy work_assignments_update on public.work_assignments
  for update to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))))
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))));
create policy work_assignments_delete on public.work_assignments
  for delete to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))));

-- workforce_members
drop policy if exists workforce_members_select on public.workforce_members;
drop policy if exists workforce_members_write on public.workforce_members;
drop policy if exists workforce_members_insert on public.workforce_members;
drop policy if exists workforce_members_update on public.workforce_members;
drop policy if exists workforce_members_delete on public.workforce_members;
create policy workforce_members_select on public.workforce_members
  for select to authenticated
  using ((org_id = (select current_org_id())));
create policy workforce_members_insert on public.workforce_members
  for insert to authenticated
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))));
create policy workforce_members_update on public.workforce_members
  for update to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))))
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))));
create policy workforce_members_delete on public.workforce_members
  for delete to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))));

-- workforce_team_members
drop policy if exists workforce_team_members_select on public.workforce_team_members;
drop policy if exists workforce_team_members_write on public.workforce_team_members;
drop policy if exists workforce_team_members_insert on public.workforce_team_members;
drop policy if exists workforce_team_members_update on public.workforce_team_members;
drop policy if exists workforce_team_members_delete on public.workforce_team_members;
create policy workforce_team_members_select on public.workforce_team_members
  for select to authenticated
  using ((org_id = (select current_org_id())));
create policy workforce_team_members_insert on public.workforce_team_members
  for insert to authenticated
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))));
create policy workforce_team_members_update on public.workforce_team_members
  for update to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))))
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))));
create policy workforce_team_members_delete on public.workforce_team_members
  for delete to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))));

-- workforce_teams
drop policy if exists workforce_teams_select on public.workforce_teams;
drop policy if exists workforce_teams_write on public.workforce_teams;
drop policy if exists workforce_teams_insert on public.workforce_teams;
drop policy if exists workforce_teams_update on public.workforce_teams;
drop policy if exists workforce_teams_delete on public.workforce_teams;
create policy workforce_teams_select on public.workforce_teams
  for select to authenticated
  using ((org_id = (select current_org_id())));
create policy workforce_teams_insert on public.workforce_teams
  for insert to authenticated
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))));
create policy workforce_teams_update on public.workforce_teams
  for update to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))))
  with check (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))));
create policy workforce_teams_delete on public.workforce_teams
  for delete to authenticated
  using (((org_id = (select current_org_id())) AND ((select current_user_role()) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))));

-- ----------------------------------------------------------------------------
-- Part 2: rewrap initplan-only policies (auth_rls_initplan)
-- ----------------------------------------------------------------------------

-- idempotency_keys
drop policy if exists idempotency_keys_select on public.idempotency_keys;
create policy idempotency_keys_select on public.idempotency_keys
  for select to authenticated
  using (((org_id = (select current_org_id())) AND (user_id = (select auth.uid()))));

-- notifications
drop policy if exists notifications_self_select on public.notifications;
create policy notifications_self_select on public.notifications
  for select to authenticated
  using (((org_id = (select current_org_id())) AND (recipient_user_id = (select auth.uid()))));
drop policy if exists notifications_self_update on public.notifications;
create policy notifications_self_update on public.notifications
  for update to authenticated
  using (((org_id = (select current_org_id())) AND (recipient_user_id = (select auth.uid()))))
  with check (((org_id = (select current_org_id())) AND (recipient_user_id = (select auth.uid()))));

-- profiles
drop policy if exists profiles_self_select on public.profiles;
create policy profiles_self_select on public.profiles
  for select to authenticated
  using ((user_id = (select auth.uid())));
drop policy if exists profiles_self_update on public.profiles;
create policy profiles_self_update on public.profiles
  for update to authenticated
  using ((user_id = (select auth.uid())))
  with check ((user_id = (select auth.uid())));

-- ============================================================================
-- DOWN MIGRATION (operator-only). Restores the pre-0116 policy shapes verbatim.
-- Wrapped in a leading line comment marker so it is inert on apply; an operator
-- runs the statements below by hand to roll back.
-- ----------------------------------------------------------------------------
--
-- Part 1 rollback: drop the command-scoped policies, restore FOR ALL _write.

-- -- account_service_definitions
-- drop policy if exists account_service_definitions_select on public.account_service_definitions;
-- drop policy if exists account_service_definitions_insert on public.account_service_definitions;
-- drop policy if exists account_service_definitions_update on public.account_service_definitions;
-- drop policy if exists account_service_definitions_delete on public.account_service_definitions;
-- drop policy if exists account_service_definitions_write on public.account_service_definitions;
-- create policy account_service_definitions_select on public.account_service_definitions
--   for select to authenticated
--   using ((org_id = current_org_id()));
-- create policy account_service_definitions_write on public.account_service_definitions
--   for all to authenticated
--   using (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text, 'sales'::text]))))
--   with check (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text, 'sales'::text]))));
--
-- -- activities
-- drop policy if exists activities_select on public.activities;
-- drop policy if exists activities_insert on public.activities;
-- drop policy if exists activities_update on public.activities;
-- drop policy if exists activities_delete on public.activities;
-- drop policy if exists activities_write on public.activities;
-- create policy activities_select on public.activities
--   for select to authenticated
--   using ((org_id = current_org_id()));
-- create policy activities_write on public.activities
--   for all to authenticated
--   using (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'sales'::text, 'ops'::text]))))
--   with check (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'sales'::text, 'ops'::text]))));
--
-- -- attachments
-- drop policy if exists attachments_select on public.attachments;
-- drop policy if exists attachments_insert on public.attachments;
-- drop policy if exists attachments_update on public.attachments;
-- drop policy if exists attachments_delete on public.attachments;
-- drop policy if exists attachments_write on public.attachments;
-- create policy attachments_select on public.attachments
--   for select to authenticated
--   using ((org_id = current_org_id()));
-- create policy attachments_write on public.attachments
--   for all to authenticated
--   using (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'sales'::text, 'ops'::text, 'accounting'::text]))))
--   with check (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'sales'::text, 'ops'::text, 'accounting'::text]))));
--
-- -- billing_reviews
-- drop policy if exists billing_reviews_select on public.billing_reviews;
-- drop policy if exists billing_reviews_insert on public.billing_reviews;
-- drop policy if exists billing_reviews_update on public.billing_reviews;
-- drop policy if exists billing_reviews_delete on public.billing_reviews;
-- drop policy if exists billing_reviews_write on public.billing_reviews;
-- create policy billing_reviews_select on public.billing_reviews
--   for select to authenticated
--   using ((org_id = current_org_id()));
-- create policy billing_reviews_write on public.billing_reviews
--   for all to authenticated
--   using (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text, 'sales'::text, 'accounting'::text]))))
--   with check (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text, 'sales'::text, 'accounting'::text]))));
--
-- -- bom_items
-- drop policy if exists bom_items_select on public.bom_items;
-- drop policy if exists bom_items_insert on public.bom_items;
-- drop policy if exists bom_items_update on public.bom_items;
-- drop policy if exists bom_items_delete on public.bom_items;
-- drop policy if exists bom_items_write on public.bom_items;
-- create policy bom_items_select on public.bom_items
--   for select to authenticated
--   using ((org_id = current_org_id()));
-- create policy bom_items_write on public.bom_items
--   for all to authenticated
--   using (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))))
--   with check (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))));
--
-- -- chart_of_accounts
-- drop policy if exists chart_of_accounts_select on public.chart_of_accounts;
-- drop policy if exists chart_of_accounts_insert on public.chart_of_accounts;
-- drop policy if exists chart_of_accounts_update on public.chart_of_accounts;
-- drop policy if exists chart_of_accounts_delete on public.chart_of_accounts;
-- drop policy if exists chart_of_accounts_write on public.chart_of_accounts;
-- create policy chart_of_accounts_select on public.chart_of_accounts
--   for select to authenticated
--   using ((org_id = current_org_id()));
-- create policy chart_of_accounts_write on public.chart_of_accounts
--   for all to authenticated
--   using (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'accounting'::text]))))
--   with check (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'accounting'::text]))));
--
-- -- comments
-- drop policy if exists comments_select on public.comments;
-- drop policy if exists comments_insert on public.comments;
-- drop policy if exists comments_update on public.comments;
-- drop policy if exists comments_delete on public.comments;
-- drop policy if exists comments_write on public.comments;
-- create policy comments_select on public.comments
--   for select to authenticated
--   using ((org_id = current_org_id()));
-- create policy comments_write on public.comments
--   for all to authenticated
--   using (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'sales'::text, 'ops'::text, 'accounting'::text, 'viewer'::text]))))
--   with check (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'sales'::text, 'ops'::text, 'accounting'::text, 'viewer'::text]))));
--
-- -- contacts
-- drop policy if exists contacts_select on public.contacts;
-- drop policy if exists contacts_insert on public.contacts;
-- drop policy if exists contacts_update on public.contacts;
-- drop policy if exists contacts_delete on public.contacts;
-- drop policy if exists contacts_write on public.contacts;
-- create policy contacts_select on public.contacts
--   for select to authenticated
--   using ((org_id = ( SELECT current_org_id() AS current_org_id)));
-- create policy contacts_write on public.contacts
--   for all to authenticated
--   using (((org_id = ( SELECT current_org_id() AS current_org_id)) AND (( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'sales'::text, 'ops'::text]))))
--   with check (((org_id = ( SELECT current_org_id() AS current_org_id)) AND (( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'sales'::text, 'ops'::text]))));
--
-- -- credit_note_allocations
-- drop policy if exists credit_note_allocations_select on public.credit_note_allocations;
-- drop policy if exists credit_note_allocations_insert on public.credit_note_allocations;
-- drop policy if exists credit_note_allocations_update on public.credit_note_allocations;
-- drop policy if exists credit_note_allocations_delete on public.credit_note_allocations;
-- drop policy if exists credit_note_allocations_write on public.credit_note_allocations;
-- create policy credit_note_allocations_select on public.credit_note_allocations
--   for select to authenticated
--   using ((EXISTS ( SELECT 1 FROM credit_notes cn WHERE ((cn.id = credit_note_allocations.credit_note_id) AND (cn.org_id = current_org_id())))));
-- create policy credit_note_allocations_write on public.credit_note_allocations
--   for all to authenticated
--   using ((EXISTS ( SELECT 1 FROM credit_notes cn WHERE ((cn.id = credit_note_allocations.credit_note_id) AND (cn.org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'accounting'::text]))))))
--   with check ((EXISTS ( SELECT 1 FROM credit_notes cn WHERE ((cn.id = credit_note_allocations.credit_note_id) AND (cn.org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'accounting'::text]))))));
--
-- -- credit_notes
-- drop policy if exists credit_notes_select on public.credit_notes;
-- drop policy if exists credit_notes_insert on public.credit_notes;
-- drop policy if exists credit_notes_update on public.credit_notes;
-- drop policy if exists credit_notes_delete on public.credit_notes;
-- drop policy if exists credit_notes_write on public.credit_notes;
-- create policy credit_notes_select on public.credit_notes
--   for select to authenticated
--   using ((org_id = current_org_id()));
-- create policy credit_notes_write on public.credit_notes
--   for all to authenticated
--   using (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'accounting'::text]))))
--   with check (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'accounting'::text]))));
--
-- -- customer_pricing_overrides
-- drop policy if exists customer_pricing_overrides_select on public.customer_pricing_overrides;
-- drop policy if exists customer_pricing_overrides_insert on public.customer_pricing_overrides;
-- drop policy if exists customer_pricing_overrides_update on public.customer_pricing_overrides;
-- drop policy if exists customer_pricing_overrides_delete on public.customer_pricing_overrides;
-- drop policy if exists customer_pricing_overrides_write on public.customer_pricing_overrides;
-- create policy customer_pricing_overrides_select on public.customer_pricing_overrides
--   for select to authenticated
--   using ((org_id = current_org_id()));
-- create policy customer_pricing_overrides_write on public.customer_pricing_overrides
--   for all to authenticated
--   using (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'accounting'::text, 'sales'::text]))))
--   with check (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'accounting'::text, 'sales'::text]))));
--
-- -- customers
-- drop policy if exists customers_select on public.customers;
-- drop policy if exists customers_insert on public.customers;
-- drop policy if exists customers_update on public.customers;
-- drop policy if exists customers_delete on public.customers;
-- drop policy if exists customers_write on public.customers;
-- create policy customers_select on public.customers
--   for select to authenticated
--   using ((org_id = ( SELECT current_org_id() AS current_org_id)));
-- create policy customers_write on public.customers
--   for all to authenticated
--   using (((org_id = ( SELECT current_org_id() AS current_org_id)) AND (( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'sales'::text, 'ops'::text]))))
--   with check (((org_id = ( SELECT current_org_id() AS current_org_id)) AND (( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'sales'::text, 'ops'::text]))));
--
-- -- expense_categories
-- drop policy if exists expense_categories_select on public.expense_categories;
-- drop policy if exists expense_categories_insert on public.expense_categories;
-- drop policy if exists expense_categories_update on public.expense_categories;
-- drop policy if exists expense_categories_delete on public.expense_categories;
-- drop policy if exists expense_categories_write on public.expense_categories;
-- create policy expense_categories_select on public.expense_categories
--   for select to authenticated
--   using ((org_id = current_org_id()));
-- create policy expense_categories_write on public.expense_categories
--   for all to authenticated
--   using (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'accounting'::text]))))
--   with check (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'accounting'::text]))));
--
-- -- expenses
-- drop policy if exists expenses_select on public.expenses;
-- drop policy if exists expenses_insert on public.expenses;
-- drop policy if exists expenses_update on public.expenses;
-- drop policy if exists expenses_delete on public.expenses;
-- drop policy if exists expenses_write on public.expenses;
-- create policy expenses_select on public.expenses
--   for select to authenticated
--   using ((org_id = current_org_id()));
-- create policy expenses_write on public.expenses
--   for all to authenticated
--   using (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'accounting'::text, 'ops'::text]))))
--   with check (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'accounting'::text, 'ops'::text]))));
--
-- -- fulfillments
-- drop policy if exists fulfillments_select on public.fulfillments;
-- drop policy if exists fulfillments_insert on public.fulfillments;
-- drop policy if exists fulfillments_update on public.fulfillments;
-- drop policy if exists fulfillments_delete on public.fulfillments;
-- drop policy if exists fulfillments_write on public.fulfillments;
-- create policy fulfillments_select on public.fulfillments
--   for select to authenticated
--   using ((org_id = current_org_id()));
-- create policy fulfillments_write on public.fulfillments
--   for all to authenticated
--   using (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))))
--   with check (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))));
--
-- -- identity_providers
-- drop policy if exists identity_providers_select on public.identity_providers;
-- drop policy if exists identity_providers_insert on public.identity_providers;
-- drop policy if exists identity_providers_update on public.identity_providers;
-- drop policy if exists identity_providers_delete on public.identity_providers;
-- drop policy if exists identity_providers_write on public.identity_providers;
-- create policy identity_providers_select on public.identity_providers
--   for select to authenticated
--   using ((org_id = current_org_id()));
-- create policy identity_providers_write on public.identity_providers
--   for all to authenticated
--   using (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text]))))
--   with check (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text]))));
--
-- -- invoice_line_items
-- drop policy if exists invoice_line_items_select on public.invoice_line_items;
-- drop policy if exists invoice_line_items_insert on public.invoice_line_items;
-- drop policy if exists invoice_line_items_update on public.invoice_line_items;
-- drop policy if exists invoice_line_items_delete on public.invoice_line_items;
-- drop policy if exists invoice_line_items_write on public.invoice_line_items;
-- create policy invoice_line_items_select on public.invoice_line_items
--   for select to authenticated
--   using ((EXISTS ( SELECT 1 FROM invoices i WHERE ((i.id = invoice_line_items.invoice_id) AND (i.org_id = ( SELECT current_org_id() AS current_org_id))))));
-- create policy invoice_line_items_write on public.invoice_line_items
--   for all to authenticated
--   using ((EXISTS ( SELECT 1 FROM invoices i WHERE ((i.id = invoice_line_items.invoice_id) AND (i.org_id = ( SELECT current_org_id() AS current_org_id)) AND (( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'accounting'::text, 'sales'::text]))))))
--   with check ((EXISTS ( SELECT 1 FROM invoices i WHERE ((i.id = invoice_line_items.invoice_id) AND (i.org_id = ( SELECT current_org_id() AS current_org_id)) AND (( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'accounting'::text, 'sales'::text]))))));
--
-- -- invoices
-- drop policy if exists invoices_select on public.invoices;
-- drop policy if exists invoices_insert on public.invoices;
-- drop policy if exists invoices_update on public.invoices;
-- drop policy if exists invoices_delete on public.invoices;
-- drop policy if exists invoices_write on public.invoices;
-- create policy invoices_select on public.invoices
--   for select to authenticated
--   using ((org_id = ( SELECT current_org_id() AS current_org_id)));
-- create policy invoices_write on public.invoices
--   for all to authenticated
--   using (((org_id = ( SELECT current_org_id() AS current_org_id)) AND (( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'accounting'::text, 'sales'::text]))))
--   with check (((org_id = ( SELECT current_org_id() AS current_org_id)) AND (( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'accounting'::text, 'sales'::text]))));
--
-- -- item_categories
-- drop policy if exists item_categories_select on public.item_categories;
-- drop policy if exists item_categories_insert on public.item_categories;
-- drop policy if exists item_categories_update on public.item_categories;
-- drop policy if exists item_categories_delete on public.item_categories;
-- drop policy if exists item_categories_write on public.item_categories;
-- create policy item_categories_select on public.item_categories
--   for select to authenticated
--   using ((org_id = current_org_id()));
-- create policy item_categories_write on public.item_categories
--   for all to authenticated
--   using (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'sales'::text, 'ops'::text]))))
--   with check (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'sales'::text, 'ops'::text]))));
--
-- -- items
-- drop policy if exists items_select on public.items;
-- drop policy if exists items_insert on public.items;
-- drop policy if exists items_update on public.items;
-- drop policy if exists items_delete on public.items;
-- drop policy if exists items_write on public.items;
-- create policy items_select on public.items
--   for select to authenticated
--   using ((org_id = current_org_id()));
-- create policy items_write on public.items
--   for all to authenticated
--   using (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'sales'::text, 'ops'::text]))))
--   with check (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'sales'::text, 'ops'::text]))));
--
-- -- job_run_daily_log_consumed_line_items
-- drop policy if exists job_run_daily_log_consumed_line_items_select on public.job_run_daily_log_consumed_line_items;
-- drop policy if exists job_run_daily_log_consumed_line_items_insert on public.job_run_daily_log_consumed_line_items;
-- drop policy if exists job_run_daily_log_consumed_line_items_update on public.job_run_daily_log_consumed_line_items;
-- drop policy if exists job_run_daily_log_consumed_line_items_delete on public.job_run_daily_log_consumed_line_items;
-- drop policy if exists job_run_daily_log_consumed_line_items_write on public.job_run_daily_log_consumed_line_items;
-- create policy job_run_daily_log_consumed_line_items_select on public.job_run_daily_log_consumed_line_items
--   for select to authenticated
--   using ((org_id = current_org_id()));
-- create policy job_run_daily_log_consumed_line_items_write on public.job_run_daily_log_consumed_line_items
--   for all to authenticated
--   using (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text, 'sales'::text]))))
--   with check (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text, 'sales'::text]))));
--
-- -- job_run_daily_log_produced_line_items
-- drop policy if exists job_run_daily_log_produced_line_items_select on public.job_run_daily_log_produced_line_items;
-- drop policy if exists job_run_daily_log_produced_line_items_insert on public.job_run_daily_log_produced_line_items;
-- drop policy if exists job_run_daily_log_produced_line_items_update on public.job_run_daily_log_produced_line_items;
-- drop policy if exists job_run_daily_log_produced_line_items_delete on public.job_run_daily_log_produced_line_items;
-- drop policy if exists job_run_daily_log_produced_line_items_write on public.job_run_daily_log_produced_line_items;
-- create policy job_run_daily_log_produced_line_items_select on public.job_run_daily_log_produced_line_items
--   for select to authenticated
--   using ((org_id = current_org_id()));
-- create policy job_run_daily_log_produced_line_items_write on public.job_run_daily_log_produced_line_items
--   for all to authenticated
--   using (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text, 'sales'::text]))))
--   with check (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text, 'sales'::text]))));
--
-- -- job_run_daily_logs
-- drop policy if exists job_run_daily_logs_select on public.job_run_daily_logs;
-- drop policy if exists job_run_daily_logs_insert on public.job_run_daily_logs;
-- drop policy if exists job_run_daily_logs_update on public.job_run_daily_logs;
-- drop policy if exists job_run_daily_logs_delete on public.job_run_daily_logs;
-- drop policy if exists job_run_daily_logs_write on public.job_run_daily_logs;
-- create policy job_run_daily_logs_select on public.job_run_daily_logs
--   for select to authenticated
--   using ((org_id = current_org_id()));
-- create policy job_run_daily_logs_write on public.job_run_daily_logs
--   for all to authenticated
--   using (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text, 'sales'::text]))))
--   with check (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text, 'sales'::text]))));
--
-- -- job_runs
-- drop policy if exists job_runs_select on public.job_runs;
-- drop policy if exists job_runs_insert on public.job_runs;
-- drop policy if exists job_runs_update on public.job_runs;
-- drop policy if exists job_runs_delete on public.job_runs;
-- drop policy if exists job_runs_write on public.job_runs;
-- create policy job_runs_select on public.job_runs
--   for select to authenticated
--   using ((org_id = current_org_id()));
-- create policy job_runs_write on public.job_runs
--   for all to authenticated
--   using (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text, 'sales'::text]))))
--   with check (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text, 'sales'::text]))));
--
-- -- job_template_lines
-- drop policy if exists job_template_lines_select on public.job_template_lines;
-- drop policy if exists job_template_lines_insert on public.job_template_lines;
-- drop policy if exists job_template_lines_update on public.job_template_lines;
-- drop policy if exists job_template_lines_delete on public.job_template_lines;
-- drop policy if exists job_template_lines_write on public.job_template_lines;
-- create policy job_template_lines_select on public.job_template_lines
--   for select to authenticated
--   using ((org_id = current_org_id()));
-- create policy job_template_lines_write on public.job_template_lines
--   for all to authenticated
--   using (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text, 'sales'::text]))))
--   with check (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text, 'sales'::text]))));
--
-- -- job_templates
-- drop policy if exists job_templates_select on public.job_templates;
-- drop policy if exists job_templates_insert on public.job_templates;
-- drop policy if exists job_templates_update on public.job_templates;
-- drop policy if exists job_templates_delete on public.job_templates;
-- drop policy if exists job_templates_write on public.job_templates;
-- create policy job_templates_select on public.job_templates
--   for select to authenticated
--   using ((org_id = current_org_id()));
-- create policy job_templates_write on public.job_templates
--   for all to authenticated
--   using (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text, 'sales'::text]))))
--   with check (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text, 'sales'::text]))));
--
-- -- job_types
-- drop policy if exists job_types_select on public.job_types;
-- drop policy if exists job_types_insert on public.job_types;
-- drop policy if exists job_types_update on public.job_types;
-- drop policy if exists job_types_delete on public.job_types;
-- drop policy if exists job_types_write on public.job_types;
-- create policy job_types_select on public.job_types
--   for select to authenticated
--   using ((org_id = current_org_id()));
-- create policy job_types_write on public.job_types
--   for all to authenticated
--   using (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'sales'::text, 'ops'::text]))))
--   with check (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'sales'::text, 'ops'::text]))));
--
-- -- journal_entries
-- drop policy if exists journal_entries_select on public.journal_entries;
-- drop policy if exists journal_entries_insert on public.journal_entries;
-- drop policy if exists journal_entries_update on public.journal_entries;
-- drop policy if exists journal_entries_delete on public.journal_entries;
-- drop policy if exists journal_entries_write on public.journal_entries;
-- create policy journal_entries_select on public.journal_entries
--   for select to authenticated
--   using ((org_id = current_org_id()));
-- create policy journal_entries_write on public.journal_entries
--   for all to authenticated
--   using (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'accounting'::text]))))
--   with check (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'accounting'::text]))));
--
-- -- journal_entry_lines
-- drop policy if exists journal_entry_lines_select on public.journal_entry_lines;
-- drop policy if exists journal_entry_lines_insert on public.journal_entry_lines;
-- drop policy if exists journal_entry_lines_update on public.journal_entry_lines;
-- drop policy if exists journal_entry_lines_delete on public.journal_entry_lines;
-- drop policy if exists journal_entry_lines_write on public.journal_entry_lines;
-- create policy journal_entry_lines_select on public.journal_entry_lines
--   for select to authenticated
--   using ((EXISTS ( SELECT 1 FROM journal_entries je WHERE ((je.id = journal_entry_lines.entry_id) AND (je.org_id = current_org_id())))));
-- create policy journal_entry_lines_write on public.journal_entry_lines
--   for all to authenticated
--   using ((EXISTS ( SELECT 1 FROM journal_entries je WHERE ((je.id = journal_entry_lines.entry_id) AND (je.org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'accounting'::text]))))))
--   with check ((EXISTS ( SELECT 1 FROM journal_entries je WHERE ((je.id = journal_entry_lines.entry_id) AND (je.org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'accounting'::text]))))));
--
-- -- kitting_job_consumed_line_items
-- drop policy if exists kitting_job_consumed_line_items_select on public.kitting_job_consumed_line_items;
-- drop policy if exists kitting_job_consumed_line_items_insert on public.kitting_job_consumed_line_items;
-- drop policy if exists kitting_job_consumed_line_items_update on public.kitting_job_consumed_line_items;
-- drop policy if exists kitting_job_consumed_line_items_delete on public.kitting_job_consumed_line_items;
-- drop policy if exists kitting_job_consumed_line_items_write on public.kitting_job_consumed_line_items;
-- create policy kitting_job_consumed_line_items_select on public.kitting_job_consumed_line_items
--   for select to authenticated
--   using ((org_id = current_org_id()));
-- create policy kitting_job_consumed_line_items_write on public.kitting_job_consumed_line_items
--   for all to authenticated
--   using (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))))
--   with check (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))));
--
-- -- kitting_job_produced_line_items
-- drop policy if exists kitting_job_produced_line_items_select on public.kitting_job_produced_line_items;
-- drop policy if exists kitting_job_produced_line_items_insert on public.kitting_job_produced_line_items;
-- drop policy if exists kitting_job_produced_line_items_update on public.kitting_job_produced_line_items;
-- drop policy if exists kitting_job_produced_line_items_delete on public.kitting_job_produced_line_items;
-- drop policy if exists kitting_job_produced_line_items_write on public.kitting_job_produced_line_items;
-- create policy kitting_job_produced_line_items_select on public.kitting_job_produced_line_items
--   for select to authenticated
--   using ((org_id = current_org_id()));
-- create policy kitting_job_produced_line_items_write on public.kitting_job_produced_line_items
--   for all to authenticated
--   using (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))))
--   with check (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))));
--
-- -- kitting_jobs
-- drop policy if exists kitting_jobs_select on public.kitting_jobs;
-- drop policy if exists kitting_jobs_insert on public.kitting_jobs;
-- drop policy if exists kitting_jobs_update on public.kitting_jobs;
-- drop policy if exists kitting_jobs_delete on public.kitting_jobs;
-- drop policy if exists kitting_jobs_write on public.kitting_jobs;
-- create policy kitting_jobs_select on public.kitting_jobs
--   for select to authenticated
--   using ((org_id = current_org_id()));
-- create policy kitting_jobs_write on public.kitting_jobs
--   for all to authenticated
--   using (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))))
--   with check (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))));
--
-- -- leads
-- drop policy if exists leads_select on public.leads;
-- drop policy if exists leads_insert on public.leads;
-- drop policy if exists leads_update on public.leads;
-- drop policy if exists leads_delete on public.leads;
-- drop policy if exists leads_write on public.leads;
-- create policy leads_select on public.leads
--   for select to authenticated
--   using ((org_id = ( SELECT current_org_id() AS current_org_id)));
-- create policy leads_write on public.leads
--   for all to authenticated
--   using (((org_id = ( SELECT current_org_id() AS current_org_id)) AND (( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'sales'::text]))))
--   with check (((org_id = ( SELECT current_org_id() AS current_org_id)) AND (( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'sales'::text]))));
--
-- -- lots
-- drop policy if exists lots_select on public.lots;
-- drop policy if exists lots_insert on public.lots;
-- drop policy if exists lots_update on public.lots;
-- drop policy if exists lots_delete on public.lots;
-- drop policy if exists lots_write on public.lots;
-- create policy lots_select on public.lots
--   for select to authenticated
--   using ((org_id = current_org_id()));
-- create policy lots_write on public.lots
--   for all to authenticated
--   using (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))))
--   with check (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))));
--
-- -- manufacturing_run_consumed_line_items
-- drop policy if exists manufacturing_run_consumed_line_items_select on public.manufacturing_run_consumed_line_items;
-- drop policy if exists manufacturing_run_consumed_line_items_insert on public.manufacturing_run_consumed_line_items;
-- drop policy if exists manufacturing_run_consumed_line_items_update on public.manufacturing_run_consumed_line_items;
-- drop policy if exists manufacturing_run_consumed_line_items_delete on public.manufacturing_run_consumed_line_items;
-- drop policy if exists manufacturing_run_consumed_line_items_write on public.manufacturing_run_consumed_line_items;
-- create policy manufacturing_run_consumed_line_items_select on public.manufacturing_run_consumed_line_items
--   for select to authenticated
--   using ((org_id = current_org_id()));
-- create policy manufacturing_run_consumed_line_items_write on public.manufacturing_run_consumed_line_items
--   for all to authenticated
--   using (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))))
--   with check (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))));
--
-- -- manufacturing_run_produced_line_items
-- drop policy if exists manufacturing_run_produced_line_items_select on public.manufacturing_run_produced_line_items;
-- drop policy if exists manufacturing_run_produced_line_items_insert on public.manufacturing_run_produced_line_items;
-- drop policy if exists manufacturing_run_produced_line_items_update on public.manufacturing_run_produced_line_items;
-- drop policy if exists manufacturing_run_produced_line_items_delete on public.manufacturing_run_produced_line_items;
-- drop policy if exists manufacturing_run_produced_line_items_write on public.manufacturing_run_produced_line_items;
-- create policy manufacturing_run_produced_line_items_select on public.manufacturing_run_produced_line_items
--   for select to authenticated
--   using ((org_id = current_org_id()));
-- create policy manufacturing_run_produced_line_items_write on public.manufacturing_run_produced_line_items
--   for all to authenticated
--   using (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))))
--   with check (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))));
--
-- -- manufacturing_runs
-- drop policy if exists manufacturing_runs_select on public.manufacturing_runs;
-- drop policy if exists manufacturing_runs_insert on public.manufacturing_runs;
-- drop policy if exists manufacturing_runs_update on public.manufacturing_runs;
-- drop policy if exists manufacturing_runs_delete on public.manufacturing_runs;
-- drop policy if exists manufacturing_runs_write on public.manufacturing_runs;
-- create policy manufacturing_runs_select on public.manufacturing_runs
--   for select to authenticated
--   using ((org_id = current_org_id()));
-- create policy manufacturing_runs_write on public.manufacturing_runs
--   for all to authenticated
--   using (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))))
--   with check (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))));
--
-- -- numbering_sequences
-- drop policy if exists numbering_sequences_select on public.numbering_sequences;
-- drop policy if exists numbering_sequences_insert on public.numbering_sequences;
-- drop policy if exists numbering_sequences_update on public.numbering_sequences;
-- drop policy if exists numbering_sequences_delete on public.numbering_sequences;
-- drop policy if exists numbering_sequences_write on public.numbering_sequences;
-- create policy numbering_sequences_select on public.numbering_sequences
--   for select to authenticated
--   using ((org_id = current_org_id()));
-- create policy numbering_sequences_write on public.numbering_sequences
--   for all to authenticated
--   using (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text]))))
--   with check (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text]))));
--
-- -- opportunities
-- drop policy if exists opportunities_select on public.opportunities;
-- drop policy if exists opportunities_insert on public.opportunities;
-- drop policy if exists opportunities_update on public.opportunities;
-- drop policy if exists opportunities_delete on public.opportunities;
-- drop policy if exists opportunities_write on public.opportunities;
-- create policy opportunities_select on public.opportunities
--   for select to authenticated
--   using ((org_id = ( SELECT current_org_id() AS current_org_id)));
-- create policy opportunities_write on public.opportunities
--   for all to authenticated
--   using (((org_id = ( SELECT current_org_id() AS current_org_id)) AND (( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'sales'::text]))))
--   with check (((org_id = ( SELECT current_org_id() AS current_org_id)) AND (( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'sales'::text]))));
--
-- -- org_branding
-- drop policy if exists org_branding_select on public.org_branding;
-- drop policy if exists org_branding_insert on public.org_branding;
-- drop policy if exists org_branding_update on public.org_branding;
-- drop policy if exists org_branding_delete on public.org_branding;
-- drop policy if exists org_branding_write on public.org_branding;
-- create policy org_branding_select on public.org_branding
--   for select to authenticated
--   using ((org_id = current_org_id()));
-- create policy org_branding_write on public.org_branding
--   for all to authenticated
--   using (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text]))))
--   with check (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text]))));
--
-- -- org_domains
-- drop policy if exists org_domains_select on public.org_domains;
-- drop policy if exists org_domains_insert on public.org_domains;
-- drop policy if exists org_domains_update on public.org_domains;
-- drop policy if exists org_domains_delete on public.org_domains;
-- drop policy if exists org_domains_write on public.org_domains;
-- create policy org_domains_select on public.org_domains
--   for select to authenticated
--   using ((org_id = current_org_id()));
-- create policy org_domains_write on public.org_domains
--   for all to authenticated
--   using (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text]))))
--   with check (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text]))));
--
-- -- org_feature_flags
-- drop policy if exists org_feature_flags_select on public.org_feature_flags;
-- drop policy if exists org_feature_flags_insert on public.org_feature_flags;
-- drop policy if exists org_feature_flags_update on public.org_feature_flags;
-- drop policy if exists org_feature_flags_delete on public.org_feature_flags;
-- drop policy if exists org_feature_flags_write on public.org_feature_flags;
-- create policy org_feature_flags_select on public.org_feature_flags
--   for select to authenticated
--   using ((org_id = current_org_id()));
-- create policy org_feature_flags_write on public.org_feature_flags
--   for all to authenticated
--   using (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text]))))
--   with check (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text]))));
--
-- -- org_memberships
-- drop policy if exists org_memberships_select on public.org_memberships;
-- drop policy if exists org_memberships_insert on public.org_memberships;
-- drop policy if exists org_memberships_update on public.org_memberships;
-- drop policy if exists org_memberships_delete on public.org_memberships;
-- drop policy if exists org_memberships_write on public.org_memberships;
-- create policy org_memberships_select on public.org_memberships
--   for select to authenticated
--   using ((org_id = current_org_id()));
-- create policy org_memberships_write on public.org_memberships
--   for all to authenticated
--   using (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text]))))
--   with check (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text]))));
--
-- -- org_settings
-- drop policy if exists org_settings_select on public.org_settings;
-- drop policy if exists org_settings_insert on public.org_settings;
-- drop policy if exists org_settings_update on public.org_settings;
-- drop policy if exists org_settings_delete on public.org_settings;
-- drop policy if exists org_settings_write on public.org_settings;
-- create policy org_settings_select on public.org_settings
--   for select to authenticated
--   using ((org_id = current_org_id()));
-- create policy org_settings_write on public.org_settings
--   for all to authenticated
--   using (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text]))))
--   with check (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text]))));
--
-- -- organizations
-- drop policy if exists organizations_select on public.organizations;
-- drop policy if exists organizations_insert on public.organizations;
-- drop policy if exists organizations_update on public.organizations;
-- drop policy if exists organizations_delete on public.organizations;
-- drop policy if exists organizations_write on public.organizations;
-- create policy organizations_select on public.organizations
--   for select to authenticated
--   using ((id = current_org_id()));
-- create policy organizations_write on public.organizations
--   for all to authenticated
--   using (((id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text]))))
--   with check (((id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text]))));
--
-- -- payment_allocations
-- drop policy if exists payment_allocations_select on public.payment_allocations;
-- drop policy if exists payment_allocations_insert on public.payment_allocations;
-- drop policy if exists payment_allocations_update on public.payment_allocations;
-- drop policy if exists payment_allocations_delete on public.payment_allocations;
-- drop policy if exists payment_allocations_write on public.payment_allocations;
-- create policy payment_allocations_select on public.payment_allocations
--   for select to authenticated
--   using ((EXISTS ( SELECT 1 FROM payments p WHERE ((p.id = payment_allocations.payment_id) AND (p.org_id = current_org_id())))));
-- create policy payment_allocations_write on public.payment_allocations
--   for all to authenticated
--   using ((EXISTS ( SELECT 1 FROM payments p WHERE ((p.id = payment_allocations.payment_id) AND (p.org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'accounting'::text]))))))
--   with check ((EXISTS ( SELECT 1 FROM payments p WHERE ((p.id = payment_allocations.payment_id) AND (p.org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'accounting'::text]))))));
--
-- -- payment_methods
-- drop policy if exists payment_methods_select on public.payment_methods;
-- drop policy if exists payment_methods_insert on public.payment_methods;
-- drop policy if exists payment_methods_update on public.payment_methods;
-- drop policy if exists payment_methods_delete on public.payment_methods;
-- drop policy if exists payment_methods_write on public.payment_methods;
-- create policy payment_methods_select on public.payment_methods
--   for select to authenticated
--   using ((org_id = current_org_id()));
-- create policy payment_methods_write on public.payment_methods
--   for all to authenticated
--   using (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'accounting'::text, 'sales'::text]))))
--   with check (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'accounting'::text, 'sales'::text]))));
--
-- -- payments
-- drop policy if exists payments_select on public.payments;
-- drop policy if exists payments_insert on public.payments;
-- drop policy if exists payments_update on public.payments;
-- drop policy if exists payments_delete on public.payments;
-- drop policy if exists payments_write on public.payments;
-- create policy payments_select on public.payments
--   for select to authenticated
--   using ((org_id = current_org_id()));
-- create policy payments_write on public.payments
--   for all to authenticated
--   using (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'accounting'::text]))))
--   with check (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'accounting'::text]))));
--
-- -- period_close
-- drop policy if exists period_close_select on public.period_close;
-- drop policy if exists period_close_insert on public.period_close;
-- drop policy if exists period_close_update on public.period_close;
-- drop policy if exists period_close_delete on public.period_close;
-- drop policy if exists period_close_write on public.period_close;
-- create policy period_close_select on public.period_close
--   for select to authenticated
--   using ((org_id = current_org_id()));
-- create policy period_close_write on public.period_close
--   for all to authenticated
--   using (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'accounting'::text]))))
--   with check (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'accounting'::text]))));
--
-- -- po_line_items
-- drop policy if exists po_line_items_select on public.po_line_items;
-- drop policy if exists po_line_items_insert on public.po_line_items;
-- drop policy if exists po_line_items_update on public.po_line_items;
-- drop policy if exists po_line_items_delete on public.po_line_items;
-- drop policy if exists po_line_items_write on public.po_line_items;
-- create policy po_line_items_select on public.po_line_items
--   for select to authenticated
--   using ((EXISTS ( SELECT 1 FROM purchase_orders po WHERE ((po.id = po_line_items.purchase_order_id) AND (po.org_id = current_org_id())))));
-- create policy po_line_items_write on public.po_line_items
--   for all to authenticated
--   using ((EXISTS ( SELECT 1 FROM purchase_orders po WHERE ((po.id = po_line_items.purchase_order_id) AND (po.org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text, 'accounting'::text]))))))
--   with check ((EXISTS ( SELECT 1 FROM purchase_orders po WHERE ((po.id = po_line_items.purchase_order_id) AND (po.org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text, 'accounting'::text]))))));
--
-- -- pricing_tiers
-- drop policy if exists pricing_tiers_select on public.pricing_tiers;
-- drop policy if exists pricing_tiers_insert on public.pricing_tiers;
-- drop policy if exists pricing_tiers_update on public.pricing_tiers;
-- drop policy if exists pricing_tiers_delete on public.pricing_tiers;
-- drop policy if exists pricing_tiers_write on public.pricing_tiers;
-- create policy pricing_tiers_select on public.pricing_tiers
--   for select to authenticated
--   using ((org_id = current_org_id()));
-- create policy pricing_tiers_write on public.pricing_tiers
--   for all to authenticated
--   using (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'accounting'::text, 'sales'::text]))))
--   with check (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'accounting'::text, 'sales'::text]))));
--
-- -- production_runs
-- drop policy if exists production_runs_select on public.production_runs;
-- drop policy if exists production_runs_insert on public.production_runs;
-- drop policy if exists production_runs_update on public.production_runs;
-- drop policy if exists production_runs_delete on public.production_runs;
-- drop policy if exists production_runs_write on public.production_runs;
-- create policy production_runs_select on public.production_runs
--   for select to authenticated
--   using ((org_id = current_org_id()));
-- create policy production_runs_write on public.production_runs
--   for all to authenticated
--   using (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))))
--   with check (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))));
--
-- -- project_line_items
-- drop policy if exists project_line_items_select on public.project_line_items;
-- drop policy if exists project_line_items_insert on public.project_line_items;
-- drop policy if exists project_line_items_update on public.project_line_items;
-- drop policy if exists project_line_items_delete on public.project_line_items;
-- drop policy if exists project_line_items_write on public.project_line_items;
-- create policy project_line_items_select on public.project_line_items
--   for select to authenticated
--   using ((org_id = ( SELECT current_org_id() AS current_org_id)));
-- create policy project_line_items_write on public.project_line_items
--   for all to authenticated
--   using (((org_id = ( SELECT current_org_id() AS current_org_id)) AND (( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'sales'::text, 'ops'::text, 'accounting'::text]))))
--   with check (((org_id = ( SELECT current_org_id() AS current_org_id)) AND (( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'sales'::text, 'ops'::text, 'accounting'::text]))));
--
-- -- project_phases
-- drop policy if exists project_phases_select on public.project_phases;
-- drop policy if exists project_phases_insert on public.project_phases;
-- drop policy if exists project_phases_update on public.project_phases;
-- drop policy if exists project_phases_delete on public.project_phases;
-- drop policy if exists project_phases_write on public.project_phases;
-- create policy project_phases_select on public.project_phases
--   for select to authenticated
--   using ((EXISTS ( SELECT 1 FROM projects p WHERE ((p.id = project_phases.project_id) AND (p.org_id = current_org_id())))));
-- create policy project_phases_write on public.project_phases
--   for all to authenticated
--   using ((EXISTS ( SELECT 1 FROM projects p WHERE ((p.id = project_phases.project_id) AND (p.org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'sales'::text, 'ops'::text, 'accounting'::text]))))))
--   with check ((EXISTS ( SELECT 1 FROM projects p WHERE ((p.id = project_phases.project_id) AND (p.org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'sales'::text, 'ops'::text, 'accounting'::text]))))));
--
-- -- projects
-- drop policy if exists projects_select on public.projects;
-- drop policy if exists projects_insert on public.projects;
-- drop policy if exists projects_update on public.projects;
-- drop policy if exists projects_delete on public.projects;
-- drop policy if exists projects_write on public.projects;
-- create policy projects_select on public.projects
--   for select to authenticated
--   using ((org_id = ( SELECT current_org_id() AS current_org_id)));
-- create policy projects_write on public.projects
--   for all to authenticated
--   using (((org_id = ( SELECT current_org_id() AS current_org_id)) AND (( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'sales'::text, 'ops'::text, 'accounting'::text]))))
--   with check (((org_id = ( SELECT current_org_id() AS current_org_id)) AND (( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'sales'::text, 'ops'::text, 'accounting'::text]))));
--
-- -- purchase_orders
-- drop policy if exists purchase_orders_select on public.purchase_orders;
-- drop policy if exists purchase_orders_insert on public.purchase_orders;
-- drop policy if exists purchase_orders_update on public.purchase_orders;
-- drop policy if exists purchase_orders_delete on public.purchase_orders;
-- drop policy if exists purchase_orders_write on public.purchase_orders;
-- create policy purchase_orders_select on public.purchase_orders
--   for select to authenticated
--   using ((org_id = current_org_id()));
-- create policy purchase_orders_write on public.purchase_orders
--   for all to authenticated
--   using (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text, 'accounting'::text]))))
--   with check (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text, 'accounting'::text]))));
--
-- -- putaway_tasks
-- drop policy if exists putaway_tasks_select on public.putaway_tasks;
-- drop policy if exists putaway_tasks_insert on public.putaway_tasks;
-- drop policy if exists putaway_tasks_update on public.putaway_tasks;
-- drop policy if exists putaway_tasks_delete on public.putaway_tasks;
-- drop policy if exists putaway_tasks_write on public.putaway_tasks;
-- create policy putaway_tasks_select on public.putaway_tasks
--   for select to authenticated
--   using ((org_id = current_org_id()));
-- create policy putaway_tasks_write on public.putaway_tasks
--   for all to authenticated
--   using (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))))
--   with check (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))));
--
-- -- quote_approvals
-- drop policy if exists quote_approvals_select on public.quote_approvals;
-- drop policy if exists quote_approvals_insert on public.quote_approvals;
-- drop policy if exists quote_approvals_update on public.quote_approvals;
-- drop policy if exists quote_approvals_delete on public.quote_approvals;
-- drop policy if exists quote_approvals_write on public.quote_approvals;
-- create policy quote_approvals_select on public.quote_approvals
--   for select to authenticated
--   using ((EXISTS ( SELECT 1 FROM quotes q WHERE ((q.id = quote_approvals.quote_id) AND (q.org_id = current_org_id())))));
-- create policy quote_approvals_write on public.quote_approvals
--   for all to authenticated
--   using ((EXISTS ( SELECT 1 FROM quotes q WHERE ((q.id = quote_approvals.quote_id) AND (q.org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'sales'::text, 'accounting'::text]))))))
--   with check ((EXISTS ( SELECT 1 FROM quotes q WHERE ((q.id = quote_approvals.quote_id) AND (q.org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'sales'::text, 'accounting'::text]))))));
--
-- -- quote_line_items
-- drop policy if exists quote_line_items_select on public.quote_line_items;
-- drop policy if exists quote_line_items_insert on public.quote_line_items;
-- drop policy if exists quote_line_items_update on public.quote_line_items;
-- drop policy if exists quote_line_items_delete on public.quote_line_items;
-- drop policy if exists quote_line_items_write on public.quote_line_items;
-- create policy quote_line_items_select on public.quote_line_items
--   for select to authenticated
--   using ((EXISTS ( SELECT 1 FROM quotes q WHERE ((q.id = quote_line_items.quote_id) AND (q.org_id = ( SELECT current_org_id() AS current_org_id))))));
-- create policy quote_line_items_write on public.quote_line_items
--   for all to authenticated
--   using ((EXISTS ( SELECT 1 FROM quotes q WHERE ((q.id = quote_line_items.quote_id) AND (q.org_id = ( SELECT current_org_id() AS current_org_id)) AND (( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'sales'::text, 'accounting'::text]))))))
--   with check ((EXISTS ( SELECT 1 FROM quotes q WHERE ((q.id = quote_line_items.quote_id) AND (q.org_id = ( SELECT current_org_id() AS current_org_id)) AND (( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'sales'::text, 'accounting'::text]))))));
--
-- -- quote_templates
-- drop policy if exists quote_templates_select on public.quote_templates;
-- drop policy if exists quote_templates_insert on public.quote_templates;
-- drop policy if exists quote_templates_update on public.quote_templates;
-- drop policy if exists quote_templates_delete on public.quote_templates;
-- drop policy if exists quote_templates_write on public.quote_templates;
-- create policy quote_templates_select on public.quote_templates
--   for select to authenticated
--   using ((org_id = current_org_id()));
-- create policy quote_templates_write on public.quote_templates
--   for all to authenticated
--   using (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'sales'::text, 'accounting'::text]))))
--   with check (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'sales'::text, 'accounting'::text]))));
--
-- -- quotes
-- drop policy if exists quotes_select on public.quotes;
-- drop policy if exists quotes_insert on public.quotes;
-- drop policy if exists quotes_update on public.quotes;
-- drop policy if exists quotes_delete on public.quotes;
-- drop policy if exists quotes_write on public.quotes;
-- create policy quotes_select on public.quotes
--   for select to authenticated
--   using ((org_id = ( SELECT current_org_id() AS current_org_id)));
-- create policy quotes_write on public.quotes
--   for all to authenticated
--   using (((org_id = ( SELECT current_org_id() AS current_org_id)) AND (( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'sales'::text, 'accounting'::text]))))
--   with check (((org_id = ( SELECT current_org_id() AS current_org_id)) AND (( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'sales'::text, 'accounting'::text]))));
--
-- -- receiving_order_line_items
-- drop policy if exists receiving_order_line_items_select on public.receiving_order_line_items;
-- drop policy if exists receiving_order_line_items_insert on public.receiving_order_line_items;
-- drop policy if exists receiving_order_line_items_update on public.receiving_order_line_items;
-- drop policy if exists receiving_order_line_items_delete on public.receiving_order_line_items;
-- drop policy if exists receiving_order_line_items_write on public.receiving_order_line_items;
-- create policy receiving_order_line_items_select on public.receiving_order_line_items
--   for select to authenticated
--   using ((org_id = current_org_id()));
-- create policy receiving_order_line_items_write on public.receiving_order_line_items
--   for all to authenticated
--   using (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))))
--   with check (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))));
--
-- -- receiving_orders
-- drop policy if exists receiving_orders_select on public.receiving_orders;
-- drop policy if exists receiving_orders_insert on public.receiving_orders;
-- drop policy if exists receiving_orders_update on public.receiving_orders;
-- drop policy if exists receiving_orders_delete on public.receiving_orders;
-- drop policy if exists receiving_orders_write on public.receiving_orders;
-- create policy receiving_orders_select on public.receiving_orders
--   for select to authenticated
--   using ((org_id = current_org_id()));
-- create policy receiving_orders_write on public.receiving_orders
--   for all to authenticated
--   using (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))))
--   with check (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))));
--
-- -- sales_channels
-- drop policy if exists sales_channels_select on public.sales_channels;
-- drop policy if exists sales_channels_insert on public.sales_channels;
-- drop policy if exists sales_channels_update on public.sales_channels;
-- drop policy if exists sales_channels_delete on public.sales_channels;
-- drop policy if exists sales_channels_write on public.sales_channels;
-- create policy sales_channels_select on public.sales_channels
--   for select to authenticated
--   using ((org_id = current_org_id()));
-- create policy sales_channels_write on public.sales_channels
--   for all to authenticated
--   using (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text, 'sales'::text]))))
--   with check (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text, 'sales'::text]))));
--
-- -- sales_order_line_items
-- drop policy if exists sales_order_line_items_select on public.sales_order_line_items;
-- drop policy if exists sales_order_line_items_insert on public.sales_order_line_items;
-- drop policy if exists sales_order_line_items_update on public.sales_order_line_items;
-- drop policy if exists sales_order_line_items_delete on public.sales_order_line_items;
-- drop policy if exists sales_order_line_items_write on public.sales_order_line_items;
-- create policy sales_order_line_items_select on public.sales_order_line_items
--   for select to authenticated
--   using ((org_id = current_org_id()));
-- create policy sales_order_line_items_write on public.sales_order_line_items
--   for all to authenticated
--   using (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text, 'sales'::text]))))
--   with check (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text, 'sales'::text]))));
--
-- -- sales_orders
-- drop policy if exists sales_orders_select on public.sales_orders;
-- drop policy if exists sales_orders_insert on public.sales_orders;
-- drop policy if exists sales_orders_update on public.sales_orders;
-- drop policy if exists sales_orders_delete on public.sales_orders;
-- drop policy if exists sales_orders_write on public.sales_orders;
-- create policy sales_orders_select on public.sales_orders
--   for select to authenticated
--   using ((org_id = current_org_id()));
-- create policy sales_orders_write on public.sales_orders
--   for all to authenticated
--   using (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text, 'sales'::text]))))
--   with check (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text, 'sales'::text]))));
--
-- -- saml_configs
-- drop policy if exists saml_configs_select on public.saml_configs;
-- drop policy if exists saml_configs_insert on public.saml_configs;
-- drop policy if exists saml_configs_update on public.saml_configs;
-- drop policy if exists saml_configs_delete on public.saml_configs;
-- drop policy if exists saml_configs_write on public.saml_configs;
-- create policy saml_configs_select on public.saml_configs
--   for select to authenticated
--   using ((EXISTS ( SELECT 1 FROM sso_connections sc WHERE ((sc.id = saml_configs.sso_connection_id) AND (sc.org_id = current_org_id())))));
-- create policy saml_configs_write on public.saml_configs
--   for all to authenticated
--   using ((EXISTS ( SELECT 1 FROM sso_connections sc WHERE ((sc.id = saml_configs.sso_connection_id) AND (sc.org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text]))))))
--   with check ((EXISTS ( SELECT 1 FROM sso_connections sc WHERE ((sc.id = saml_configs.sso_connection_id) AND (sc.org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text]))))));
--
-- -- saved_views
-- drop policy if exists saved_views_select on public.saved_views;
-- drop policy if exists saved_views_insert on public.saved_views;
-- drop policy if exists saved_views_update on public.saved_views;
-- drop policy if exists saved_views_delete on public.saved_views;
-- drop policy if exists saved_views_write on public.saved_views;
-- create policy saved_views_select on public.saved_views
--   for select to authenticated
--   using (((org_id = current_org_id()) AND ((owner_user_id = auth.uid()) OR (is_shared = true))));
-- create policy saved_views_write on public.saved_views
--   for all to authenticated
--   using (((org_id = current_org_id()) AND (owner_user_id = auth.uid())))
--   with check (((org_id = current_org_id()) AND (owner_user_id = auth.uid())));
--
-- -- shifts
-- drop policy if exists shifts_select on public.shifts;
-- drop policy if exists shifts_insert on public.shifts;
-- drop policy if exists shifts_update on public.shifts;
-- drop policy if exists shifts_delete on public.shifts;
-- drop policy if exists shifts_write on public.shifts;
-- create policy shifts_select on public.shifts
--   for select to authenticated
--   using ((org_id = current_org_id()));
-- create policy shifts_write on public.shifts
--   for all to authenticated
--   using (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))))
--   with check (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))));
--
-- -- shipment_line_items
-- drop policy if exists shipment_line_items_select on public.shipment_line_items;
-- drop policy if exists shipment_line_items_insert on public.shipment_line_items;
-- drop policy if exists shipment_line_items_update on public.shipment_line_items;
-- drop policy if exists shipment_line_items_delete on public.shipment_line_items;
-- drop policy if exists shipment_line_items_write on public.shipment_line_items;
-- create policy shipment_line_items_select on public.shipment_line_items
--   for select to authenticated
--   using ((org_id = current_org_id()));
-- create policy shipment_line_items_write on public.shipment_line_items
--   for all to authenticated
--   using (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))))
--   with check (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))));
--
-- -- shipments
-- drop policy if exists shipments_select on public.shipments;
-- drop policy if exists shipments_insert on public.shipments;
-- drop policy if exists shipments_update on public.shipments;
-- drop policy if exists shipments_delete on public.shipments;
-- drop policy if exists shipments_write on public.shipments;
-- create policy shipments_select on public.shipments
--   for select to authenticated
--   using ((org_id = current_org_id()));
-- create policy shipments_write on public.shipments
--   for all to authenticated
--   using (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))))
--   with check (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))));
--
-- -- sso_connections
-- drop policy if exists sso_connections_select on public.sso_connections;
-- drop policy if exists sso_connections_insert on public.sso_connections;
-- drop policy if exists sso_connections_update on public.sso_connections;
-- drop policy if exists sso_connections_delete on public.sso_connections;
-- drop policy if exists sso_connections_write on public.sso_connections;
-- create policy sso_connections_select on public.sso_connections
--   for select to authenticated
--   using ((org_id = current_org_id()));
-- create policy sso_connections_write on public.sso_connections
--   for all to authenticated
--   using (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text]))))
--   with check (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text]))));
--
-- -- supply_plan_lines
-- drop policy if exists supply_plan_lines_select on public.supply_plan_lines;
-- drop policy if exists supply_plan_lines_insert on public.supply_plan_lines;
-- drop policy if exists supply_plan_lines_update on public.supply_plan_lines;
-- drop policy if exists supply_plan_lines_delete on public.supply_plan_lines;
-- drop policy if exists supply_plan_lines_write on public.supply_plan_lines;
-- create policy supply_plan_lines_select on public.supply_plan_lines
--   for select to authenticated
--   using ((org_id = current_org_id()));
-- create policy supply_plan_lines_write on public.supply_plan_lines
--   for all to authenticated
--   using (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text, 'sales'::text]))))
--   with check (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text, 'sales'::text]))));
--
-- -- supply_plans
-- drop policy if exists supply_plans_select on public.supply_plans;
-- drop policy if exists supply_plans_insert on public.supply_plans;
-- drop policy if exists supply_plans_update on public.supply_plans;
-- drop policy if exists supply_plans_delete on public.supply_plans;
-- drop policy if exists supply_plans_write on public.supply_plans;
-- create policy supply_plans_select on public.supply_plans
--   for select to authenticated
--   using ((org_id = current_org_id()));
-- create policy supply_plans_write on public.supply_plans
--   for all to authenticated
--   using (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text, 'sales'::text]))))
--   with check (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text, 'sales'::text]))));
--
-- -- taxes
-- drop policy if exists taxes_select on public.taxes;
-- drop policy if exists taxes_insert on public.taxes;
-- drop policy if exists taxes_update on public.taxes;
-- drop policy if exists taxes_delete on public.taxes;
-- drop policy if exists taxes_write on public.taxes;
-- create policy taxes_select on public.taxes
--   for select to authenticated
--   using ((org_id = current_org_id()));
-- create policy taxes_write on public.taxes
--   for all to authenticated
--   using (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'accounting'::text, 'sales'::text]))))
--   with check (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'accounting'::text, 'sales'::text]))));
--
-- -- three_pl_accounts
-- drop policy if exists three_pl_accounts_select on public.three_pl_accounts;
-- drop policy if exists three_pl_accounts_insert on public.three_pl_accounts;
-- drop policy if exists three_pl_accounts_update on public.three_pl_accounts;
-- drop policy if exists three_pl_accounts_delete on public.three_pl_accounts;
-- drop policy if exists three_pl_accounts_write on public.three_pl_accounts;
-- create policy three_pl_accounts_select on public.three_pl_accounts
--   for select to authenticated
--   using ((org_id = current_org_id()));
-- create policy three_pl_accounts_write on public.three_pl_accounts
--   for all to authenticated
--   using (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text, 'sales'::text]))))
--   with check (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text, 'sales'::text]))));
--
-- -- time_entries
-- drop policy if exists time_entries_select on public.time_entries;
-- drop policy if exists time_entries_insert on public.time_entries;
-- drop policy if exists time_entries_update on public.time_entries;
-- drop policy if exists time_entries_delete on public.time_entries;
-- drop policy if exists time_entries_write on public.time_entries;
-- create policy time_entries_select on public.time_entries
--   for select to authenticated
--   using ((org_id = current_org_id()));
-- create policy time_entries_write on public.time_entries
--   for all to authenticated
--   using (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))))
--   with check (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))));
--
-- -- units
-- drop policy if exists units_select on public.units;
-- drop policy if exists units_insert on public.units;
-- drop policy if exists units_update on public.units;
-- drop policy if exists units_delete on public.units;
-- drop policy if exists units_write on public.units;
-- create policy units_select on public.units
--   for select to authenticated
--   using ((org_id = current_org_id()));
-- create policy units_write on public.units
--   for all to authenticated
--   using (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'sales'::text, 'ops'::text]))))
--   with check (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'sales'::text, 'ops'::text]))));
--
-- -- value_added_services
-- drop policy if exists value_added_services_select on public.value_added_services;
-- drop policy if exists value_added_services_insert on public.value_added_services;
-- drop policy if exists value_added_services_update on public.value_added_services;
-- drop policy if exists value_added_services_delete on public.value_added_services;
-- drop policy if exists value_added_services_write on public.value_added_services;
-- create policy value_added_services_select on public.value_added_services
--   for select to authenticated
--   using ((org_id = current_org_id()));
-- create policy value_added_services_write on public.value_added_services
--   for all to authenticated
--   using (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'sales'::text, 'ops'::text]))))
--   with check (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'sales'::text, 'ops'::text]))));
--
-- -- vendor_bill_payments
-- drop policy if exists vendor_bill_payments_select on public.vendor_bill_payments;
-- drop policy if exists vendor_bill_payments_insert on public.vendor_bill_payments;
-- drop policy if exists vendor_bill_payments_update on public.vendor_bill_payments;
-- drop policy if exists vendor_bill_payments_delete on public.vendor_bill_payments;
-- drop policy if exists vendor_bill_payments_write on public.vendor_bill_payments;
-- create policy vendor_bill_payments_select on public.vendor_bill_payments
--   for select to authenticated
--   using ((EXISTS ( SELECT 1 FROM vendor_bills vb WHERE ((vb.id = vendor_bill_payments.vendor_bill_id) AND (vb.org_id = current_org_id())))));
-- create policy vendor_bill_payments_write on public.vendor_bill_payments
--   for all to authenticated
--   using ((EXISTS ( SELECT 1 FROM vendor_bills vb WHERE ((vb.id = vendor_bill_payments.vendor_bill_id) AND (vb.org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'accounting'::text]))))))
--   with check ((EXISTS ( SELECT 1 FROM vendor_bills vb WHERE ((vb.id = vendor_bill_payments.vendor_bill_id) AND (vb.org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'accounting'::text]))))));
--
-- -- vendor_bills
-- drop policy if exists vendor_bills_select on public.vendor_bills;
-- drop policy if exists vendor_bills_insert on public.vendor_bills;
-- drop policy if exists vendor_bills_update on public.vendor_bills;
-- drop policy if exists vendor_bills_delete on public.vendor_bills;
-- drop policy if exists vendor_bills_write on public.vendor_bills;
-- create policy vendor_bills_select on public.vendor_bills
--   for select to authenticated
--   using ((org_id = current_org_id()));
-- create policy vendor_bills_write on public.vendor_bills
--   for all to authenticated
--   using (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'accounting'::text]))))
--   with check (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'accounting'::text]))));
--
-- -- vendors
-- drop policy if exists vendors_select on public.vendors;
-- drop policy if exists vendors_insert on public.vendors;
-- drop policy if exists vendors_update on public.vendors;
-- drop policy if exists vendors_delete on public.vendors;
-- drop policy if exists vendors_write on public.vendors;
-- create policy vendors_select on public.vendors
--   for select to authenticated
--   using ((org_id = current_org_id()));
-- create policy vendors_write on public.vendors
--   for all to authenticated
--   using (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text, 'accounting'::text]))))
--   with check (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text, 'accounting'::text]))));
--
-- -- warehouse_locations
-- drop policy if exists warehouse_locations_select on public.warehouse_locations;
-- drop policy if exists warehouse_locations_insert on public.warehouse_locations;
-- drop policy if exists warehouse_locations_update on public.warehouse_locations;
-- drop policy if exists warehouse_locations_delete on public.warehouse_locations;
-- drop policy if exists warehouse_locations_write on public.warehouse_locations;
-- create policy warehouse_locations_select on public.warehouse_locations
--   for select to authenticated
--   using ((org_id = current_org_id()));
-- create policy warehouse_locations_write on public.warehouse_locations
--   for all to authenticated
--   using (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))))
--   with check (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))));
--
-- -- warehouses
-- drop policy if exists warehouses_select on public.warehouses;
-- drop policy if exists warehouses_insert on public.warehouses;
-- drop policy if exists warehouses_update on public.warehouses;
-- drop policy if exists warehouses_delete on public.warehouses;
-- drop policy if exists warehouses_write on public.warehouses;
-- create policy warehouses_select on public.warehouses
--   for select to authenticated
--   using ((org_id = current_org_id()));
-- create policy warehouses_write on public.warehouses
--   for all to authenticated
--   using (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))))
--   with check (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))));
--
-- -- work_assignments
-- drop policy if exists work_assignments_select on public.work_assignments;
-- drop policy if exists work_assignments_insert on public.work_assignments;
-- drop policy if exists work_assignments_update on public.work_assignments;
-- drop policy if exists work_assignments_delete on public.work_assignments;
-- drop policy if exists work_assignments_write on public.work_assignments;
-- create policy work_assignments_select on public.work_assignments
--   for select to authenticated
--   using ((org_id = current_org_id()));
-- create policy work_assignments_write on public.work_assignments
--   for all to authenticated
--   using (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))))
--   with check (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))));
--
-- -- workforce_members
-- drop policy if exists workforce_members_select on public.workforce_members;
-- drop policy if exists workforce_members_insert on public.workforce_members;
-- drop policy if exists workforce_members_update on public.workforce_members;
-- drop policy if exists workforce_members_delete on public.workforce_members;
-- drop policy if exists workforce_members_write on public.workforce_members;
-- create policy workforce_members_select on public.workforce_members
--   for select to authenticated
--   using ((org_id = current_org_id()));
-- create policy workforce_members_write on public.workforce_members
--   for all to authenticated
--   using (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))))
--   with check (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))));
--
-- -- workforce_team_members
-- drop policy if exists workforce_team_members_select on public.workforce_team_members;
-- drop policy if exists workforce_team_members_insert on public.workforce_team_members;
-- drop policy if exists workforce_team_members_update on public.workforce_team_members;
-- drop policy if exists workforce_team_members_delete on public.workforce_team_members;
-- drop policy if exists workforce_team_members_write on public.workforce_team_members;
-- create policy workforce_team_members_select on public.workforce_team_members
--   for select to authenticated
--   using ((org_id = current_org_id()));
-- create policy workforce_team_members_write on public.workforce_team_members
--   for all to authenticated
--   using (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))))
--   with check (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))));
--
-- -- workforce_teams
-- drop policy if exists workforce_teams_select on public.workforce_teams;
-- drop policy if exists workforce_teams_insert on public.workforce_teams;
-- drop policy if exists workforce_teams_update on public.workforce_teams;
-- drop policy if exists workforce_teams_delete on public.workforce_teams;
-- drop policy if exists workforce_teams_write on public.workforce_teams;
-- create policy workforce_teams_select on public.workforce_teams
--   for select to authenticated
--   using ((org_id = current_org_id()));
-- create policy workforce_teams_write on public.workforce_teams
--   for all to authenticated
--   using (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))))
--   with check (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'ops'::text]))));
--
-- Part 2 rollback: revert initplan rewraps to original predicates.
--
-- -- idempotency_keys
-- drop policy if exists idempotency_keys_select on public.idempotency_keys;
-- create policy idempotency_keys_select on public.idempotency_keys
--   for select to authenticated
--   using (((org_id = current_org_id()) AND (user_id = auth.uid())));
--
-- -- notifications
-- drop policy if exists notifications_self_select on public.notifications;
-- create policy notifications_self_select on public.notifications
--   for select to authenticated
--   using (((org_id = current_org_id()) AND (recipient_user_id = auth.uid())));
-- drop policy if exists notifications_self_update on public.notifications;
-- create policy notifications_self_update on public.notifications
--   for update to authenticated
--   using (((org_id = current_org_id()) AND (recipient_user_id = auth.uid())))
--   with check (((org_id = current_org_id()) AND (recipient_user_id = auth.uid())));
--
-- -- profiles
-- drop policy if exists profiles_self_select on public.profiles;
-- create policy profiles_self_select on public.profiles
--   for select to authenticated
--   using ((user_id = auth.uid()));
-- drop policy if exists profiles_self_update on public.profiles;
-- create policy profiles_self_update on public.profiles
--   for update to authenticated
--   using ((user_id = auth.uid()))
--   with check ((user_id = auth.uid()));
--
-- ============================================================================
