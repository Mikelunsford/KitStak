-- ============================================================================
-- Migration: 0024_finance_auto_je_triggers.sql
-- Wave: 2
-- Phase: Finance
-- Closes: R-W2-AUTOJE-01, R-W2-AUTOJE-FLAG-01, R-W2-INV-AUDIT-01
-- Date: 2026-05-18
-- DOWN MIGRATION: operator-only. Drop triggers, then helper functions.
--
-- Constitutional alignment:
--   Auto-JE rule       Triggers, not handlers. Every JE source has a single
--                      DB-side writer. Gated by per-org feature flag
--                      `finance.journal_entries.enabled`. Idempotent via
--                      EXISTS source_type+source_id+status='posted' guard.
--   Audit rules        tg_invoice_audit_state_change, tg_credit_note_audit_state_change,
--                      and tg_je_audit_state_change write to audit_log on
--                      every status transition. Same hash chain as 0002.
--   RLS rules          All triggers run SECURITY DEFINER. audit_log writes
--                      bypass RLS because service-role-equivalent.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- finance_je_enabled(p_org_id): SECURITY DEFINER. True when the per-org
-- feature flag finance.journal_entries.enabled is on.
-- ---------------------------------------------------------------------------

create or replace function public.finance_je_enabled(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select is_enabled
       from public.org_feature_flags
      where org_id = p_org_id
        and flag_key = 'finance.journal_entries.enabled'
      limit 1),
    false
  );
$$;

