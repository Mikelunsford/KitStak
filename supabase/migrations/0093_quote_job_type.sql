-- ============================================================================
-- Migration: 0093_quote_job_type.sql
-- Wave: 12
-- Phase: 3PL commercial pivot, Phase A3 (Quote integration)
-- Closes: threads a 3PL job type from a quote onto the project it converts to,
--   so "a won quote becomes a project of the right type" per
--   03-workspace/specs/2026-06-04-3pl-commercial-pivot-and-wms-pillar-plan.md
--   (Phase A3, section 7, Body A). Two changes:
--     1) an additive nullable quotes.job_type_id (spine -> spine FK to the
--        sales job_types catalog from 0013); the SPA sets it when a job
--        template is applied to the quote.
--     2) a forward redefinition of convert_quote_to_project (last defined in
--        0044) that copies that job_type_id onto the new project. projects
--        already carries job_type_id (0016), so no project-side DDL.
-- Date: 2026-06-13
--
-- DOWN MIGRATION (operator-only; not auto-run):
--   -- 1) Restore the 0044 convert_quote_to_project body (drops the job_type
--   --    carryover). Operator copies the function verbatim from migration 0044.
--   -- 2) Drop the column.
--   alter table public.quotes drop column if exists job_type_id;
--
-- Constitutional alignment:
--   Money rules        Untouched. No _cents column added; the line-item
--                      carryover math is unchanged from 0044.
--   RLS rules          quotes keeps its existing Pattern A policies; a nullable
--                      column inherits the table grants, no policy change.
--                      job_types (0013) is the spine sales catalog, already
--                      readable in-org. The SECURITY DEFINER RPC keeps the
--                      0041 4-arg cross-tenant guard (NOT_FOUND, never 403).
--   Audit rules        Untouched. The convert path's quote UPDATE still fires
--                      trg_audit_quotes_state; the project INSERT carries the
--                      new column inside the existing project audit trigger.
--                      No new trigger.
--   Migration rules    Forward-only. DDL is idempotent (add-column-if-not-
--                      exists, create-or-replace function). Does NOT edit 0044;
--                      it redefines the function forward.
--   Capabilities       Untouched. Setting job_type on a quote rides
--                      quotes.quote.write; conversion rides
--                      quotes.convert_to_project. No new capability.
--   State machine      Untouched. Quote and project FSMs are unchanged.
--   Out of scope       Template -> quote-line expansion is SPA-thin over the
--                      existing quote-line CRUD (no DDL). The
--                      source_job_template_id breadcrumb and template
--                      snapshotting land in Phase A4.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Additive nullable job type on quotes. Spine -> spine FK to job_types
--    (0013). ON DELETE SET NULL so removing a job type never blocks; the
--    quote simply loses its tag. Nullable: spine quotes without a 3PL job
--    type leave it null and behave exactly as before.
-- ---------------------------------------------------------------------------

alter table public.quotes
  add column if not exists job_type_id uuid
    references public.job_types(id) on delete set null;

comment on column public.quotes.job_type_id is
  'Optional 3PL job type (Wave 12 / A3). Set when a job template is applied to the quote; convert_quote_to_project carries it onto the project. Nullable; spine quotes without a 3PL job type leave it null.';

-- ---------------------------------------------------------------------------
-- 2) Redefine convert_quote_to_project (last defined in 0044) to also copy
--    quotes.job_type_id onto the new project. The body is the 0044 body
--    verbatim except for: the v_job_type_id declaration, the extra SELECT
--    target, and the extra projects INSERT column/value. The 0044 line-item
--    carryover (ON CONFLICT DO NOTHING) and the 0041 cross-tenant guard are
--    preserved unchanged.
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
  v_job_type_id uuid;
begin
  select org_id, state, converted_to_project_id, customer_id,
         currency_code, coalesce(title, 'Quote ' || number),
         job_type_id
    into v_org_id, v_state, v_existing, v_customer_id, v_currency, v_name,
         v_job_type_id
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
    job_type_id,
    state, currency_code,
    created_by, updated_by
  ) values (
    v_org_id, v_number, v_name, v_customer_id, p_quote_id,
    v_job_type_id,
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
  'Redefined in 0093 to also copy quotes.job_type_id onto the new project so a won 3PL quote becomes a project of the right type (Wave 12 / A3). Preserves the 0044 line-item carryover and the 0041 4-arg cross-tenant guard.';
