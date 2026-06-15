-- ============================================================================
-- Migration: 0102_billing_reviews.sql
-- Wave: 12
-- Phase: 3PL commercial pivot, Phase A7 (Billing Review and Job Profitability),
--   step 1 of 3 (billing_reviews parent table plus the approve / cancel RPCs).
-- Closes: the money-out header from
--   03-workspace/specs/2026-06-14-3pl-a7-billing-profitability-handoff.md
--   (billing_reviews + the approve path) and the parent plan
--   03-workspace/specs/2026-06-04-3pl-commercial-pivot-and-wms-pillar-plan.md
--   (section 6.1 billing_reviews; section 7 Body A: A7). A billing_review is an
--   estimate-versus-actual check before invoicing. Approve creates a spine DRAFT
--   invoice with lines built from the account service rates and lands the review
--   in approved. BILL- numbering lands in 0103; the profitability view in 0104.
-- Date: 2026-06-14
--
-- DOWN MIGRATION (operator-only; not auto-run). Drop in reverse:
--   drop function if exists public.cancel_billing_review(uuid, uuid, uuid);
--   drop function if exists public.approve_billing_review(uuid, uuid, uuid, text);
--   drop trigger if exists audit_billing_reviews on public.billing_reviews;
--   drop trigger if exists billing_reviews_set_updated_at on public.billing_reviews;
--   drop function if exists public.trg_audit_billing_reviews();
--   drop function if exists public.trg_billing_reviews_set_updated_at();
--   drop policy if exists billing_reviews_write  on public.billing_reviews;
--   drop policy if exists billing_reviews_select on public.billing_reviews;
--   drop table if exists public.billing_reviews;
--   alter table public.audit_log drop constraint if exists audit_log_entity_type_check;
--   (operator restores the prior 0099 CHECK by hand if needed).
--   This down is ready-to-run only while no billing_review has yet approved in
--   production. Once approve has created a spine draft invoice, the invoice rows
--   persist on the spine independently (billing_reviews.invoice_id ON DELETE SET
--   NULL); reverting this migration does not delete those invoices.
--
-- Constitutional alignment:
--   Money rules        estimate_total_cents and actual_total_cents are BIGINT
--                      cents with the _cents suffix, nullable, snapshotted at
--                      approve. currency_code is snapshotted at approve. No
--                      floats. The approve RPC reuses recompute_invoice_totals
--                      (0018) for the draft invoice totals; it never reinvents
--                      invoice math.
--   RLS rules          Pattern A on creation. org_id references organizations
--                      ON DELETE CASCADE. Write gated to the 3PL commercial layer
--                      roles PLUS accounting ('org_owner','org_admin','ops',
--                      'sales','accounting'), because billing review is the
--                      finance surface (handoff decision: the rest of 3PL is the
--                      four-role set, billing adds accounting). Cross-tenant reads
--                      return 200 + []; the RPCs surface cross-tenant as NOT_FOUND
--                      (never 403).
--   Audit rules        billing_reviews is a rich FSM (draft / approved / invoiced
--                      / cancelled) so its trigger records from_state -> to_state
--                      on every status change plus created / deleted, via the
--                      central audit_append_state_change helper, mirroring
--                      trg_audit_job_runs (0098). The audit_log entity_type CHECK
--                      is extended via a guarded drop-then-add that re-adds the
--                      full 0099 list plus billing_review. Strict superset.
--   Migration rules    Forward-only. All DDL idempotent (IF EXISTS / IF NOT
--                      EXISTS, guarded constraint drop-then-add, CREATE OR
--                      REPLACE). Does not edit 0099.
--   State machine      billing_reviews.status text + CHECK. draft -> approved ->
--                      invoiced; draft|approved -> cancelled. approved is reached
--                      by approve_billing_review (it also creates the draft
--                      invoice); invoiced is a named-not-auto-reached state
--                      reserved for when the spine invoice is later sent. Paired
--                      <state>_at timestamps.
--   Spine references   job_run_id -> job_runs (ON DELETE SET NULL); project_id ->
--                      projects (ON DELETE SET NULL); account_id ->
--                      three_pl_accounts (ON DELETE SET NULL); invoice_id ->
--                      invoices (ON DELETE SET NULL, set at approve). All nullable:
--                      the primary grain is the job_run but a review can also be
--                      scoped to a project or an account (mirrors the nullable
--                      supply_plans refs).
--   Cross-entity write approve_billing_review reads its refs from the in-org
--                      review row (not parameters), so the SECURITY DEFINER body
--                      can never be used to inject a foreign job_run / account.
--                      It acquires the invoice number the chassis way
--                      (next_doc_number for the invoice doc_type, 0004), models
--                      the in-org read-then-build-children pattern on
--                      convert_quote_to_project (0094), and reuses the spine
--                      invoice shape (0018).
--   Out of scope       BILL- numbering is 0103. The job profitability view is
--                      0104. Caps, three-pl-api routes, byte-mirror types, and the
--                      SPA are the A7 app layer (next slice). No billing_review_lines
--                      child table: the draft invoice lines are built directly at
--                      approve from the account service rates (handoff light scope).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Extend audit_log.entity_type CHECK to include billing_review. Guarded
-- drop-then-add. Re-adds every value authoritative as of 0099 (which added the
-- three job_run_daily_log entity_types) plus billing_review. Strict superset.
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (
    select 1 from pg_constraint
     where conrelid = 'public.audit_log'::regclass
       and conname  = 'audit_log_entity_type_check'
  ) then
    alter table public.audit_log
      drop constraint audit_log_entity_type_check;
  end if;