revoke execute on function public.finance_je_enabled(uuid) from public, anon;
grant execute on function public.finance_je_enabled(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Helper: kitstak_je_get_account(p_org_id, p_code) -> uuid. Used by the
-- auto-JE writers to look up Accounts Receivable, Sales Revenue, and Cash
-- by chart_of_accounts.code. Returns null when missing; caller raises.
-- ---------------------------------------------------------------------------

create or replace function public.kitstak_je_account(p_org_id uuid, p_code text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.chart_of_accounts
   where org_id = p_org_id
     and code = p_code
     and is_active
   limit 1;
$$;

revoke execute on function public.kitstak_je_account(uuid, text) from public, anon;
grant execute on function public.kitstak_je_account(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- kitstak_audit_state(entity_type, entity_id, org_id, from_state, to_state,
-- action, actor): SECURITY DEFINER helper that writes an audit_log row with
-- a per-org hash chain. Mirrors the algorithm in 0002's
-- trg_audit_organizations_status, factored so multiple triggers can reuse.
-- ---------------------------------------------------------------------------

create or replace function public.kitstak_audit_state(
  p_org_id      uuid,
  p_entity_type text,
  p_entity_id   uuid,
  p_from_state  text,
  p_to_state    text,
  p_action      text,
  p_actor       uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prev_hash text;
  v_payload   jsonb;
  v_payload_hash text;
  v_lock_key bigint;
begin
  v_lock_key := ('x' || substr(md5(p_org_id::text), 1, 16))::bit(64)::bigint;
  perform pg_advisory_xact_lock(v_lock_key);

  select payload_hash
    into v_prev_hash
    from public.audit_log
   where org_id = p_org_id
   order by triggered_at desc, id desc
   limit 1;

  v_payload := jsonb_build_object(
    'org_id',       p_org_id,
    'entity_type',  p_entity_type,
    'entity_id',    p_entity_id,
    'from_state',   p_from_state,
    'to_state',     p_to_state,
    'action',       p_action,
    'triggered_by', p_actor,
    'diff_json',    jsonb_build_object(
                       'status', jsonb_build_object(
                         'from', p_from_state,
                         'to',   p_to_state
                       )
                    ),
    'prev_hash',    v_prev_hash
  );

  v_payload_hash := encode(
    extensions.digest(public.kitstak_audit_canonical(v_payload), 'sha256'),
    'hex'
  );

  insert into public.audit_log (
    org_id, entity_type, entity_id,
    from_state, to_state, action,
    triggered_by, diff_json,
    prev_hash, payload_hash
  ) values (
    p_org_id, p_entity_type, p_entity_id,
    p_from_state, p_to_state, p_action,
    p_actor,
    jsonb_build_object(
      'status', jsonb_build_object('from', p_from_state, 'to', p_to_state)
    ),
    v_prev_hash, v_payload_hash
  );
end;
$$;

revoke execute on function public.kitstak_audit_state(uuid, text, uuid, text, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.kitstak_audit_state(uuid, text, uuid, text, text, text, uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- tg_invoice_audit_state_change: AFTER UPDATE OF status on invoices.
-- ---------------------------------------------------------------------------

create or replace function public.trg_invoice_audit_state_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
begin
  if new.status is null or new.status = old.status then
    return new;
  end if;
  begin
    v_actor := coalesce(auth.uid(), new.updated_by);
  exception when others then
    v_actor := new.updated_by;
  end;
  perform public.kitstak_audit_state(
    new.org_id, 'invoice', new.id,
    old.status, new.status, 'status_change', v_actor
  );
  return new;
end;
$$;

drop trigger if exists invoice_audit_state_change on public.invoices;
create trigger invoice_audit_state_change
  after update of status on public.invoices
  for each row execute function public.trg_invoice_audit_state_change();

-- ---------------------------------------------------------------------------
-- tg_credit_note_audit_state_change: AFTER UPDATE OF status on credit_notes.
-- ---------------------------------------------------------------------------

create or replace function public.trg_credit_note_audit_state_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
begin
  if new.status is null or new.status = old.status then
    return new;
  end if;
  begin
    v_actor := coalesce(auth.uid(), new.updated_by);
  exception when others then
    v_actor := new.updated_by;
  end;
  perform public.kitstak_audit_state(
    new.org_id, 'credit_note', new.id,
    old.status, new.status, 'status_change', v_actor
  );
  return new;
end;
$$;

drop trigger if exists credit_note_audit_state_change on public.credit_notes;
create trigger credit_note_audit_state_change
  after update of status on public.credit_notes
  for each row execute function public.trg_credit_note_audit_state_change();

-- ---------------------------------------------------------------------------
-- tg_je_audit_state_change: AFTER UPDATE OF status on journal_entries.
-- ---------------------------------------------------------------------------

create or replace function public.trg_je_audit_state_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
begin
  if new.status is null or new.status = old.status then
    return new;
  end if;
  begin
    v_actor := coalesce(auth.uid(), new.updated_by);
  exception when others then
    v_actor := new.updated_by;
  end;
  perform public.kitstak_audit_state(
    new.org_id, 'journal_entry', new.id,
    old.status, new.status, 'status_change', v_actor
  );
  return new;
end;
$$;

drop trigger if exists je_audit_state_change on public.journal_entries;
create trigger je_audit_state_change
  after update of status on public.journal_entries
  for each row execute function public.trg_je_audit_state_change();

-- ---------------------------------------------------------------------------
-- AUTO-JE 1: invoice draft -> sent. Debit AR, credit Sales Revenue for total.
-- Gated by finance.journal_entries.enabled.
-- Idempotent: skips when a posted JE already exists for (invoice, this id).
-- ---------------------------------------------------------------------------

create or replace function public.trg_invoices_je_on_send()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ar_id      uuid;
  v_revenue_id uuid;
  v_entry_id   uuid;
  v_year       integer;
  v_month      integer;
  v_actor      uuid;
begin
  if new.status <> 'sent' or old.status = 'sent' then
    return new;
  end if;

  if not public.finance_je_enabled(new.org_id) then
    return new;
  end if;

  if exists (
    select 1 from public.journal_entries
     where source_type = 'invoice'
       and source_id = new.id
       and status = 'posted'
       and org_id = new.org_id
  ) then
    return new;
  end if;

  v_ar_id      := public.kitstak_je_account(new.org_id, '1200');
  v_revenue_id := public.kitstak_je_account(new.org_id, '4000');
  if v_ar_id is null or v_revenue_id is null then
    -- COA not seeded for this org. Skip silently; the flag opt-in is the
    -- explicit gate, but a missing COA should not block invoice send.
    return new;
  end if;

  v_year  := extract(year  from coalesce(new.issue_date, current_date))::integer;
  v_month := extract(month from coalesce(new.issue_date, current_date))::integer;
  v_actor := coalesce(auth.uid(), new.updated_by);

  insert into public.journal_entries (
    org_id, entry_number, entry_date, period_year, period_month,
    status, source_type, source_id, memo, posted_at,
    created_by, updated_by
  ) values (
    new.org_id,
    'JE-INV-' || new.invoice_number,
    coalesce(new.issue_date, current_date),
    v_year, v_month,
    'posted', 'invoice', new.id,
    'Auto-JE on invoice send ' || new.invoice_number,
    now(),
    v_actor, v_actor
  ) returning id into v_entry_id;

  insert into public.journal_entry_lines (entry_id, account_id, debit_cents, credit_cents, sort_order, memo)
  values
    (v_entry_id, v_ar_id,      new.total_cents, 0, 1, 'AR'),
    (v_entry_id, v_revenue_id, 0, new.total_cents, 2, 'Revenue');

  perform public.check_journal_balance(v_entry_id);

  return new;
end;
$$;

drop trigger if exists invoices_je_on_send on public.invoices;
create trigger invoices_je_on_send
  after update of status on public.invoices
  for each row execute function public.trg_invoices_je_on_send();

-- ---------------------------------------------------------------------------
-- AUTO-JE 2: payment INSERT. Debit Cash, credit AR for the payment amount.
-- ---------------------------------------------------------------------------

create or replace function public.trg_payments_je_on_create()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cash_id    uuid;
  v_ar_id      uuid;
  v_entry_id   uuid;
  v_year       integer;
  v_month      integer;
  v_actor      uuid;
begin
  if not public.finance_je_enabled(new.org_id) then
    return new;
  end if;

  if exists (
    select 1 from public.journal_entries
     where source_type = 'payment'
       and source_id = new.id
       and status = 'posted'
       and org_id = new.org_id
  ) then
    return new;
  end if;

  v_cash_id := public.kitstak_je_account(new.org_id, '1000');
  v_ar_id   := public.kitstak_je_account(new.org_id, '1200');
  if v_cash_id is null or v_ar_id is null then
    return new;
  end if;

  v_year  := extract(year  from coalesce(new.received_at, now()))::integer;
  v_month := extract(month from coalesce(new.received_at, now()))::integer;
  v_actor := coalesce(auth.uid(), new.created_by);

  insert into public.journal_entries (
    org_id, entry_number, entry_date, period_year, period_month,
    status, source_type, source_id, memo, posted_at,
    created_by, updated_by
  ) values (
    new.org_id,
    'JE-PAY-' || new.payment_number,
    coalesce(new.received_at::date, current_date),
    v_year, v_month,
    'posted', 'payment', new.id,
    'Auto-JE on payment receive ' || new.payment_number,
    now(),
    v_actor, v_actor
  ) returning id into v_entry_id;

  insert into public.journal_entry_lines (entry_id, account_id, debit_cents, credit_cents, sort_order, memo)
  values
    (v_entry_id, v_cash_id, new.amount_cents, 0, 1, 'Cash'),
    (v_entry_id, v_ar_id,   0, new.amount_cents, 2, 'AR');

  perform public.check_journal_balance(v_entry_id);

  return new;
end;
$$;

drop trigger if exists payments_je_on_create on public.payments;
create trigger payments_je_on_create
  after insert on public.payments
  for each row execute function public.trg_payments_je_on_create();

-- ---------------------------------------------------------------------------
-- AUTO-JE 3: credit_note_allocation INSERT. Debit Sales Revenue (reversal),
-- credit AR. Each allocation row produces its own JE keyed on the row id.
-- ---------------------------------------------------------------------------

create or replace function public.trg_credit_note_allocations_je()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ar_id      uuid;
  v_revenue_id uuid;
  v_entry_id   uuid;
  v_org_id     uuid;
  v_year       integer;
  v_month      integer;
  v_actor      uuid;
  v_cn_number  text;
begin
  select cn.org_id, cn.credit_note_number
    into v_org_id, v_cn_number
    from public.credit_notes cn
   where cn.id = new.credit_note_id;

  if v_org_id is null then return new; end if;

  if not public.finance_je_enabled(v_org_id) then
    return new;
  end if;

  if exists (
    select 1 from public.journal_entries
     where source_type = 'credit_note'
       and source_id = new.id
       and status = 'posted'
       and org_id = v_org_id
  ) then
    return new;
  end if;

  v_ar_id      := public.kitstak_je_account(v_org_id, '1200');
  v_revenue_id := public.kitstak_je_account(v_org_id, '4000');
  if v_ar_id is null or v_revenue_id is null then
    return new;
  end if;

  v_year  := extract(year  from now())::integer;
  v_month := extract(month from now())::integer;
  v_actor := coalesce(auth.uid(), new.created_by);

  insert into public.journal_entries (
    org_id, entry_number, entry_date, period_year, period_month,
    status, source_type, source_id, memo, posted_at,
    created_by, updated_by
  ) values (
    v_org_id,
    'JE-CN-' || coalesce(v_cn_number, new.credit_note_id::text) || '-' || substr(new.id::text, 1, 8),
    current_date,
    v_year, v_month,
    'posted', 'credit_note', new.id,
    'Auto-JE on credit note allocation',
    now(),
    v_actor, v_actor
  ) returning id into v_entry_id;

  insert into public.journal_entry_lines (entry_id, account_id, debit_cents, credit_cents, sort_order, memo)
  values
    (v_entry_id, v_revenue_id, new.amount_cents, 0, 1, 'Revenue reversal'),
    (v_entry_id, v_ar_id,      0, new.amount_cents, 2, 'AR');

  perform public.check_journal_balance(v_entry_id);

  return new;
end;
$$;

drop trigger if exists credit_note_allocations_je on public.credit_note_allocations;
create trigger credit_note_allocations_je
  after insert on public.credit_note_allocations
  for each row execute function public.trg_credit_note_allocations_je();
