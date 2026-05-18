-- Wave: 5
-- Phase: 5 (hotfix 4)
-- Closes: F-Wave5-API-04 (convert_quote_to_project cross-tenant returns 404, not 409 / 403)
-- Date: 2026-05-18
-- Constitutional alignment: RLS filters not throws; cross-tenant workflow
--   POSTs return 404 NOT_FOUND, never 403 or 409.
--
-- Root cause: 0016 convert_quote_to_project checks
--   `if v_org_id <> public.current_org_id() then raise FORBIDDEN`.
-- The handler calls the RPC via the service-role client. service_role has
-- no JWT claim, so public.current_org_id() returns NULL. The comparison
-- `v_org_id <> NULL` evaluates to NULL in three-valued SQL logic, treated
-- as false, so the cross-tenant guard never fires. The next check (state
-- != 'approved') wins and the caller sees 409 STATE_CONFLICT for a quote
-- they should not even know exists.
--
-- Fix: take the caller's org_id explicitly as a parameter and compare
-- against the quote's org_id, raising NOT_FOUND on mismatch. The handler
-- passes caller.orgId.
--
-- DOWN MIGRATION (operator-only, not auto-run):
--   Restore the 0016 definition. The 4-arg signature would coexist with
--   the 3-arg signature until a separate drop. This is documented but not
--   ready-to-run because the handler has been updated to call the 4-arg
--   form; restoring the 3-arg form would break the handler.

-- Drop the 3-arg form so the new 4-arg form is the unambiguous resolution
-- target. Forward-only safe via idempotent if exists. (cascade is not
-- needed: nothing else in the schema calls this RPC.)
drop function if exists public.convert_quote_to_project(uuid, uuid, text);

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
  -- cannot tell the difference. RLS-like filter at the RPC boundary.
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
