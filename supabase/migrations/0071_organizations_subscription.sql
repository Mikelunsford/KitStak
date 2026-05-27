-- 0071_organizations_subscription.sql
-- Wave: Stripe wiring
-- Phase: 10
-- Closes: F-Wave10-STRIPE-SCHEMA-01
-- DOWN MIGRATION: operator-only manual rollback
--   drop trigger if exists audit_organizations_subscription_status on public.organizations;
--   drop function if exists public.trg_audit_organizations_subscription_status();
--   alter table public.organizations drop column if exists stripe_customer_id;
--   alter table public.organizations drop column if exists stripe_subscription_id;
--   alter table public.organizations drop column if exists subscription_status;
--   alter table public.organizations drop column if exists subscription_plan;
--   alter table public.organizations drop column if exists trial_ends_at;
--   alter table public.organizations drop column if exists subscription_current_period_end;
--   drop table if exists public.stripe_webhook_events;
-- Date: 2026-05-27
-- Constitutional alignment:
--   * Money rules: stored amounts on Stripe events deferred to Stripe (no _cents columns on this org-level subscription state; revenue accounting lives in invoices/payments tables).
--   * RLS: organizations table already has RLS from migration 0001; new columns inherit the existing row policy. stripe_webhook_events is service-role-only (no authenticated policy).
--   * Audit: subscription_status changes ride the existing kitstak_audit_created helper from 0070 via a new AFTER UPDATE trigger. Re-uses the per-org advisory lock and prev_hash chain established in 0002.
--   * Migration rules: forward-only, all DDL idempotent.

-- ---------------------------------------------------------------------------
-- 1) organizations: subscription state columns
-- ---------------------------------------------------------------------------

alter table public.organizations
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_subscription_id text,
  add column if not exists subscription_status text not null default 'trialing',
  add column if not exists subscription_plan text,
  add column if not exists trial_ends_at timestamptz not null default (now() + interval '14 days'),
  add column if not exists subscription_current_period_end timestamptz;

-- Unique indexes on Stripe IDs (idempotent; allow many nulls for unprovisioned orgs).
create unique index if not exists organizations_stripe_customer_id_key
  on public.organizations (stripe_customer_id)
  where stripe_customer_id is not null;

create unique index if not exists organizations_stripe_subscription_id_key
  on public.organizations (stripe_subscription_id)
  where stripe_subscription_id is not null;

-- CHECK constraints (drop-then-add idempotent pattern).
alter table public.organizations drop constraint if exists organizations_subscription_status_check;
alter table public.organizations add constraint organizations_subscription_status_check
  check (subscription_status in ('trialing','active','past_due','canceled','incomplete','incomplete_expired','unpaid','paused'));

alter table public.organizations drop constraint if exists organizations_subscription_plan_check;
alter table public.organizations add constraint organizations_subscription_plan_check
  check (subscription_plan is null or subscription_plan in ('starter_monthly','starter_annual','pro_monthly','pro_annual','enterprise_monthly','enterprise_annual'));

-- Supporting indexes for status lookups and trial expiry sweeps.
create index if not exists organizations_subscription_status_idx
  on public.organizations (subscription_status);

create index if not exists organizations_trial_ends_at_idx
  on public.organizations (trial_ends_at)
  where subscription_status = 'trialing';

-- ---------------------------------------------------------------------------
-- 2) Backfill existing orgs.
-- Orgs provisioned before 0071 get a 14-day trial window from now.
-- Idempotent: only fills rows still lacking trial_ends_at (no-op on re-run
-- because the column default already populates new inserts after this point).
-- ---------------------------------------------------------------------------

update public.organizations
  set trial_ends_at = now() + interval '14 days'
  where trial_ends_at is null;

-- ---------------------------------------------------------------------------
-- 3) Stripe webhook idempotency table.
-- event_id is Stripe's unique event identifier ('evt_...'); PK enforces
-- exactly-once processing. org_id is nullable because some Stripe events
-- (account.updated, etc.) arrive before the org_id can be resolved.
-- Service-role-only: the stripe-webhook edge bundle runs as service_role.
-- ---------------------------------------------------------------------------

create table if not exists public.stripe_webhook_events (
  event_id     text primary key,
  event_type   text not null,
  org_id       uuid references public.organizations(id) on delete set null,
  received_at  timestamptz not null default now(),
  processed_at timestamptz,
  payload      jsonb not null
);

create index if not exists stripe_webhook_events_org_id_idx
  on public.stripe_webhook_events (org_id, received_at desc);

create index if not exists stripe_webhook_events_event_type_idx
  on public.stripe_webhook_events (event_type, received_at desc);

alter table public.stripe_webhook_events enable row level security;

-- No authenticated policy. Service-role-only writes and reads. The
-- webhook bundle runs with service-role and bypasses RLS by design.

-- ---------------------------------------------------------------------------
-- 4) Audit trigger on subscription_status transitions.
-- Mirrors the kitstak_audit_created helper shape from 0070 (per-org advisory
-- lock, prev_hash chain, canonical payload hash) but writes
-- action='subscription.transition' with from_state=OLD.subscription_status
-- and to_state=NEW.subscription_status. Does NOT reuse kitstak_audit_created
-- directly because that helper hard-codes action='created' and from_state=null.
-- Fires only when the value actually changes (UPDATE OF subscription_status
-- plus a runtime guard for null-safe comparison).
-- ---------------------------------------------------------------------------

create or replace function public.trg_audit_organizations_subscription_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor        uuid;
  v_prev_hash    text;
  v_payload      jsonb;
  v_payload_hash text;
  v_lock_key     bigint;
begin
  -- No-op when subscription_status did not actually change.
  if new.subscription_status is not distinct from old.subscription_status then
    return new;
  end if;

  begin v_actor := auth.uid();
  exception when others then v_actor := null; end;

  v_lock_key := ('x' || substr(md5(new.id::text), 1, 16))::bit(64)::bigint;
  perform pg_advisory_xact_lock(v_lock_key);

  select payload_hash
    into v_prev_hash
    from public.audit_log
   where org_id = new.id
   order by triggered_at desc, id desc
   limit 1;

  v_payload := jsonb_build_object(
    'org_id',       new.id,
    'entity_type',  'organization',
    'entity_id',    new.id,
    'from_state',   old.subscription_status,
    'to_state',     new.subscription_status,
    'action',       'subscription.transition',
    'triggered_by', v_actor,
    'diff_json',    jsonb_build_object(
                      'from', old.subscription_status,
                      'to',   new.subscription_status,
                      'subscription_plan', new.subscription_plan,
                      'stripe_subscription_id', new.stripe_subscription_id
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
    new.id, 'organization', new.id,
    old.subscription_status, new.subscription_status, 'subscription.transition',
    v_actor,
    jsonb_build_object(
      'from', old.subscription_status,
      'to',   new.subscription_status,
      'subscription_plan', new.subscription_plan,
      'stripe_subscription_id', new.stripe_subscription_id
    ),
    v_prev_hash, v_payload_hash
  );

  return new;
end;
$$;

revoke execute on function public.trg_audit_organizations_subscription_status()
  from public, anon;

drop trigger if exists audit_organizations_subscription_status on public.organizations;
create trigger audit_organizations_subscription_status
  after update of subscription_status on public.organizations
  for each row
  execute function public.trg_audit_organizations_subscription_status();

comment on function public.trg_audit_organizations_subscription_status() is
  'Writes one audit_log row per subscription_status transition. action=subscription.transition. SECURITY DEFINER; per-org advisory lock; hash chain via prev_hash. Mirrors the 0002/0070 audit trigger shape.';
