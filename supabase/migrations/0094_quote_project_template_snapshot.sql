-- ============================================================================
-- Migration: 0094_quote_project_template_snapshot.sql
-- Wave: 12
-- Phase: 3PL commercial pivot, Phase A4 (Project conversion with template
--   snapshotting).
-- Closes: records which Job Builder template built a quote / project and freezes
--   that template onto the project at conversion, so later template edits never
--   rewrite a project's origin. Implements
--   03-workspace/specs/2026-06-04-3pl-commercial-pivot-and-wms-pillar-plan.md
--   (Phase A4, section 7, Body A: "On release, snapshot the template into the
--   run so later template edits do not rewrite history") at the project level,
--   and settles the A4 handoff in
--   03-workspace/specs/2026-06-13-3pl-a3-quote-integration-closeout-and-a4-handoff.md.
--   Three changes:
--     1) additive nullable quotes.source_job_template_id (spine -> 3PL add-on FK
--        to job_templates from 0091); the SPA sets it when a job template is
--        applied to the quote, alongside the 0093 job_type_id.
--     2) additive nullable projects.source_job_template_id (same FK) plus a
--        nullable projects.job_template_snapshot jsonb that freezes the source
--        template header and lines at conversion.
--     3) a forward redefinition of convert_quote_to_project (last defined in
--        0093) that copies source_job_template_id onto the new project and
--        builds the frozen snapshot. Same 4-arg signature; reads both the job
--        type and the template id from the in-org quote row (not parameters), so
--        the SECURITY DEFINER RPC cannot be used to inject a foreign template;
--        preserves the 0093 job-type carryover, the 0044 line-item carryover
--        (budget rolled up by the 0059 AFTER INSERT trigger), and the 0041
--        cross-tenant guard.
-- Date: 2026-06-13
--
-- DOWN MIGRATION (operator-only; not auto-run):
--   -- 1) Restore the 0093 convert_quote_to_project body (drops the template
--   --    carryover + snapshot). Operator copies the function verbatim from
--   --    migration 0093.
--   -- 2) Drop the columns.
--   alter table public.projects drop column if exists job_template_snapshot;
--   alter table public.projects drop column if exists source_job_template_id;
--   alter table public.quotes   drop column if exists source_job_template_id;
--
-- Constitutional alignment:
--   Money rules        Untouched. No _cents column added. The snapshot carries a
--                      frozen copy of job_template_lines.rate_cents inside jsonb
--                      (integer, never a float); no monetary math is performed.
--                      The line-item carryover + budget recompute math is
--                      unchanged from 0059.
--   RLS rules          quotes and projects keep their existing Pattern A
--                      policies; nullable columns inherit the table grants, no
--                      policy change. job_templates (0091) is the 3PL add-on
--                      table, already org-scoped. The SECURITY DEFINER RPC keeps
--                      the 0041 4-arg cross-tenant guard (NOT_FOUND, never 403);
--                      the snapshot SELECT is org-scoped (jt.org_id = v_org_id)
--                      so a foreign template can never be frozen onto a project.
--                      source_job_template_id is validated in-org by quotes-api
--                      (assertRefInOrg, 404 not 403) at apply time.
--   Audit rules        Untouched. No new entity_type. The convert path's project
--                      INSERT still fires the project audit trigger (created);
--                      the new columns ride that one INSERT. The quote UPDATE
--                      still fires trg_audit_quotes_state. No new trigger.
--   Migration rules    Forward-only. DDL is idempotent (add-column-if-not-
--                      exists, create-or-replace function). Does NOT edit 0091 /
--                      0093; it redefines the function forward.
--   Capabilities       Untouched. Setting source_job_template_id on a quote
--                      rides quotes.quote.write; conversion rides
--                      quotes.convert_to_project. No new capability.
--   State machine      Untouched. Quote and project FSMs are unchanged.
--   Spine references   The two source_job_template_id columns are the spine ->
--                      add-on FK A3 deliberately deferred. ON DELETE SET NULL so
--                      deleting a template never blocks conversion nor orphans a
--                      project: the breadcrumb simply nulls while the frozen
--                      snapshot on the project stays as the historical record.
--   Out of scope       The A6 job_runs template snapshot (job_template_id frozen
--                      at run creation) is a separate, lighter snapshot and lands
--                      with the runs phase. Supply Plan (A5), Job Runs (A6), and
--                      Billing Review / Profitability (A7) are later A-phases.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Additive nullable source template breadcrumb on quotes. Spine -> 3PL
--    add-on FK to job_templates (0091). ON DELETE SET NULL so removing a
--    template never blocks; the quote simply loses its breadcrumb. Nullable:
--    spine quotes built without a job template leave it null.
-- ---------------------------------------------------------------------------

alter table public.quotes
  add column if not exists source_job_template_id uuid
    references public.job_templates(id) on delete set null;

comment on column public.quotes.source_job_template_id is
  'Optional Job Builder template that populated this quote (Wave 12 / A4). Set when a job template is applied to the quote, alongside job_type_id; convert_quote_to_project carries it onto the project. Nullable; spine quotes built without a template leave it null.';

