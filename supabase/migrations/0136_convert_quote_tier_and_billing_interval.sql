-- ============================================================================
-- Migration: 0136_convert_quote_tier_and_billing_interval.sql
-- Wave: Native tiered quoting (ADR 0004 unit 5) + recurring billing (ADR 0005
--   Phase 1b, quote->project half)
-- Phase: convert_quote_to_project gains an accepted-tier argument and carries the
--   line billing_interval onto the project. Two ADRs touch the same RPC, so they
--   land in one redefine rather than rewriting it twice:
--     ADR 0004 unit 5  A tiered quote is many offers under one number; only the
--                      accepted tier becomes the project. p_tier_id names it, and
--                      only that tier's lines copy. A non-tiered quote passes null
--                      and converts exactly as before (its lines are all tier_id
--                      null). A foreign / cross-quote tier id raises NOT_FOUND.
--     ADR 0005 1b      billing_interval (0131, quote lines) now rides onto
--                      project_line_items so recurring revenue survives the
--                      conversion. A new project_line_items.billing_interval column
--                      mirrors the 0131 quote-line column. The convert_project_to_
--                      invoice half (invoice_line_items.billing_interval) is the
--                      remaining Phase 1b unit.
-- Closes: ADR 0004 unit 5 (convert accepted-tier selection) + ADR 0005 Phase 1b
--   quote->project billing_interval carry.
-- Date: 2026-06-24
--
-- DOWN MIGRATION (operator-only; forward-only repo, do not auto-apply):
--   Recreate the 0094 convert_quote_to_project(uuid, uuid, uuid, text) (no
--   p_tier_id, no billing_interval copy) and drop the 5-arg form with a new
--   forward migration, then:
--     alter table public.project_line_items drop column if exists billing_interval;
--   The copied billing_interval is forward-only data on new project lines; no
--   backfill is needed to revert.
--
-- Constitutional alignment:
--   Money rules        billing_interval is line metadata, not money; no _cents
--                      column and no math change (mirrors 0131). The existing cents
--                      carryover (quantity_e3/1000, discount_bps/100, unit_price
--                      verbatim) is unchanged, and projects.budget_cents is still
--                      rolled up by the 0059 trigger. No float introduced.
--   RLS rules          Unchanged. SECURITY DEFINER with SET search_path = public;
--                      the org gate (org_id = p_caller_org_id, else NOT_FOUND 404)
--                      and the approved-state guard are byte-identical to 0094. The
--                      new tier guard is also org-correct by construction (the tier
--                      must belong to the same quote, already org-gated). The
--                      additive project_line_items column inherits the 0044 RLS.
--   Audit rules        Untouched. The quote state move to project_pending still
--                      fires the audit trigger; project / line inserts carry no
--                      hand-written audit (the 0059 / project triggers own it).
--   Idempotency        Unchanged. The project_pending short-circuit returns the
--                      existing project, and the line copy keeps ON CONFLICT
--                      (project_id, source_quote_line_item_id) DO NOTHING, so a
--                      retry never double-copies.
--   Migration rules    Forward-only. The signature changes (a 5th arg), so the
--                      4-arg form is dropped and the 5-arg form created; both DDL
--                      steps are idempotent (DROP IF EXISTS, ADD COLUMN IF NOT
--                      EXISTS, CREATE OR REPLACE). No prior migration is edited.
--   Zod canon          ConvertQuoteToProjectRequest gains an optional tier_id and
--                      ProjectLineItem gains billing_interval in
--                      _shared/types/sales.ts and the apps/web mirror in the same
--                      PR; pnpm test:contract gates the byte-identical parity.
--   Grants             A fresh CREATE defaults to PUBLIC EXECUTE, so the new 5-arg
--                      form is explicitly locked to the post-0111 baseline (revoke
--                      from public, anon, authenticated; grant to service_role).
--                      The edge calls it via admin() (service_role).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- ADR 0005 Phase 1b: billing_interval on project lines (mirrors 0131 quote lines).
-- ---------------------------------------------------------------------------
alter table public.project_line_items
  add column if not exists billing_interval text not null default 'one_time'
    check (billing_interval in ('one_time', 'monthly'));

