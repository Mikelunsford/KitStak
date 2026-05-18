-- ============================================================================
-- Migration: 0015_sales_quote_versions_approvals_templates.sql
-- Wave: 2
-- Phase: Sales chassis (quote_versions, quote_approvals, quote_templates)
-- Closes: R-W2-QUOTE-VERSIONS-01, R-W2-QUOTE-APPROVALS-01,
--         R-W2-QUOTE-TEMPLATES-01
-- Date: 2026-05-18
-- DOWN MIGRATION: operator-only. Drop quote_templates, quote_approvals,
--   quote_versions in reverse dependency order. Not auto-run.
--
-- Constitutional alignment:
--   Audit rules        quote_versions are append-only snapshots. The version
--                      trigger is SECURITY DEFINER so versions are written
--                      on every approved-or-submitted transition.
--   RLS rules          Pattern B parent-join on quote_versions and
--                      quote_approvals; Pattern A on quote_templates.
--   Money rules        Snapshot money in cents in payload_jsonb.
--   Migration rules    Forward-only.
--
-- TODO (follow-on slot, when Agent F ships generic attachments table):
--   create or replace view public.quote_attachments as
--     select * from public.attachments where parent_type = 'quote';
-- ============================================================================

-- ---------------------------------------------------------------------------
-- quote_versions: append-only snapshots of the full quote payload at every
-- approved-or-submitted transition. Pattern B.
-- ---------------------------------------------------------------------------

create table if not exists public.quote_versions (
  id uuid primary key default uuid_generate_v4(),
  quote_id uuid not null references public.quotes(id) on delete cascade,
  version_number integer not null,
  triggered_state text not null,
  payload_jsonb jsonb not null,
  created_at timestamptz not null default now(),
  created_by uuid,
  unique (quote_id, version_number)
);

create index if not exists quote_versions_quote_idx
  on public.quote_versions (quote_id, version_number desc);

alter table public.quote_versions enable row level security;

drop policy if exists quote_versions_select on public.quote_versions;
create policy quote_versions_select on public.quote_versions
  for select to authenticated
  using (
    exists (
      select 1 from public.quotes q
       where q.id = quote_versions.quote_id
         and q.org_id = public.current_org_id()
    )
  );

-- No INSERT/UPDATE/DELETE policy. Service-role + SECURITY DEFINER trigger only.

-- ---------------------------------------------------------------------------
-- snapshot_quote_version: SECURITY DEFINER helper invoked by the state-change
-- trigger in 0017. Builds the version payload from quote + line items and
-- inserts a row.
-- ---------------------------------------------------------------------------

create or replace function public.snapshot_quote_version(
  p_quote_id uuid,
  p_triggered_state text,
  p_actor uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next_version integer;
  v_quote jsonb;
  v_lines jsonb;
begin
  select coalesce(max(version_number), 0) + 1 into v_next_version
    from public.quote_versions
   where quote_id = p_quote_id;

  select to_jsonb(q.*) into v_quote
    from public.quotes q
   where q.id = p_quote_id;

  select coalesce(jsonb_agg(to_jsonb(l.*) order by l.position), '[]'::jsonb)
    into v_lines
    from public.quote_line_items l
   where l.quote_id = p_quote_id;

  insert into public.quote_versions (
    quote_id, version_number, triggered_state, payload_jsonb,
    created_by
  ) values (
    p_quote_id, v_next_version, p_triggered_state,
    jsonb_build_object('quote', v_quote, 'line_items', v_lines),
    p_actor
  );
end;
$$;

revoke execute on function public.snapshot_quote_version(uuid, text, uuid)
  from public, anon;
grant execute on function public.snapshot_quote_version(uuid, text, uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- quote_approvals: optional approval ledger for quotes that require sign-off.
-- Pattern B.
-- ---------------------------------------------------------------------------

create table if not exists public.quote_approvals (
  id uuid primary key default uuid_generate_v4(),
  quote_id uuid not null references public.quotes(id) on delete cascade,
  requested_by uuid,
  requested_at timestamptz not null default now(),
  approver_id uuid,
  decision text not null default 'pending'
    check (decision in ('pending', 'approved', 'rejected', 'cancelled')),
  decided_at timestamptz,
  reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists quote_approvals_quote_idx
  on public.quote_approvals (quote_id, requested_at desc);

alter table public.quote_approvals enable row level security;

drop policy if exists quote_approvals_select on public.quote_approvals;
create policy quote_approvals_select on public.quote_approvals
  for select to authenticated
  using (
    exists (
      select 1 from public.quotes q
       where q.id = quote_approvals.quote_id
         and q.org_id = public.current_org_id()
    )
  );

drop policy if exists quote_approvals_write on public.quote_approvals;
create policy quote_approvals_write on public.quote_approvals
  for all to authenticated
  using (
    exists (
      select 1 from public.quotes q
       where q.id = quote_approvals.quote_id
         and q.org_id = public.current_org_id()
         and public.current_user_role() in ('org_owner', 'org_admin', 'sales', 'accounting')
    )
  )
  with check (
    exists (
      select 1 from public.quotes q
       where q.id = quote_approvals.quote_id
         and q.org_id = public.current_org_id()
         and public.current_user_role() in ('org_owner', 'org_admin', 'sales', 'accounting')
    )
  );

-- ---------------------------------------------------------------------------
-- quote_templates: per-org saved quote templates. Pattern A. Stores a
-- skeleton line-item array and default footer copy.
-- ---------------------------------------------------------------------------

create table if not exists public.quote_templates (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  code text not null,
  name text not null,
  description text,
  default_currency_code text references public.currencies(code),
  default_tax_id uuid references public.taxes(id) on delete set null,
  default_payment_method_id uuid references public.payment_methods(id) on delete set null,
  line_items_jsonb jsonb not null default '[]'::jsonb,
  footer_text text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  deleted_at timestamptz,
  unique (org_id, code)
);

alter table public.quote_templates enable row level security;

drop policy if exists quote_templates_select on public.quote_templates;
create policy quote_templates_select on public.quote_templates
  for select to authenticated
  using (org_id = public.current_org_id());

drop policy if exists quote_templates_write on public.quote_templates;
create policy quote_templates_write on public.quote_templates
  for all to authenticated
  using (
    org_id = public.current_org_id()
    and public.current_user_role() in ('org_owner', 'org_admin', 'sales', 'accounting')
  )
  with check (
    org_id = public.current_org_id()
    and public.current_user_role() in ('org_owner', 'org_admin', 'sales', 'accounting')
  );
