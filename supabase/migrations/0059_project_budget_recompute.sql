-- ============================================================================
-- Migration: 0059_project_budget_recompute.sql
-- Wave: 9
-- Phase: E2E smoke test follow-ups (Path D bug-fix bundle, PR-2)
-- Closes: F-Wave9-PROJECT-BUDGET-RECOMPUTE-01 (B4 from 2026-05-21 E2E smoke).
-- Date: 2026-05-21
--
-- DOWN MIGRATION (operator-only; not auto-run):
--   -- 1. Drop the recompute trigger on project_line_items.
--   drop trigger if exists project_line_items_recompute on public.project_line_items;
--   drop function if exists public.trg_project_line_items_recompute();
--
--   -- 2. Drop the recompute helper.
--   drop function if exists public.recompute_project_totals(uuid);
--
--   -- 3. Restore the prior convert_quote_to_project body verbatim from
--   --    0044_project_line_items.sql lines 308-405 (without the recompute
--   --    call). Operator must re-issue the CREATE OR REPLACE FUNCTION block
--   --    in full; we do not inline the entire prior body here. Backfilled
--   --    projects.budget_cents values stay (do not re-zero historical rows).
--
-- Constitutional alignment:
--   Money rules        Untouched at the schema level. budget_cents,
--                      unit_price_cents, quantity, and discount_percent stay
--                      BIGINT cents / numeric with the existing _cents suffix.
--                      The sum is integer arithmetic on a BIGINT column
--                      (round(quantity * unit_price_cents * (1 -
--                      discount_percent/100))::bigint) mirroring the formula
--                      already used in 0045_convert_project_to_invoice.sql
--                      lines 147-149. No floating-point storage; the
--                      intermediate cast to numeric is identical to the
--                      pattern accepted in PR #45.
--   RLS rules          Untouched. recompute_project_totals is SECURITY
--                      DEFINER (mirroring 0019 recompute_invoice_paid and
--                      0017 recompute_quote_totals); writes via the
--                      table-owner identity. No policy change.
--   Audit rules        budget_cents is a derived total, not a state change.
--                      No audit_log row is emitted for the recompute itself,
--                      consistent with recompute_quote_totals (0017) and
--                      recompute_invoice_paid (0019/0058). The existing
--                      project audit trigger (audit_projects_state from
--                      0017) fires AFTER UPDATE OF state on projects and is
--                      unaffected because we update budget_cents, not state.
--   Migration rules    Forward-only. Idempotent: CREATE OR REPLACE FUNCTION
--                      for the recompute helper and for convert_quote_to_project;
--                      DROP TRIGGER IF EXISTS + CREATE TRIGGER for the new
--                      project_line_items recompute trigger. Backfill DO-block
--                      is a no-op on re-run because the recompute writes the
--                      same value the second time.
--   State machine     Untouched. projects.state is unchanged.
--
-- Background (B4 from the 2026-05-21 E2E smoke walk):
--   Operator's smoke walk converted quote SMOKE-001 to project
--   PRJ-20260521-EA8FA139. The project detail page rendered
--   "Budget: $0.00" even though the source quote total was $5,000 and the
--   project_line_items rows carried the correct unit_price_cents and
--   quantity.
--
--   Root cause: convert_quote_to_project in 0044_project_line_items.sql
--   (lines 308-405) INSERTs into public.projects (lines 354-363) carrying
--   `org_id, number, name, customer_id, source_quote_id, state,
--   currency_code, created_by, updated_by`. It never sets `budget_cents`.
--   The column defaults to 0 (declared 0016_sales_projects.sql line 53).
--   project_line_items are copied (lines 370-394) but the project header
--   reads `projects.budget_cents` directly
--   (apps/web/src/pages/3pl-operations/projects/ProjectDetailPage.tsx:213)
--   so the operator sees $0.00.
--
--   Schema note: project_line_items has NO `deleted_at` column (verified
--   against 0044 lines 121-139). The recompute predicate does NOT include
--   `deleted_at is null` — there is no soft-delete on this table, only
--   hard delete via the audit trigger's DELETE branch (0044:245-260).
--   This deviates from the PR prompt; documented here so future readers
--   understand the absence.
--
--   Schema note 2: project_line_items has NO GENERATED `line_total_cents`
--   column (verified against 0044 lines 121-139). The recompute computes
--   the per-line total inline from quantity, unit_price_cents, and
--   discount_percent, mirroring the formula used in
--   0045_convert_project_to_invoice.sql lines 147-149.
--
-- Investigation: 03-workspace/journal/2026-05-21-e2e-smoke-investigation.md
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) recompute_project_totals: re-derives projects.budget_cents from the
--    current project_line_items. Pure BIGINT arithmetic.
--
--    Per-line formula (mirrors 0045:147-149 invoice conversion):
--      gross_cents    = round(quantity * unit_price_cents)
--      discount_cents = round(quantity * unit_price_cents * discount_percent / 100)
--      line_total     = gross_cents - discount_cents
--
--    SUM across all lines (no soft-delete predicate; table has no
--    deleted_at column) gives the project budget.
-- ---------------------------------------------------------------------------