comment on column public.project_line_items.billing_interval is
  'How this project line is billed: one_time (default) or monthly (recurring). ADR 0005 Phase 1b, carried from the source quote line by convert_quote_to_project. Phase 1b also carries it onto invoice lines; Phase 2 adds the recurring-invoice generator.';

-- ---------------------------------------------------------------------------
-- ADR 0004 unit 5 + ADR 0005 Phase 1b: convert_quote_to_project gains p_tier_id
-- and carries billing_interval. The signature changes, so drop the 4-arg form and
-- create the 5-arg form (the rest of the body is byte-identical to 0094).
-- ---------------------------------------------------------------------------
drop function if exists public.convert_quote_to_project(uuid, uuid, uuid, text);

create or replace function public.convert_quote_to_project(
  p_quote_id uuid,
  p_actor uuid,
  p_caller_org_id uuid,
  p_project_number text default null,
  p_tier_id uuid default null
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

  -- ADR 0004: when an accepted tier is named it must belong to THIS quote
  -- (404 on a foreign / cross-quote tier, never a leak). Null means convert the
  -- non-tiered quote's lines as before.
  if p_tier_id is not null then
    if not exists (
      select 1 from public.quote_tiers
       where id = p_tier_id and quote_id = p_quote_id
    ) then
      raise exception 'NOT_FOUND: tier not found on quote' using errcode = 'P0001';
    end if;
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

  -- Carryover: copy the accepted tier's quote_line_items to project_line_items.
  -- The discount_bps -> discount_percent translation divides by 100 (bps is basis
  -- points; percent is hundredths). unit_price_cents and quantity carry over
  -- byte-for-byte (quantity_e3 -> numeric quantity by /1000). billing_interval
  -- (ADR 0005 Phase 1b) rides onto the project line. ON CONFLICT DO NOTHING guards
  -- against partial-retry duplicates.
  --
  -- ADR 0004: the tier filter selects the accepted tier's lines. p_tier_id null
  -- copies the lines with tier_id null, which for a non-tiered quote is every line
  -- (byte-identical to 0094); for a tiered quote it is only the unassigned lines,
  -- so a mixed all-tiers copy can never happen.
  insert into public.project_line_items (
    org_id, project_id, item_id, source_quote_line_item_id,
    name, description, quantity, unit_price_cents,
    tax_rate_id, discount_percent, position, billing_interval,
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
    qli.billing_interval,
    p_actor,
    p_actor
  from public.quote_line_items qli
  where qli.quote_id = p_quote_id
    and (
      (p_tier_id is null and qli.tier_id is null)
      or (p_tier_id is not null and qli.tier_id = p_tier_id)
    )
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

-- A fresh CREATE defaults to PUBLIC EXECUTE; lock the new 5-arg form to the
-- post-0111 baseline (service_role only). The edge invokes it via admin().
revoke execute on function public.convert_quote_to_project(uuid, uuid, uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.convert_quote_to_project(uuid, uuid, uuid, text, uuid)
  to service_role;

comment on function public.convert_quote_to_project(uuid, uuid, uuid, text, uuid) is
  'Converts an approved quote into a pending project (Sales). One atomic SECURITY DEFINER call: org-gated (NOT_FOUND 404 on a missing / cross-tenant quote), idempotent on re-run (returns the existing project), freezes the source job-template snapshot, and copies the accepted tier''s lines (ADR 0004 p_tier_id; null = the non-tiered quote''s lines) into project_line_items carrying billing_interval (ADR 0005 Phase 1b). A foreign tier id raises NOT_FOUND. budget_cents rolls up via the 0059 trigger.';
