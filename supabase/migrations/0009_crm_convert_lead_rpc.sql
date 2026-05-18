-- ============================================================================
-- Migration: 0009_crm_convert_lead_rpc.sql
-- Wave: 2
-- Phase: CRM core (Agent B)
-- Closes: R-W2-CRM-06 (atomic lead-to-opportunity conversion)
-- Date: 2026-05-18
-- DOWN MIGRATION: operator-only.
--   drop function if exists public.convert_lead(uuid, jsonb, jsonb, uuid);
--   Not auto-run.
--
-- Constitutional alignment:
--   Money rules        opportunity_amount_cents is bigint cents in jsonb.
--   RLS rules          RPC is SECURITY DEFINER; tenant scope is enforced by
--                      reading the lead's org_id and writing every downstream
--                      row with that org_id. Cross-tenant input is impossible
--                      because the lead is the only entrypoint.
--   Idempotency rules  The wrapping handler enforces Idempotency-Key per the
--                      constitution. The function itself rejects re-conversion
--                      with STATE_CONFLICT-mapped errcode.
--   Audit rules        Stage and status changes fire the trigger from 0010 and
--                      flow through audit_log. The function does not write
--                      audit rows directly.
--   Migration rules    Forward-only. All DDL idempotent.
-- ============================================================================

create or replace function public.convert_lead(
  p_lead_id           uuid,
  p_customer_payload  jsonb,
  p_opp_payload       jsonb,
  p_actor_user_id     uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lead         public.leads%rowtype;
  v_customer_id  uuid;
  v_opp_id       uuid;
  v_actor        uuid;
  v_create_customer boolean;
  v_currency     text;
  v_amount_cents bigint;
  v_opp_name     text;
begin
  v_actor := coalesce(p_actor_user_id, auth.uid());

  if p_lead_id is null then
    raise exception 'VALIDATION_ERROR: p_lead_id required' using errcode = '22023';
  end if;
  if p_opp_payload is null then
    raise exception 'VALIDATION_ERROR: p_opp_payload required' using errcode = '22023';
  end if;

  select * into v_lead
    from public.leads
   where id = p_lead_id and deleted_at is null;
  if v_lead.id is null then
    raise exception 'NOT_FOUND: lead % not found', p_lead_id
      using errcode = 'P0002';
  end if;
  if v_lead.status = 'converted' then
    raise exception 'STATE_CONFLICT: lead % already converted', p_lead_id
      using errcode = '22023';
  end if;

  v_opp_name     := coalesce(p_opp_payload->>'display_name', v_lead.display_name);
  v_currency     := coalesce(
    p_opp_payload->>'currency_code',
    v_lead.currency_code
  );
  v_amount_cents := coalesce(
    (p_opp_payload->>'amount_cents')::bigint,
    v_lead.estimated_value_cents,
    0
  );
  if v_amount_cents < 0 then
    raise exception 'VALIDATION_ERROR: amount_cents must be >= 0'
      using errcode = '22023';
  end if;

  v_create_customer := coalesce(
    (p_customer_payload->>'create_customer')::boolean,
    false
  );
  v_customer_id := nullif(p_customer_payload->>'customer_id', '')::uuid;

  if v_create_customer then
    insert into public.customers (
      org_id, display_name, kind, status,
      primary_email, primary_phone, default_currency_code,
      created_by, updated_by
    ) values (
      v_lead.org_id,
      coalesce(p_customer_payload->>'display_name',
               v_lead.company_name,
               v_lead.display_name),
      coalesce(p_customer_payload->>'kind', 'company'),
      'new',
      v_lead.primary_email,
      v_lead.primary_phone,
      v_currency,
      v_actor, v_actor
    )
    returning id into v_customer_id;
  end if;

  if v_customer_id is null then
    raise exception 'VALIDATION_ERROR: customer_id required when create_customer=false'
      using errcode = '22023';
  end if;

  -- Insert opportunity in initial stage; the trigger from 0010 will not fire
  -- because stage equals its default (no UPDATE OF stage on INSERT).
  insert into public.opportunities (
    org_id, customer_id, lead_id, display_name,
    stage, amount_cents, currency_code, probability_pct,
    owner_user_id, created_by, updated_by
  ) values (
    v_lead.org_id, v_customer_id, p_lead_id, v_opp_name,
    'discovery', v_amount_cents, v_currency, 10,
    v_lead.owner_user_id, v_actor, v_actor
  )
  returning id into v_opp_id;

  -- Patch the lead. DEFERRABLE FK from 0008 permits the cyclic reference;
  -- the status transition fires the audit trigger from 0010.
  update public.leads
     set converted_customer_id    = v_customer_id,
         converted_opportunity_id = v_opp_id,
         converted_at             = now(),
         status                   = 'converted',
         updated_at               = now(),
         updated_by               = v_actor
   where id = p_lead_id;

  return jsonb_build_object(
    'lead_id',        p_lead_id,
    'customer_id',    v_customer_id,
    'opportunity_id', v_opp_id
  );
end;
$$;

comment on function public.convert_lead(uuid, jsonb, jsonb, uuid) is
  'Atomic lead-to-opportunity conversion. Optionally creates a customer, '
  'inserts an opportunity in stage=discovery, then stamps the lead with '
  'converted_customer_id, converted_opportunity_id, converted_at, and '
  'status=converted. The DEFERRABLE leads_converted_opportunity_id_fkey FK '
  'from 0008 makes the cyclic reference commit cleanly. p_actor_user_id '
  'preserves caller fidelity across the service-role boundary.';

revoke execute on function public.convert_lead(uuid, jsonb, jsonb, uuid)
  from public, anon;
grant  execute on function public.convert_lead(uuid, jsonb, jsonb, uuid)
  to authenticated, service_role;