end$$;

alter table public.audit_log
  add constraint audit_log_entity_type_check
  check (entity_type in (
    'organization', 'org_membership',
    'customer', 'contact', 'activity', 'lead', 'opportunity',
    'item',
    'quote', 'quote_line_item', 'project', 'project_phase', 'project_line_item',
    'invoice', 'invoice_line_item', 'payment', 'credit_note',
    'journal_entry', 'period_close',
    'vendor', 'purchase_order', 'po_line_item', 'vendor_bill', 'expense',
    'warehouse', 'stock_movement', 'receiving_order', 'production_run', 'shipment',
    'attachment', 'comment', 'notification',
    'manufacturing_run',
    'manufacturing_run_consumed_line_item', 'manufacturing_run_produced_line_item',
    'sales_channel', 'sales_order', 'sales_order_line_item',
    'kitting_job', 'kitting_job_consumed_line_item', 'kitting_job_produced_line_item',
    'fulfillment',
    'workforce_member', 'workforce_team', 'workforce_team_member',
    'shift', 'work_assignment', 'time_entry',
    'three_pl_account', 'account_service_definition',
    'job_template', 'job_template_line',
    'supply_plan', 'supply_plan_line',
    'job_run',
    'job_run_daily_log',
    'job_run_daily_log_consumed_line_item', 'job_run_daily_log_produced_line_item',
    -- 3PL commercial layer Billing Review (this migration, 0102)
    'billing_review'
  ));

comment on constraint audit_log_entity_type_check on public.audit_log is
  'Enumerates every entity_type allowed in audit_log. Authoritative full list as of 0102, which adds billing_review on top of the 0099 list. Update via forward migration; never subset.';

-- ---------------------------------------------------------------------------
-- billing_reviews: the money-out header. Pattern A. review_number BILL- (0103).
-- An estimate-versus-actual check before invoicing; the primary grain is the
-- job_run but project / account refs are nullable so a review can also be scoped
-- up. Rich FSM draft / approved / invoiced / cancelled with paired timestamps.
-- estimate_total_cents / actual_total_cents / currency_code are snapshotted at
-- approve. invoice_id is set when approve creates the spine draft invoice.
-- ---------------------------------------------------------------------------

create table if not exists public.billing_reviews (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  review_number text,
  job_run_id uuid references public.job_runs(id) on delete set null,
  project_id uuid references public.projects(id) on delete set null,
  account_id uuid references public.three_pl_accounts(id) on delete set null,
  invoice_id uuid references public.invoices(id) on delete set null,
  currency_code text,
  estimate_total_cents bigint
    check (estimate_total_cents is null or estimate_total_cents >= 0),
  actual_total_cents bigint
    check (actual_total_cents is null or actual_total_cents >= 0),
  status text not null default 'draft'
    check (status in ('draft', 'approved', 'invoiced', 'cancelled')),
  approved_at timestamptz,
  invoiced_at timestamptz,
  cancelled_at timestamptz,
  notes text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  deleted_at timestamptz
);

create unique index if not exists billing_reviews_org_review_number_uniq
  on public.billing_reviews (org_id, review_number)
  where review_number is not null;
create index if not exists billing_reviews_org_idx
  on public.billing_reviews (org_id) where deleted_at is null;
create index if not exists billing_reviews_org_status_idx
  on public.billing_reviews (org_id, status) where deleted_at is null;
create index if not exists billing_reviews_job_run_idx
  on public.billing_reviews (job_run_id) where job_run_id is not null;