-- ---------------------------------------------------------------------------
-- 2) Additive nullable source template breadcrumb plus frozen snapshot on
--    projects. source_job_template_id mirrors the quote column (same FK, same
--    ON DELETE SET NULL). job_template_snapshot freezes the source template
--    header and lines at conversion so later template edits never rewrite this
--    project's origin (the BOM-versioning rationale, applied at project level).
-- ---------------------------------------------------------------------------

alter table public.projects
  add column if not exists source_job_template_id uuid
    references public.job_templates(id) on delete set null;

comment on column public.projects.source_job_template_id is
  'Optional Job Builder template this project was built from (Wave 12 / A4), carried from the quote by convert_quote_to_project. Nullable; ON DELETE SET NULL keeps the breadcrumb soft while job_template_snapshot preserves the frozen record.';

alter table public.projects
  add column if not exists job_template_snapshot jsonb;

comment on column public.projects.job_template_snapshot is
  'Frozen copy of the source Job Builder template (header plus lines) captured by convert_quote_to_project at conversion (Wave 12 / A4), so later template edits never rewrite this project''s origin. Null when the project did not originate from a templated quote. Shape authored here and mirrored by JobTemplateSnapshotSchema in the sales side-car canon.';

-- ---------------------------------------------------------------------------
-- 3) Redefine convert_quote_to_project (last defined in 0093) to also copy
--    quotes.source_job_template_id onto the new project and freeze the source
--    template into projects.job_template_snapshot. The body is the 0093 body
--    verbatim except for: the two new declarations, the extra SELECT targets,
--    the org-scoped snapshot build, and the extra projects INSERT
--    columns/values. The 0093 job-type carryover, the 0044 line-item carryover
--    (budget rolled up by the 0059 trigger), and the 0041 cross-tenant guard
--    are preserved.
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
  v_source_job_template_id uuid;
  v_template_snapshot jsonb;
begin
  select org_id, state, converted_to_project_id, customer_id,
         currency_code, coalesce(title, 'Quote ' || number),
         job_type_id, source_job_template_id
    into v_org_id, v_state, v_existing, v_customer_id, v_currency, v_name,
         v_job_type_id, v_source_job_template_id
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

  -- A4: freeze the source job template (header plus lines) onto the project so
  -- later template edits never rewrite this project's origin. Org-scoped so the
  -- SECURITY DEFINER body can only ever snapshot an in-org template, even though
  -- source_job_template_id is already validated in-org at apply time. Null when
  -- the quote did not originate from a template (or the template was deleted,
  -- in which case ON DELETE SET NULL already nulled the pointer).
  if v_source_job_template_id is not null then
    select jsonb_build_object(
      'snapshot_at', now(),
      'template_id', jt.id,
      'template_number', jt.template_number,
      'name', jt.name,
      'variant', jt.variant,
      'job_type_id', jt.job_type_id,
      'default_bom_item_id', jt.default_bom_item_id,
      'status', jt.status,
      'notes', jt.notes,
      'lines', coalesce((
        select jsonb_agg(
                 jsonb_build_object(
                   'id', jtl.id,
                   'line_kind', jtl.line_kind,
                   'item_id', jtl.item_id,
                   'vas_id', jtl.vas_id,
                   'name', jtl.name,
                   'quantity', jtl.quantity,
                   'rate_cents', jtl.rate_cents,
                   'rate_uom', jtl.rate_uom,
                   'currency_code', jtl.currency_code,
                   'position', jtl.position
                 )
                 order by jtl.position, jtl.id
               )
          from public.job_template_lines jtl
         where jtl.template_id = jt.id
           and jtl.org_id = v_org_id
      ), '[]'::jsonb)
    )
    into v_template_snapshot
    from public.job_templates jt
   where jt.id = v_source_job_template_id
     and jt.org_id = v_org_id;
  end if;

  insert into public.projects (
    org_id, number, name, customer_id, source_quote_id,
    job_type_id, source_job_template_id, job_template_snapshot,
    state, currency_code,
    created_by, updated_by
  ) values (
    v_org_id, v_number, v_name, v_customer_id, p_quote_id,
    v_job_type_id, v_source_job_template_id, v_template_snapshot,
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
  -- projects.budget_cents is rolled up by the 0059 AFTER INSERT trigger on
  -- project_line_items (trg_project_line_items_recompute), which fires per row
  -- before this statement completes, so the header reflects the budget by the
  -- time the RPC returns. Preserved verbatim from 0093 (no explicit in-RPC
  -- recompute perform).

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
  'Redefined in 0094 to also copy quotes.source_job_template_id onto the new project and freeze the source Job Builder template (header plus lines) into projects.job_template_snapshot, so later template edits never rewrite a project''s origin (Wave 12 / A4). Preserves the 0093 job-type carryover, the 0044 line-item carryover (budget rolled up by the 0059 trigger), and the 0041 4-arg cross-tenant guard.';