create or replace function public.recompute_project_totals(p_project_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_budget bigint;
begin
  select coalesce(sum(
    round((pli.quantity * pli.unit_price_cents)::numeric)::bigint
    - round((pli.quantity * pli.unit_price_cents * pli.discount_percent / 100.0))::bigint
  ), 0)
    into v_budget
    from public.project_line_items pli
   where pli.project_id = p_project_id;

  update public.projects
     set budget_cents = v_budget,
         updated_at = now()
   where id = p_project_id;
end;
$$;

revoke execute on function public.recompute_project_totals(uuid) from public, anon;
grant execute on function public.recompute_project_totals(uuid)
  to authenticated, service_role;

comment on function public.recompute_project_totals(uuid) is
  'Recomputes projects.budget_cents by summing per-line totals from project_line_items (quantity * unit_price_cents minus discount). SECURITY DEFINER. Called by convert_quote_to_project and by the project_line_items_recompute trigger.';

-- ---------------------------------------------------------------------------
-- 2) Trigger trg_project_line_items_recompute: fires AFTER INSERT / UPDATE /
--    DELETE on project_line_items so the projects.budget_cents header stays
--    in sync with operator edits to lines.
--
--    Mirrors the DELETE-vs-INSERT/UPDATE branch shape from
--    0019_invoicing_payments.sql:181-204 (trg_payment_allocations_recompute).
-- ---------------------------------------------------------------------------

create or replace function public.trg_project_line_items_recompute()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project_id uuid;
begin
  if tg_op = 'DELETE' then
    v_project_id := old.project_id;
  else
    v_project_id := new.project_id;
  end if;

  perform public.recompute_project_totals(v_project_id);

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke execute on function public.trg_project_line_items_recompute() from public, anon;

drop trigger if exists project_line_items_recompute on public.project_line_items;
create trigger project_line_items_recompute
  after insert or update or delete on public.project_line_items
  for each row execute function public.trg_project_line_items_recompute();

-- ---------------------------------------------------------------------------
-- 3) Redefine convert_quote_to_project to call recompute_project_totals
--    after the project_line_items INSERT but before the quotes UPDATE so the
--    project header reflects the budget by the time the RPC returns.
--
--    The signature (uuid, uuid, uuid, text) is preserved exactly from
--    0044_project_line_items.sql:308 so the quotes-api convertToProject
--    handler's rpc() call does not need to change. The body is otherwise
--    byte-identical to the 0044 version with the single `perform
--    public.recompute_project_totals(v_project_id);` line inserted between
--    the project_line_items insert and the quotes update.
-- ---------------------------------------------------------------------------