create index if not exists billing_reviews_project_idx
  on public.billing_reviews (project_id) where project_id is not null;
create index if not exists billing_reviews_account_idx
  on public.billing_reviews (account_id) where account_id is not null;
create index if not exists billing_reviews_invoice_idx
  on public.billing_reviews (invoice_id) where invoice_id is not null;

alter table public.billing_reviews enable row level security;

drop policy if exists billing_reviews_select on public.billing_reviews;
create policy billing_reviews_select on public.billing_reviews
  for select to authenticated
  using (org_id = public.current_org_id());

drop policy if exists billing_reviews_write on public.billing_reviews;
create policy billing_reviews_write on public.billing_reviews
  for all to authenticated
  using (
    org_id = public.current_org_id()
    and public.current_user_role() in ('org_owner', 'org_admin', 'ops', 'sales', 'accounting')
  )
  with check (
    org_id = public.current_org_id()
    and public.current_user_role() in ('org_owner', 'org_admin', 'ops', 'sales', 'accounting')
  );

-- ---------------------------------------------------------------------------
-- updated_at stamping trigger. Plain BEFORE UPDATE; no audit side effect.
-- ---------------------------------------------------------------------------

create or replace function public.trg_billing_reviews_set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end; $$;

drop trigger if exists billing_reviews_set_updated_at on public.billing_reviews;
create trigger billing_reviews_set_updated_at
  before update on public.billing_reviews
  for each row execute function public.trg_billing_reviews_set_updated_at();

-- ---------------------------------------------------------------------------
-- Audit trigger: billing_reviews. Rich FSM, so to_state carries the status and
-- from_state carries the prior status on transitions. INSERT records created;
-- DELETE records deleted. Mirrors trg_audit_job_runs (0098).
-- ---------------------------------------------------------------------------

create or replace function public.trg_audit_billing_reviews()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_org_id uuid;
  v_entity_id uuid;
  v_from text;
  v_to text;
  v_action text;
  v_diff jsonb;
begin
  if tg_op = 'INSERT' then
    v_org_id := new.org_id; v_entity_id := new.id;
    v_from := null; v_to := new.status; v_action := 'insert';
    begin v_actor := coalesce(auth.uid(), new.created_by);
    exception when others then v_actor := new.created_by; end;
    v_diff := jsonb_build_object(
      'status', new.status, 'job_run_id', new.job_run_id,
      'project_id', new.project_id, 'account_id', new.account_id);
  elsif tg_op = 'UPDATE' then
    v_org_id := new.org_id; v_entity_id := new.id;
    v_from := old.status; v_to := new.status; v_action := 'update';
    begin v_actor := coalesce(auth.uid(), new.updated_by);
    exception when others then v_actor := new.updated_by; end;
    v_diff := jsonb_build_object(
      'status', jsonb_build_object('from', old.status, 'to', new.status));
  else
    v_org_id := old.org_id; v_entity_id := old.id;
    v_from := old.status; v_to := 'deleted'; v_action := 'delete';
    begin v_actor := coalesce(auth.uid(), old.updated_by);
    exception when others then v_actor := old.updated_by; end;
    v_diff := jsonb_build_object('status', old.status);
  end if;

  perform public.audit_append_state_change(
    v_org_id, 'billing_review', v_entity_id, v_from, v_to, v_action, v_actor, v_diff);

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke execute on function public.trg_audit_billing_reviews() from public, anon;

drop trigger if exists audit_billing_reviews on public.billing_reviews;
create trigger audit_billing_reviews
  after insert or update or delete on public.billing_reviews
  for each row execute function public.trg_audit_billing_reviews();

-- ---------------------------------------------------------------------------
-- approve_billing_review: draft -> approved. The cross-entity write. Reads the
-- review's refs from the in-org row, NOT_FOUND on a cross-tenant or missing
-- review (never 403), idempotent on an already-approved / invoiced review,
-- STATE_CONFLICT on any other start state. Creates a spine DRAFT invoice with one
-- line per active account_service_definition for the review's account (quantity
-- 1, unit_price_cents = the rate, no tax / discount), reuses
-- recompute_invoice_totals (0018) for the totals, then snapshots the estimate
-- (projects.budget_cents) and the actual (posted daily-log labor + consumed cost)
-- onto the review and stamps approved_at + invoice_id. Acquires the invoice
-- number the chassis way (next_doc_number for the invoice doc_type, 0004),
-- accepting an optional override. Models the in-org read-then-build-children
-- pattern on convert_quote_to_project (0094). Status-only on the review; the
-- spine invoice is finished and sent on the spine.
-- ---------------------------------------------------------------------------

create or replace function public.approve_billing_review(
  p_review_id uuid,
  p_actor uuid,
  p_caller_org_id uuid,
  p_invoice_number text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_status text;
  v_job_run_id uuid;
  v_project_id uuid;
  v_account_id uuid;
  v_invoice_id uuid;
  v_currency_code text;
  v_currency text;
  v_customer_id uuid;
  v_invoice_number text;
  v_estimate_cents bigint;
  v_actual_cents bigint;
begin
  select org_id, status, job_run_id, project_id, account_id, invoice_id, currency_code
    into v_org_id, v_status, v_job_run_id, v_project_id, v_account_id,
         v_invoice_id, v_currency_code
    from public.billing_reviews where id = p_review_id;

  -- Cross-tenant or missing review: surface as NOT_FOUND so the caller cannot
  -- distinguish. Constitutional 404, never 403 / 409.
  if v_org_id is null or v_org_id <> p_caller_org_id then
    raise exception 'NOT_FOUND: billing review not found' using errcode = 'P0001';
  end if;

  if v_status in ('approved', 'invoiced') then
    return p_review_id; -- idempotent
  end if;
  if v_status <> 'draft' then
    raise exception 'STATE_CONFLICT: billing review not in draft state (was %)', v_status
      using errcode = 'P0001';
  end if;

  -- Resolve the customer for the spine invoice: the account's customer when an
  -- account is named, else the project's customer, else null (the operator sets
  -- it on the spine). Reads are org-scoped so a foreign row can never leak in.
  if v_account_id is not null then
    select customer_id into v_customer_id
      from public.three_pl_accounts
     where id = v_account_id and org_id = v_org_id;
  end if;
  if v_customer_id is null and v_project_id is not null then
    select customer_id into v_customer_id
      from public.projects
     where id = v_project_id and org_id = v_org_id;
  end if;

  v_currency := coalesce(v_currency_code, 'USD');

  -- Acquire the invoice number the chassis way: next_doc_number for the invoice
  -- doc_type (0004), accepting an explicit override when the edge passes one.
  v_invoice_number := coalesce(
    nullif(trim(p_invoice_number), ''),
    public.next_doc_number(v_org_id, 'invoice'));

  insert into public.invoices (
    org_id, invoice_number, customer_id, project_id,
    currency_code, status, created_by, updated_by
  ) values (
    v_org_id, v_invoice_number, v_customer_id, v_project_id,
    v_currency, 'draft', p_actor, p_actor
  )
  returning id into v_invoice_id;

  -- One draft invoice line per active account service definition for the
  -- review's account: description = service name, quantity 1, price = the rate
  -- (0 when null), no tax / discount, sort_order = position. Skip entirely when
  -- there is no account (the operator builds the lines on the spine). Active =
  -- effective window open at now() (null bounds are open-ended).
  if v_account_id is not null then
    insert into public.invoice_line_items (
      invoice_id, description, quantity, unit_price_cents,
      tax_rate_snapshot, tax_amount_cents, discount_cents, line_total_cents,
      sort_order, created_by, updated_by
    )
    select
      v_invoice_id, asd.name, 1, coalesce(asd.rate_cents, 0),
      0, 0, 0, coalesce(asd.rate_cents, 0),
      asd.position, p_actor, p_actor
    from public.account_service_definitions asd
    where asd.org_id = v_org_id
      and asd.account_id = v_account_id
      and (asd.effective_from is null or asd.effective_from <= now())
      and (asd.effective_to   is null or asd.effective_to   >= now())
    order by asd.position;
  end if;

  -- Recompute the spine invoice totals the authoritative way (0018); never
  -- reinvent invoice math.
  perform public.recompute_invoice_totals(v_invoice_id);

  -- Snapshot the estimate: the project budget (rolled up from quote lines),
  -- org-scoped, null when the review is not project-scoped.
  if v_project_id is not null then
    select budget_cents into v_estimate_cents
      from public.projects
     where id = v_project_id and org_id = v_org_id;
  end if;

  -- Snapshot the actual cost: over the run's POSTED daily logs, labor
  -- (labor_hours * labor_rate_cents) plus consumed material
  -- (quantity * unit_cost_cents). Null when the review is not run-scoped; else
  -- coalesced to 0. unit_cost_cents / labor_rate_cents are nullable, treated as 0.
  if v_job_run_id is not null then
    select
      coalesce((
        select sum(round(dl.labor_hours * coalesce(dl.labor_rate_cents, 0)))
          from public.job_run_daily_logs dl
         where dl.org_id = v_org_id
           and dl.job_run_id = v_job_run_id
           and dl.status = 'posted'
      ), 0)
      + coalesce((
        select sum(round(cli.quantity * coalesce(cli.unit_cost_cents, 0)))
          from public.job_run_daily_log_consumed_line_items cli
          join public.job_run_daily_logs dl
            on dl.id = cli.job_run_daily_log_id and dl.org_id = cli.org_id
         where cli.org_id = v_org_id
           and dl.job_run_id = v_job_run_id
           and dl.status = 'posted'
      ), 0)
    into v_actual_cents;
  end if;

  update public.billing_reviews
     set status = 'approved',
         invoice_id = v_invoice_id,
         currency_code = v_currency,
         estimate_total_cents = v_estimate_cents,
         actual_total_cents = v_actual_cents,
         approved_at = now(),
         updated_by = p_actor
   where id = p_review_id;

  return p_review_id;