create or replace function public.convert_quote_to_project(
  p_quote_id uuid,
  p_actor uuid,
  p_caller_org_id uuid,
  p_project_number text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_state text;
  v_existing uuid;
  v_project_id uuid;
  v_customer_id uuid;
  v_currency text;
  v_name text;
  v_number text;
begin
  select org_id, state, converted_to_project_id, customer_id,
         currency_code, coalesce(title, 'Quote ' || number)
    into v_org_id, v_state, v_existing, v_customer_id, v_currency, v_name
    from public.quotes
   where id = p_quote_id;

  -- Cross-tenant or missing quote: surface as NOT_FOUND so the caller
  -- cannot distinguish. Constitutional 404, never 403 / 409.
  if v_org_id is null or v_org_id <> p_caller_org_id then
    raise exception 'NOT_FOUND: quote not found' using errcode = 'P0001';
  end if;

  if v_state = 'project_pending' and v_existing is not null then
    return v_existing;
  end if;

  if v_state <> 'approved' then
    raise exception 'STATE_CONFLICT: quote not in approved state (was %)', v_state
      using errcode = 'P0001';
  end if;

  v_number := coalesce(p_project_number,
    'PRJ-' || to_char(now(), 'YYYYMMDD') || '-' ||
    substr(replace(p_quote_id::text, '-', ''), 1, 8));

  insert into public.projects (
    org_id, number, name, customer_id, source_quote_id,
    state, currency_code,
    created_by, updated_by
  ) values (
    v_org_id, v_number, v_name, v_customer_id, p_quote_id,
    'pending', v_currency,
    p_actor, p_actor
  )
  returning id into v_project_id;

  -- Carryover: copy every quote_line_item to project_line_items. The
  -- discount_bps -> discount_percent translation divides by 100 (bps is
  -- basis points; percent is hundredths). unit_price_cents and quantity
  -- carry over byte-for-byte (quantity_e3 -> numeric quantity by /1000).
  -- ON CONFLICT DO NOTHING guards against partial-retry duplicates.
  insert into public.project_line_items (
    org_id, project_id, item_id, source_quote_line_item_id,
    name, description, quantity, unit_price_cents,
    tax_rate_id, discount_percent, position,
    created_by, updated_by
  )
  select
    v_org_id,
    v_project_id,
    qli.item_id,
    qli.id,
    qli.name,
    qli.description,
    (qli.quantity_e3::numeric / 1000.0),
    qli.unit_price_cents,
    qli.tax_id,
    (qli.discount_bps::numeric / 100.0),
    qli.position,
    p_actor,
    p_actor
  from public.quote_line_items qli
  where qli.quote_id = p_quote_id
  on conflict (project_id, source_quote_line_item_id)
    where source_quote_line_item_id is not null
    do nothing;

  -- B4 fix (0059): recompute projects.budget_cents from the carried-over
  -- lines so the project header reflects the correct budget by the time the
  -- RPC returns. Without this the SPA detail page renders "Budget: $0.00".
  -- The recompute trigger on project_line_items also keeps the column
  -- fresh on subsequent line-item edits.
  perform public.recompute_project_totals(v_project_id);

  update public.quotes
     set state = 'project_pending',
         converted_to_project_id = v_project_id,
         updated_at = now(),
         updated_by = p_actor
   where id = p_quote_id;

  return v_project_id;
end;
$$;

revoke execute on function public.convert_quote_to_project(uuid, uuid, uuid, text)
  from public, anon;
grant execute on function public.convert_quote_to_project(uuid, uuid, uuid, text)
  to authenticated, service_role;

comment on function public.convert_quote_to_project(uuid, uuid, uuid, text) is
  'Redefined in 0059 to recompute projects.budget_cents after carrying line items. Preserves the 0044 signature and body otherwise byte-identical.';

-- ---------------------------------------------------------------------------
-- 4) Backfill: recompute budget_cents on every existing project that has at
--    least one project_line_item. Idempotent — re-running writes the same
--    value. Bounded by the EXISTS subquery so projects with no lines (and
--    therefore correctly $0 already) are skipped.
--
--    Audit log emission: this does NOT fire the audit_projects_state
--    trigger (which is AFTER UPDATE OF state, not OF budget_cents). No
--    audit_log churn from the backfill, consistent with how other recompute
--    backfills run silently (e.g. recompute_quote_totals backfill in 0017).
-- ---------------------------------------------------------------------------

do $$
declare
  v_row record;
begin
  for v_row in
    select p.id
      from public.projects p
     where exists (
       select 1
         from public.project_line_items pli
        where pli.project_id = p.id
     )
  loop
    perform public.recompute_project_totals(v_row.id);
  end loop;
end$$;