end;
$$;

revoke execute on function public.approve_billing_review(uuid, uuid, uuid, text) from public, anon;
grant execute on function public.approve_billing_review(uuid, uuid, uuid, text) to authenticated, service_role;

comment on function public.approve_billing_review(uuid, uuid, uuid, text) is
  'Approves a draft Billing Review (Wave 12 / A7): draft -> approved, stamps approved_at. Creates a spine DRAFT invoice in-org with one line per active account_service_definition for the review''s account (rate-card driven, light), snapshots currency, the project-budget estimate, and the posted daily-log actual (labor + consumed cost) onto the review, and sets invoice_id. Acquires the invoice number via next_doc_number (chassis pattern, override accepted). 4-arg cross-tenant guard (NOT_FOUND, never 403). Idempotent on an already-approved / invoiced review. Reuses recompute_invoice_totals (0018); models convert_quote_to_project (0094).';

-- ---------------------------------------------------------------------------
-- cancel_billing_review: -> cancelled. 3-arg cross-tenant guard (reads the
-- review's org, NOT_FOUND never 403). Idempotent on an already-cancelled review,
-- STATE_CONFLICT when the review is not in draft or approved. Status-only: does
-- NOT delete a created draft invoice (a created draft invoice is handled on the
-- spine). Mirrors cancel_job_run (0098).
-- ---------------------------------------------------------------------------

create or replace function public.cancel_billing_review(
  p_review_id uuid,
  p_actor uuid,
  p_caller_org_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_status text;
begin
  select org_id, status into v_org_id, v_status
    from public.billing_reviews where id = p_review_id;

  if v_org_id is null or v_org_id <> p_caller_org_id then
    raise exception 'NOT_FOUND: billing review not found' using errcode = 'P0001';
  end if;

  if v_status = 'cancelled' then
    return p_review_id; -- idempotent
  end if;
  if v_status not in ('draft', 'approved') then
    raise exception 'STATE_CONFLICT: billing review cannot be cancelled (was %)', v_status
      using errcode = 'P0001';
  end if;

  update public.billing_reviews
     set status = 'cancelled', cancelled_at = now(), updated_by = p_actor
   where id = p_review_id;

  return p_review_id;
end;
$$;

revoke execute on function public.cancel_billing_review(uuid, uuid, uuid) from public, anon;
grant execute on function public.cancel_billing_review(uuid, uuid, uuid) to authenticated, service_role;

comment on function public.cancel_billing_review(uuid, uuid, uuid) is
  'Cancels a Billing Review (Wave 12 / A7): draft|approved -> cancelled, stamps cancelled_at. 3-arg cross-tenant guard (NOT_FOUND). Idempotent on an already-cancelled review. Status-only; does NOT delete a created draft invoice (the spine owns the invoice). Mirrors cancel_job_run (0098).';

-- ---------------------------------------------------------------------------
-- Table comment.
-- ---------------------------------------------------------------------------

comment on table public.billing_reviews is
  '3PL Billing Review header (Wave 12 / A7): an estimate-versus-actual check before invoicing. FSM draft / approved / invoiced / cancelled. Approve creates a spine DRAFT invoice (one line per active account service rate), snapshots currency / estimate / actual, and sets invoice_id; invoiced is reserved for when the spine invoice is sent. The primary grain is the job_run; project / account refs are nullable (mirrors supply_plans). review_number BILL- (0103). Pattern A RLS, write gated to the 3PL roles plus accounting.';
