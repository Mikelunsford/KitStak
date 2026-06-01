-- ============================================================================
-- Migration: 0085_audit_chain_same_txn_ordering.sql
-- Wave: 9
-- Phase: Audit hardening (Cowork SMOKE-05 follow-up).
-- Closes: F-Wave9-AUDIT-CHAIN-SAME-TXN-01
--         (verify_audit_chain reported the per-org hash chain broken on 3 of 5
--          sampled prod orgs during the SMOKE-05 sweep).
-- Date: 2026-06-01
--
-- DOWN MIGRATION (operator-only; not auto-run):
--   -- 1. Repoint every writer + the verifier back to the (triggered_at, id)
--   --    ordering by restoring each function's prior body via CREATE OR
--   --    REPLACE from its source migration (0003, 0010, 0017, 0024, 0026,
--   --    0027, 0028, 0033, 0052, 0061, 0067, 0068, 0070, 0071, 0073, 0074,
--   --    0076, 0078, 0079, 0080). The reverted writers must inline:
--   --      select payload_hash into v_prev_hash from public.audit_log
--   --       where org_id = <X> order by triggered_at desc, id desc limit 1;
--   --    NOTE: reverting REINTRODUCES the same-transaction chain break this
--   --    migration fixes. Do not revert without an alternative ordering scheme.
--   -- 2. drop function if exists public.kitstak_audit_chain_head(uuid);
--   -- 3. drop index if exists public.audit_log_org_seq_idx;
--   -- 4. alter table public.audit_log alter column seq drop default;
--   --    alter table public.audit_log alter column seq drop not null;
--   --    alter table public.audit_log drop column seq;  -- forward-only data;
--   --    dropping seq does NOT alter from_state/to_state/payload_hash/prev_hash.
--   -- 5. drop sequence if exists public.audit_log_seq_seq;
--
-- ----------------------------------------------------------------------------
-- Root cause (confirmed empirically against Postgres 15, 2026-06-01).
--
--   audit_log (0001) has NO monotonic ordering column. Its only two ordering
--   candidates are:
--     - id            uuid default uuid_generate_v4()  (RANDOM, not insertion
--                                                        monotonic)
--     - triggered_at  timestamptz default now()         (CONSTANT within a txn;
--                                                        now() returns the
--                                                        transaction-start time)
--
--   Every chain writer reads the per-org chain head with
--     select payload_hash into v_prev_hash from public.audit_log
--      where org_id = <X> order by triggered_at desc, id desc limit 1;
--   and the verifier walks forward with `order by triggered_at asc, id asc`.
--
--   When a SINGLE transaction writes MORE THAN ONE audit row for the same org
--   (provision_organization inserts an org then transitions it to active in
--   one txn; convert_quote_to_project writes a quote state row plus N line-item
--   rows; the 0070 created-symmetry triggers fire alongside a status trigger),
--   all those rows share the SAME triggered_at. The tiebreaker is the random
--   uuid id, so the DESC lookup can return the WRONG prior row as prev_hash and
--   the ASC walk can read the rows in a different order than they were written.
--   prev_hash then does not point at the immediately-prior row's payload_hash,
--   and verify_audit_chain reports the chain broken.
--
--   Repro (throwaway PG): 30 audit_append calls for one org in one txn produced
--   distinct_timestamps=1 and 30 broken links. After adding seq and ordering by
--   it, the identical workload produced 0 broken links (single-org and
--   multi-org-interleaved). The real rewritten audit_append_state_change helper
--   driving 25 same-txn rows verified with 0 broken links.
--
-- Fix (Option A: monotonic seq column).
--
--   Add a dedicated BIGINT sequence column `seq` to audit_log. Every chain-head
--   lookup orders by `seq desc limit 1`; the verifier walks `seq asc`. Sequence
--   values are assigned in true insertion order, deterministic within and
--   across transactions, so same-txn rows chain in the order they were written.
--   Chosen over a per-org chain-head cache / advisory-lock scheme (Option B)
--   because it matches the existing append-only model, adds no new write-path
--   state to keep consistent, and is a single ordering change rather than a new
--   concurrency protocol. The existing per-org advisory lock is retained.
--
--   The lookup is centralized into one new helper, public.kitstak_audit_chain_head,
--   so the 23 writers share a single definition and a future writer cannot
--   reintroduce the (triggered_at, id) ordering by copy-paste.
--
-- Existing-row backfill preserves history.
--
--   Existing rows are assigned seq by row_number() over (order by triggered_at
--   asc, id asc) - the SAME ordering the verifier used before this migration -
--   so the backfilled seq reproduces each org's CURRENT chain order. History is
--   NOT reordered. The backfill writes the rank value directly (NOT nextval(),
--   which Postgres evaluates in physical/ctid order and would reorder rows).
--   from_state, to_state, action, prev_hash, and payload_hash of existing rows
--   are NEVER read for mutation and NEVER rewritten. No row is re-hashed. The
--   sequence is then advanced past max(seq) so future inserts continue cleanly.
--
-- Constitutional alignment.
--   Audit rules        audit_log stays append-only: no INSERT/UPDATE/DELETE
--                      policy is added for authenticated; writers remain
--                      SECURITY DEFINER service-role-identity writers; the hash
--                      chain and per-org advisory lock are preserved. This
--                      migration changes only the ORDERING used to find the
--                      chain head for FUTURE writes/walks. It does NOT re-hash
--                      or rewrite any historical audit row. seq is metadata
--                      about insertion order, not part of the hashed canonical
--                      payload (kitstak_audit_canonical is untouched), so every
--                      previously sealed payload_hash stays valid.
--   RLS rules          audit_log RLS posture unchanged (Pattern A select-only;
--                      no write policy for authenticated). The new helper is
--                      SECURITY DEFINER, revoked from public/anon, granted to
--                      service_role only. No cross-tenant surface added.
--   Money rules        Untouched. No money columns read or written.
--   Migration rules    Forward-only. Four-digit zero-padded (0085, max was
--                      0084). All DDL idempotent (IF NOT EXISTS on column /
--                      sequence / index; CREATE OR REPLACE on every function).
--                      No numbered migration edited on disk.
--   State machine      Untouched. No new states, no new transitions.
--
-- Functions repointed to seq ordering (23 writers + 1 verifier + 1 new helper).
--   New:      kitstak_audit_chain_head(uuid)
--   Verifier: verify_audit_chain(uuid)                       [0002/0003]
--   Helpers:  audit_append_state_change(...)                 [0017]
--             kitstak_audit_state(...)                        [0024]
--             kitstak_audit_created(...)                      [0070]
--   Triggers: trg_audit_organizations_status                 [0003]
--             tg_lead_audit_state_change                      [0010]
--             tg_opportunity_audit_stage_change               [0010]
--             trg_audit_purchase_orders_status                [0026]
--             trg_audit_vendor_bills_status                   [0027]
--             trg_audit_expenses_status                       [0028]
--             trg_audit_receiving_orders_status               [0033]
--             trg_audit_production_runs_status                [0033]
--             trg_audit_shipments_status                      [0033]
--             trg_audit_manufacturing_runs_status             [0052]
--             trg_audit_manufacturing_runs_created            [0061]
--             trg_org_memberships_created_audit               [0067]
--             trg_org_memberships_updated_audit               [0068]
--             trg_audit_organizations_subscription_status     [0071]
--             trg_audit_sales_orders_status                   [0073]
--             trg_audit_kitting_jobs_status                   [0074]
--             trg_audit_fulfillments_status                   [0076]
--             trg_audit_workforce_members_status              [0078]
--             trg_audit_shifts_status                         [0079]
--             trg_audit_work_assignments_status               [0080]
--
-- Intentionally NOT changed: the one-time backfill DO-blocks inside 0061 and
-- 0067. They already executed and inserted their rows; they are historical DML,
-- not reusable functions, and re-running them is gated by NOT EXISTS guards.
-- Their (triggered_at, id) lookup is moot because this migration's backfill
-- assigns those rows a seq consistent with the same ordering.
--
-- Investigation + repro: 03-workspace/journal/2026-06-01-audit-chain-same-txn.md
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) audit_log.seq: monotonic insertion-order column + dedicated sequence.
--    Added nullable first so the backfill can assign deterministic ranks to
--    existing rows before the NOT NULL + default go on.
-- ---------------------------------------------------------------------------

alter table public.audit_log
  add column if not exists seq bigint;

create sequence if not exists public.audit_log_seq_seq
  owned by public.audit_log.seq;

-- Backfill existing rows in their CURRENT chain order (triggered_at, id). Write
-- the window rank DIRECTLY (not nextval(), which evaluates in ctid order and
-- would reorder history). Idempotent: only rows whose seq is still null are
-- touched, so a re-run is a no-op.
update public.audit_log a
   set seq = o.rn
  from (
    select id,
           row_number() over (order by triggered_at asc, id asc) as rn
      from public.audit_log
     where seq is null
  ) o
 where a.id = o.id
   and a.seq is null;

-- Advance the sequence past the highest backfilled value so the first
-- post-migration insert gets max(seq)+1. setval(..., true) marks it "used".
select setval(
  'public.audit_log_seq_seq',
  greatest(coalesce((select max(seq) from public.audit_log), 0), 1),
  true
);

-- New rows auto-assign seq; the column is now mandatory.
alter table public.audit_log
  alter column seq set default nextval('public.audit_log_seq_seq');

alter table public.audit_log
  alter column seq set not null;

-- Per-org descending index so kitstak_audit_chain_head's
-- `order by seq desc limit 1` is an index-only backwards scan.
create index if not exists audit_log_org_seq_idx
  on public.audit_log (org_id, seq desc);

comment on column public.audit_log.seq is
  'Monotonic insertion-order key (F-Wave9-AUDIT-CHAIN-SAME-TXN-01). The hash chain head is read with order by seq desc limit 1, and verify_audit_chain walks order by seq asc, so multiple audit rows written in one transaction (same triggered_at) chain in true insertion order. Not part of the hashed canonical payload.';

-- ---------------------------------------------------------------------------
-- 2) kitstak_audit_chain_head: the single source of truth for the per-org
--    chain head. Replaces the inline lookup copy-pasted across 23 writers.
--    Orders by the monotonic seq, NOT (triggered_at, id).
-- ---------------------------------------------------------------------------

create or replace function public.kitstak_audit_chain_head(p_org_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select payload_hash
    from public.audit_log
   where org_id = p_org_id
   order by seq desc
   limit 1;
$$;

revoke execute on function public.kitstak_audit_chain_head(uuid) from public, anon;
grant execute on function public.kitstak_audit_chain_head(uuid) to service_role;

comment on function public.kitstak_audit_chain_head(uuid) is
  'Returns the current per-org audit chain head (latest payload_hash) ordered by the monotonic audit_log.seq. Shared by every audit writer so same-transaction appends chain in insertion order. SECURITY DEFINER; service_role only.';

-- ---------------------------------------------------------------------------
-- 3) verify_audit_chain: walk the per-org chain in seq order. Body is the 0003
--    definition with the ONLY change being `order by triggered_at asc, id asc`
--    -> `order by seq asc`. Canonical payload and hash recompute are unchanged,
--    so previously sealed rows verify exactly as before, now in a deterministic
--    insertion order that matches how the rows were written.
-- ---------------------------------------------------------------------------

create or replace function public.verify_audit_chain(p_org_id uuid)
returns table (
  broken_id           uuid,
  broken_triggered_at timestamptz,
  expected_hash       text,
  stored_hash         text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  r           public.audit_log%rowtype;
  v_prev_hash text := null;
  v_payload   jsonb;
  v_expected  text;
begin
  for r in
    select * from public.audit_log
     where org_id = p_org_id
     order by seq asc
  loop
    v_payload := jsonb_build_object(
      'org_id',       r.org_id,
      'entity_type',  r.entity_type,
      'entity_id',    r.entity_id,
      'from_state',   r.from_state,
      'to_state',     r.to_state,
      'action',       r.action,
      'triggered_by', r.triggered_by,
      'diff_json',    r.diff_json,
      'prev_hash',    v_prev_hash
    );
    v_expected := encode(
      extensions.digest(public.kitstak_audit_canonical(v_payload), 'sha256'),
      'hex'
    );

    if r.payload_hash is distinct from v_expected
       or r.prev_hash  is distinct from v_prev_hash then
      broken_id           := r.id;
      broken_triggered_at := r.triggered_at;
      expected_hash       := v_expected;
      stored_hash         := r.payload_hash;
      return next;
      return;
    end if;

    v_prev_hash := r.payload_hash;
  end loop;
  return;
end;
$$;

revoke execute on function public.verify_audit_chain(uuid) from public, anon;
grant execute on function public.verify_audit_chain(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4) Repoint every audit WRITER to read the chain head via
--    kitstak_audit_chain_head (seq ordering). Each function below is its
--    current canonical body with ONLY the inline
--      select payload_hash into v_prev_hash from public.audit_log
--       where org_id = <X> order by triggered_at desc, id desc limit 1;
--    replaced by
--      v_prev_hash := public.kitstak_audit_chain_head(<X>);
--    The payload jsonb that gets hashed and the INSERT tuple are byte-identical
--    to the prior definition, so the chain math is unchanged. Privilege grants
--    are preserved by CREATE OR REPLACE (not re-issued here).
-- ---------------------------------------------------------------------------

-- audit_append_state_change (source: 0017_sales_audit_recompute_triggers.sql)
create or replace function public.audit_append_state_change(
  p_org_id uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_from text,
  p_to text,
  p_action text,
  p_actor uuid,
  p_diff jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prev_hash text;
  v_payload jsonb;
  v_payload_hash text;
  v_lock_key bigint;
begin
  v_lock_key := ('x' || substr(md5(p_org_id::text), 1, 16))::bit(64)::bigint;
  perform pg_advisory_xact_lock(v_lock_key);

  -- F-Wave9-AUDIT-CHAIN-SAME-TXN-01: chain head via monotonic seq.
  v_prev_hash := public.kitstak_audit_chain_head(p_org_id);

  v_payload := jsonb_build_object(
    'org_id',       p_org_id,
    'entity_type',  p_entity_type,
    'entity_id',    p_entity_id,
    'from_state',   p_from,
    'to_state',     p_to,
    'action',       p_action,
    'triggered_by', p_actor,
    'diff_json',    p_diff,
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
    p_from, p_to, p_action,
    p_actor, p_diff,
    v_prev_hash, v_payload_hash
  );
end;
$$;

-- kitstak_audit_state (source: 0024_finance_auto_je_triggers.sql)
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

  -- F-Wave9-AUDIT-CHAIN-SAME-TXN-01: chain head via monotonic seq.
  v_prev_hash := public.kitstak_audit_chain_head(p_org_id);

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

-- kitstak_audit_created (source: 0070_audit_created_symmetry.sql)
create or replace function public.kitstak_audit_created(
  p_org_id      uuid,
  p_entity_type text,
  p_entity_id   uuid,
  p_to_state    text,
  p_actor       uuid,
  p_diff        jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prev_hash    text;
  v_payload      jsonb;
  v_payload_hash text;
  v_lock_key     bigint;
  v_to_state     text;
begin
  v_to_state := coalesce(p_to_state, 'created');

  v_lock_key := ('x' || substr(md5(p_org_id::text), 1, 16))::bit(64)::bigint;
  perform pg_advisory_xact_lock(v_lock_key);

  -- F-Wave9-AUDIT-CHAIN-SAME-TXN-01: chain head via monotonic seq.
  v_prev_hash := public.kitstak_audit_chain_head(p_org_id);

  v_payload := jsonb_build_object(
    'org_id',       p_org_id,
    'entity_type',  p_entity_type,
    'entity_id',    p_entity_id,
    'from_state',   null,
    'to_state',     v_to_state,
    'action',       'created',
    'triggered_by', p_actor,
    'diff_json',    p_diff,
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
    null, v_to_state, 'created',
    p_actor, p_diff,
    v_prev_hash, v_payload_hash
  );
end;
$$;

-- trg_audit_organizations_status (source: 0003_fix_audit_search_path.sql)
create or replace function public.trg_audit_organizations_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prev_hash text;
  v_payload   jsonb;
  v_payload_hash text;
  v_triggered_by uuid;
  v_lock_key bigint;
begin
  if new.status is null or new.status = old.status then
    return new;
  end if;

  begin
    v_triggered_by := coalesce(auth.uid(), new.updated_by);
  exception when others then
    v_triggered_by := new.updated_by;
  end;

  v_lock_key := ('x' || substr(md5(new.id::text), 1, 16))::bit(64)::bigint;
  perform pg_advisory_xact_lock(v_lock_key);

  -- F-Wave9-AUDIT-CHAIN-SAME-TXN-01: chain head via monotonic seq.
  v_prev_hash := public.kitstak_audit_chain_head(new.id);

  v_payload := jsonb_build_object(
    'org_id',       new.id,
    'entity_type',  'organization',
    'entity_id',    new.id,
    'from_state',   old.status,
    'to_state',     new.status,
    'action',       'status_change',
    'triggered_by', v_triggered_by,
    'diff_json',    jsonb_build_object(
                       'status', jsonb_build_object(
                         'from', old.status,
                         'to',   new.status
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
    new.id, 'organization', new.id,
    old.status, new.status, 'status_change',
    v_triggered_by,
    jsonb_build_object(
      'status', jsonb_build_object('from', old.status, 'to', new.status)
    ),
    v_prev_hash, v_payload_hash
  );

  return new;
end;
$$;

-- tg_lead_audit_state_change (source: 0010_crm_audit_state_triggers.sql)
create or replace function public.tg_lead_audit_state_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prev_hash    text;
  v_payload      jsonb;
  v_payload_hash text;
  v_triggered_by uuid;
  v_lock_key     bigint;
begin
  if new.status is null or new.status = old.status then
    return new;
  end if;

  begin
    v_triggered_by := coalesce(auth.uid(), new.updated_by);
  exception when others then
    v_triggered_by := new.updated_by;
  end;

  v_lock_key := ('x' || substr(md5(new.org_id::text), 1, 16))::bit(64)::bigint;
  perform pg_advisory_xact_lock(v_lock_key);

  -- F-Wave9-AUDIT-CHAIN-SAME-TXN-01: chain head via monotonic seq.
  v_prev_hash := public.kitstak_audit_chain_head(new.org_id);

  v_payload := jsonb_build_object(
    'org_id',       new.org_id,
    'entity_type',  'lead',
    'entity_id',    new.id,
    'from_state',   old.status,
    'to_state',     new.status,
    'action',       'status_change',
    'triggered_by', v_triggered_by,
    'diff_json',    jsonb_build_object(
                       'status', jsonb_build_object(
                         'from', old.status,
                         'to',   new.status
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
    new.org_id, 'lead', new.id,
    old.status, new.status, 'status_change',
    v_triggered_by,
    jsonb_build_object(
      'status', jsonb_build_object('from', old.status, 'to', new.status)
    ),
    v_prev_hash, v_payload_hash
  );

  return new;
end;
$$;

-- tg_opportunity_audit_stage_change (source: 0010_crm_audit_state_triggers.sql)
create or replace function public.tg_opportunity_audit_stage_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prev_hash    text;
  v_payload      jsonb;
  v_payload_hash text;
  v_triggered_by uuid;
  v_lock_key     bigint;
begin
  if new.stage is null or new.stage = old.stage then
    return new;
  end if;

  begin
    v_triggered_by := coalesce(auth.uid(), new.updated_by);
  exception when others then
    v_triggered_by := new.updated_by;
  end;

  v_lock_key := ('x' || substr(md5(new.org_id::text), 1, 16))::bit(64)::bigint;
  perform pg_advisory_xact_lock(v_lock_key);

  -- F-Wave9-AUDIT-CHAIN-SAME-TXN-01: chain head via monotonic seq.
  v_prev_hash := public.kitstak_audit_chain_head(new.org_id);

  v_payload := jsonb_build_object(
    'org_id',       new.org_id,
    'entity_type',  'opportunity',
    'entity_id',    new.id,
    'from_state',   old.stage,
    'to_state',     new.stage,
    'action',       'stage_change',
    'triggered_by', v_triggered_by,
    'diff_json',    jsonb_build_object(
                       'stage', jsonb_build_object(
                         'from', old.stage,
                         'to',   new.stage
                       ),
                       'close_reason', new.close_reason
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
    prev_hash, payload_hash, notes
  ) values (
    new.org_id, 'opportunity', new.id,
    old.stage, new.stage, 'stage_change',
    v_triggered_by,
    jsonb_build_object(
      'stage', jsonb_build_object('from', old.stage, 'to', new.stage),
      'close_reason', new.close_reason
    ),
    v_prev_hash, v_payload_hash, new.close_reason
  );

  return new;
end;
$$;

-- trg_audit_purchase_orders_status (source: 0026_vendors_purchase_orders.sql)
create or replace function public.trg_audit_purchase_orders_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prev_hash text;
  v_payload jsonb;
  v_payload_hash text;
  v_triggered_by uuid;
  v_lock_key bigint;
begin
  if new.status is null or new.status = old.status then
    return new;
  end if;

  begin
    v_triggered_by := coalesce(auth.uid(), new.updated_by);
  exception when others then
    v_triggered_by := new.updated_by;
  end;

  v_lock_key := ('x' || substr(md5(new.org_id::text), 1, 16))::bit(64)::bigint;
  perform pg_advisory_xact_lock(v_lock_key);

  -- F-Wave9-AUDIT-CHAIN-SAME-TXN-01: chain head via monotonic seq.
  v_prev_hash := public.kitstak_audit_chain_head(new.org_id);

  v_payload := jsonb_build_object(
    'org_id',       new.org_id,
    'entity_type',  'purchase_order',
    'entity_id',    new.id,
    'from_state',   old.status,
    'to_state',     new.status,
    'action',       'status_change',
    'triggered_by', v_triggered_by,
    'diff_json',    jsonb_build_object(
                       'status', jsonb_build_object('from', old.status, 'to', new.status)
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
    new.org_id, 'purchase_order', new.id,
    old.status, new.status, 'status_change',
    v_triggered_by,
    jsonb_build_object('status', jsonb_build_object('from', old.status, 'to', new.status)),
    v_prev_hash, v_payload_hash
  );

  return new;
end;
$$;

-- trg_audit_vendor_bills_status (source: 0027_vendors_vendor_bills.sql)
create or replace function public.trg_audit_vendor_bills_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prev_hash text;
  v_payload jsonb;
  v_payload_hash text;
  v_triggered_by uuid;
  v_lock_key bigint;
begin
  if new.status is null or new.status = old.status then
    return new;
  end if;

  begin
    v_triggered_by := coalesce(auth.uid(), new.updated_by);
  exception when others then
    v_triggered_by := new.updated_by;
  end;

  v_lock_key := ('x' || substr(md5(new.org_id::text), 1, 16))::bit(64)::bigint;
  perform pg_advisory_xact_lock(v_lock_key);

  -- F-Wave9-AUDIT-CHAIN-SAME-TXN-01: chain head via monotonic seq.
  v_prev_hash := public.kitstak_audit_chain_head(new.org_id);

  v_payload := jsonb_build_object(
    'org_id',       new.org_id,
    'entity_type',  'vendor_bill',
    'entity_id',    new.id,
    'from_state',   old.status,
    'to_state',     new.status,
    'action',       'status_change',
    'triggered_by', v_triggered_by,
    'diff_json',    jsonb_build_object(
                       'status', jsonb_build_object('from', old.status, 'to', new.status)
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
    new.org_id, 'vendor_bill', new.id,
    old.status, new.status, 'status_change',
    v_triggered_by,
    jsonb_build_object('status', jsonb_build_object('from', old.status, 'to', new.status)),
    v_prev_hash, v_payload_hash
  );

  return new;
end;
$$;

-- trg_audit_expenses_status (source: 0028_vendors_expenses.sql)
create or replace function public.trg_audit_expenses_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prev_hash text;
  v_payload jsonb;
  v_payload_hash text;
  v_triggered_by uuid;
  v_lock_key bigint;
begin
  if new.status is null or new.status = old.status then
    return new;
  end if;

  begin
    v_triggered_by := coalesce(auth.uid(), new.updated_by);
  exception when others then
    v_triggered_by := new.updated_by;
  end;

  v_lock_key := ('x' || substr(md5(new.org_id::text), 1, 16))::bit(64)::bigint;
  perform pg_advisory_xact_lock(v_lock_key);

  -- F-Wave9-AUDIT-CHAIN-SAME-TXN-01: chain head via monotonic seq.
  v_prev_hash := public.kitstak_audit_chain_head(new.org_id);

  v_payload := jsonb_build_object(
    'org_id',       new.org_id,
    'entity_type',  'expense',
    'entity_id',    new.id,
    'from_state',   old.status,
    'to_state',     new.status,
    'action',       'status_change',
    'triggered_by', v_triggered_by,
    'diff_json',    jsonb_build_object(
                       'status', jsonb_build_object('from', old.status, 'to', new.status)
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
    new.org_id, 'expense', new.id,
    old.status, new.status, 'status_change',
    v_triggered_by,
    jsonb_build_object('status', jsonb_build_object('from', old.status, 'to', new.status)),
    v_prev_hash, v_payload_hash
  );

  return new;
end;
$$;

-- trg_audit_receiving_orders_status (source: 0033_ops_audit_state_triggers.sql)
create or replace function public.trg_audit_receiving_orders_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prev_hash text;
  v_payload jsonb;
  v_payload_hash text;
  v_triggered_by uuid;
  v_lock_key bigint;
begin
  if new.status is null or new.status = old.status then
    return new;
  end if;
  begin
    v_triggered_by := coalesce(auth.uid(), new.updated_by);
  exception when others then
    v_triggered_by := new.updated_by;
  end;
  v_lock_key := ('x' || substr(md5(new.org_id::text), 1, 16))::bit(64)::bigint;
  perform pg_advisory_xact_lock(v_lock_key);
  -- F-Wave9-AUDIT-CHAIN-SAME-TXN-01: chain head via monotonic seq.
  v_prev_hash := public.kitstak_audit_chain_head(new.org_id);
  v_payload := jsonb_build_object(
    'org_id', new.org_id,
    'entity_type', 'receiving_order',
    'entity_id', new.id,
    'from_state', old.status,
    'to_state', new.status,
    'action', 'status_change',
    'triggered_by', v_triggered_by,
    'diff_json', jsonb_build_object('status', jsonb_build_object('from', old.status, 'to', new.status)),
    'prev_hash', v_prev_hash
  );
  v_payload_hash := encode(
    extensions.digest(public.kitstak_audit_canonical(v_payload), 'sha256'), 'hex'
  );
  insert into public.audit_log (
    org_id, entity_type, entity_id, from_state, to_state, action,
    triggered_by, diff_json, prev_hash, payload_hash
  ) values (
    new.org_id, 'receiving_order', new.id, old.status, new.status, 'status_change',
    v_triggered_by,
    jsonb_build_object('status', jsonb_build_object('from', old.status, 'to', new.status)),
    v_prev_hash, v_payload_hash
  );
  return new;
end;
$$;

-- trg_audit_production_runs_status (source: 0033_ops_audit_state_triggers.sql)
create or replace function public.trg_audit_production_runs_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prev_hash text;
  v_payload jsonb;
  v_payload_hash text;
  v_triggered_by uuid;
  v_lock_key bigint;
begin
  if new.status is null or new.status = old.status then
    return new;
  end if;
  begin
    v_triggered_by := coalesce(auth.uid(), new.updated_by);
  exception when others then
    v_triggered_by := new.updated_by;
  end;
  v_lock_key := ('x' || substr(md5(new.org_id::text), 1, 16))::bit(64)::bigint;
  perform pg_advisory_xact_lock(v_lock_key);
  -- F-Wave9-AUDIT-CHAIN-SAME-TXN-01: chain head via monotonic seq.
  v_prev_hash := public.kitstak_audit_chain_head(new.org_id);
  v_payload := jsonb_build_object(
    'org_id', new.org_id,
    'entity_type', 'production_run',
    'entity_id', new.id,
    'from_state', old.status,
    'to_state', new.status,
    'action', 'status_change',
    'triggered_by', v_triggered_by,
    'diff_json', jsonb_build_object('status', jsonb_build_object('from', old.status, 'to', new.status)),
    'prev_hash', v_prev_hash
  );
  v_payload_hash := encode(
    extensions.digest(public.kitstak_audit_canonical(v_payload), 'sha256'), 'hex'
  );
  insert into public.audit_log (
    org_id, entity_type, entity_id, from_state, to_state, action,
    triggered_by, diff_json, prev_hash, payload_hash
  ) values (
    new.org_id, 'production_run', new.id, old.status, new.status, 'status_change',
    v_triggered_by,
    jsonb_build_object('status', jsonb_build_object('from', old.status, 'to', new.status)),
    v_prev_hash, v_payload_hash
  );
  return new;
end;
$$;

-- trg_audit_shipments_status (source: 0033_ops_audit_state_triggers.sql)
create or replace function public.trg_audit_shipments_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prev_hash text;
  v_payload jsonb;
  v_payload_hash text;
  v_triggered_by uuid;
  v_lock_key bigint;
begin
  if new.status is null or new.status = old.status then
    return new;
  end if;
  begin
    v_triggered_by := coalesce(auth.uid(), new.updated_by);
  exception when others then
    v_triggered_by := new.updated_by;
  end;
  v_lock_key := ('x' || substr(md5(new.org_id::text), 1, 16))::bit(64)::bigint;
  perform pg_advisory_xact_lock(v_lock_key);
  -- F-Wave9-AUDIT-CHAIN-SAME-TXN-01: chain head via monotonic seq.
  v_prev_hash := public.kitstak_audit_chain_head(new.org_id);
  v_payload := jsonb_build_object(
    'org_id', new.org_id,
    'entity_type', 'shipment',
    'entity_id', new.id,
    'from_state', old.status,
    'to_state', new.status,
    'action', 'status_change',
    'triggered_by', v_triggered_by,
    'diff_json', jsonb_build_object('status', jsonb_build_object('from', old.status, 'to', new.status)),
    'prev_hash', v_prev_hash
  );
  v_payload_hash := encode(
    extensions.digest(public.kitstak_audit_canonical(v_payload), 'sha256'), 'hex'
  );
  insert into public.audit_log (
    org_id, entity_type, entity_id, from_state, to_state, action,
    triggered_by, diff_json, prev_hash, payload_hash
  ) values (
    new.org_id, 'shipment', new.id, old.status, new.status, 'status_change',
    v_triggered_by,
    jsonb_build_object('status', jsonb_build_object('from', old.status, 'to', new.status)),
    v_prev_hash, v_payload_hash
  );
  return new;
end;
$$;

-- trg_audit_manufacturing_runs_status (source: 0052_manufacturing_runs_schema.sql)
create or replace function public.trg_audit_manufacturing_runs_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prev_hash text;
  v_payload jsonb;
  v_payload_hash text;
  v_triggered_by uuid;
  v_lock_key bigint;
begin
  if new.status is null or new.status = old.status then
    return new;
  end if;
  begin
    v_triggered_by := coalesce(auth.uid(), new.updated_by);
  exception when others then
    v_triggered_by := new.updated_by;
  end;
  v_lock_key := ('x' || substr(md5(new.org_id::text), 1, 16))::bit(64)::bigint;
  perform pg_advisory_xact_lock(v_lock_key);
  -- F-Wave9-AUDIT-CHAIN-SAME-TXN-01: chain head via monotonic seq.
  v_prev_hash := public.kitstak_audit_chain_head(new.org_id);
  v_payload := jsonb_build_object(
    'org_id', new.org_id,
    'entity_type', 'manufacturing_run',
    'entity_id', new.id,
    'from_state', old.status,
    'to_state', new.status,
    'action', 'status_change',
    'triggered_by', v_triggered_by,
    'diff_json', jsonb_build_object('status', jsonb_build_object('from', old.status, 'to', new.status)),
    'prev_hash', v_prev_hash
  );
  v_payload_hash := encode(
    extensions.digest(public.kitstak_audit_canonical(v_payload), 'sha256'), 'hex'
  );
  insert into public.audit_log (
    org_id, entity_type, entity_id, from_state, to_state, action,
    triggered_by, diff_json, prev_hash, payload_hash
  ) values (
    new.org_id, 'manufacturing_run', new.id, old.status, new.status, 'status_change',
    v_triggered_by,
    jsonb_build_object('status', jsonb_build_object('from', old.status, 'to', new.status)),
    v_prev_hash, v_payload_hash
  );
  return new;
end;
$$;

-- trg_audit_manufacturing_runs_created (source: 0061_manufacturing_run_created_audit.sql)
create or replace function public.trg_audit_manufacturing_runs_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prev_hash text;
  v_payload jsonb;
  v_payload_hash text;
  v_triggered_by uuid;
  v_lock_key bigint;
begin
  begin
    v_triggered_by := coalesce(auth.uid(), new.created_by);
  exception when others then
    v_triggered_by := new.created_by;
  end;
  v_lock_key := ('x' || substr(md5(new.org_id::text), 1, 16))::bit(64)::bigint;
  perform pg_advisory_xact_lock(v_lock_key);
  -- F-Wave9-AUDIT-CHAIN-SAME-TXN-01: chain head via monotonic seq.
  v_prev_hash := public.kitstak_audit_chain_head(new.org_id);
  v_payload := jsonb_build_object(
    'org_id', new.org_id,
    'entity_type', 'manufacturing_run',
    'entity_id', new.id,
    'from_state', null,
    'to_state', new.status,
    'action', 'created',
    'triggered_by', v_triggered_by,
    'diff_json', jsonb_build_object('status', jsonb_build_object('from', null, 'to', new.status)),
    'prev_hash', v_prev_hash
  );
  v_payload_hash := encode(
    extensions.digest(public.kitstak_audit_canonical(v_payload), 'sha256'), 'hex'
  );
  insert into public.audit_log (
    org_id, entity_type, entity_id, from_state, to_state, action,
    triggered_by, diff_json, prev_hash, payload_hash
  ) values (
    new.org_id, 'manufacturing_run', new.id, null, new.status, 'created',
    v_triggered_by,
    jsonb_build_object('status', jsonb_build_object('from', null, 'to', new.status)),
    v_prev_hash, v_payload_hash
  );
  return new;
end;
$$;

-- trg_org_memberships_created_audit (source: 0067_org_membership_audit.sql)
create or replace function public.trg_org_memberships_created_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prev_hash text;
  v_payload jsonb;
  v_payload_hash text;
  v_triggered_by uuid;
  v_lock_key bigint;
  v_to_state text;
  v_metadata jsonb;
begin
  begin
    v_triggered_by := coalesce(auth.uid(), new.created_by);
  exception when others then
    v_triggered_by := new.created_by;
  end;
  v_to_state := case when new.is_active then 'active' else 'inactive' end;
  v_metadata := jsonb_build_object(
    'user_id', new.user_id,
    'role_id', new.role_id
  );
  v_lock_key := ('x' || substr(md5(new.org_id::text), 1, 16))::bit(64)::bigint;
  perform pg_advisory_xact_lock(v_lock_key);
  -- F-Wave9-AUDIT-CHAIN-SAME-TXN-01: chain head via monotonic seq.
  v_prev_hash := public.kitstak_audit_chain_head(new.org_id);
  v_payload := jsonb_build_object(
    'org_id', new.org_id,
    'entity_type', 'org_membership',
    'entity_id', new.id,
    'from_state', null,
    'to_state', v_to_state,
    'action', 'invited',
    'triggered_by', v_triggered_by,
    'diff_json', jsonb_build_object(
      'is_active', jsonb_build_object('from', null, 'to', new.is_active)
    ),
    'metadata', v_metadata,
    'prev_hash', v_prev_hash
  );
  v_payload_hash := encode(
    extensions.digest(public.kitstak_audit_canonical(v_payload), 'sha256'), 'hex'
  );
  insert into public.audit_log (
    org_id, entity_type, entity_id, from_state, to_state, action,
    triggered_by, diff_json, metadata, prev_hash, payload_hash
  ) values (
    new.org_id, 'org_membership', new.id, null, v_to_state, 'invited',
    v_triggered_by,
    jsonb_build_object(
      'is_active', jsonb_build_object('from', null, 'to', new.is_active)
    ),
    v_metadata,
    v_prev_hash, v_payload_hash
  );
  return new;
end;
$$;

-- trg_org_memberships_updated_audit (source: 0068_org_membership_update_audit.sql)
create or replace function public.trg_org_memberships_updated_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prev_hash text;
  v_payload jsonb;
  v_payload_hash text;
  v_triggered_by uuid;
  v_lock_key bigint;
  v_from_state text;
  v_to_state text;
  v_metadata jsonb;
  v_diff jsonb;
  v_changed boolean;
begin
  v_changed := (new.is_active is distinct from old.is_active)
            or (new.role_id   is distinct from old.role_id);
  if not v_changed then
    return new;
  end if;
  begin
    v_triggered_by := coalesce(auth.uid(), new.updated_by, new.created_by);
  exception when others then
    v_triggered_by := coalesce(new.updated_by, new.created_by);
  end;
  v_from_state := case when old.is_active then 'active' else 'inactive' end;
  v_to_state   := case when new.is_active then 'active' else 'inactive' end;
  v_metadata := jsonb_build_object(
    'user_id',     new.user_id,
    'role_id',     new.role_id,
    'old_role_id', old.role_id
  );
  v_diff := jsonb_build_object(
    'is_active', jsonb_build_object('from', old.is_active, 'to', new.is_active),
    'role_id',   jsonb_build_object('from', old.role_id,   'to', new.role_id)
  );
  v_lock_key := ('x' || substr(md5(new.org_id::text), 1, 16))::bit(64)::bigint;
  perform pg_advisory_xact_lock(v_lock_key);
  -- F-Wave9-AUDIT-CHAIN-SAME-TXN-01: chain head via monotonic seq.
  v_prev_hash := public.kitstak_audit_chain_head(new.org_id);
  v_payload := jsonb_build_object(
    'org_id', new.org_id,
    'entity_type', 'org_membership',
    'entity_id', new.id,
    'from_state', v_from_state,
    'to_state', v_to_state,
    'action', 'updated',
    'triggered_by', v_triggered_by,
    'diff_json', v_diff,
    'metadata', v_metadata,
    'prev_hash', v_prev_hash
  );
  v_payload_hash := encode(
    extensions.digest(public.kitstak_audit_canonical(v_payload), 'sha256'), 'hex'
  );
  insert into public.audit_log (
    org_id, entity_type, entity_id, from_state, to_state, action,
    triggered_by, diff_json, metadata, prev_hash, payload_hash
  ) values (
    new.org_id, 'org_membership', new.id, v_from_state, v_to_state, 'updated',
    v_triggered_by, v_diff, v_metadata,
    v_prev_hash, v_payload_hash
  );
  return new;
end;
$$;

-- trg_audit_organizations_subscription_status (source: 0071_organizations_subscription.sql)
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

  -- F-Wave9-AUDIT-CHAIN-SAME-TXN-01: chain head via monotonic seq.
  v_prev_hash := public.kitstak_audit_chain_head(new.id);

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

-- trg_audit_sales_orders_status (source: 0073_copack_channels_orders.sql)
create or replace function public.trg_audit_sales_orders_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prev_hash text;
  v_payload jsonb;
  v_payload_hash text;
  v_triggered_by uuid;
  v_lock_key bigint;
begin
  if new.status is null or new.status = old.status then
    return new;
  end if;
  begin
    v_triggered_by := coalesce(auth.uid(), new.updated_by);
  exception when others then
    v_triggered_by := new.updated_by;
  end;
  v_lock_key := ('x' || substr(md5(new.org_id::text), 1, 16))::bit(64)::bigint;
  perform pg_advisory_xact_lock(v_lock_key);
  -- F-Wave9-AUDIT-CHAIN-SAME-TXN-01: chain head via monotonic seq.
  v_prev_hash := public.kitstak_audit_chain_head(new.org_id);
  v_payload := jsonb_build_object(
    'org_id', new.org_id,
    'entity_type', 'sales_order',
    'entity_id', new.id,
    'from_state', old.status,
    'to_state', new.status,
    'action', 'status_change',
    'triggered_by', v_triggered_by,
    'diff_json', jsonb_build_object('status', jsonb_build_object('from', old.status, 'to', new.status)),
    'prev_hash', v_prev_hash
  );
  v_payload_hash := encode(
    extensions.digest(public.kitstak_audit_canonical(v_payload), 'sha256'), 'hex'
  );
  insert into public.audit_log (
    org_id, entity_type, entity_id, from_state, to_state, action,
    triggered_by, diff_json, prev_hash, payload_hash
  ) values (
    new.org_id, 'sales_order', new.id, old.status, new.status, 'status_change',
    v_triggered_by,
    jsonb_build_object('status', jsonb_build_object('from', old.status, 'to', new.status)),
    v_prev_hash, v_payload_hash
  );
  return new;
end;
$$;

-- trg_audit_kitting_jobs_status (source: 0074_copack_kitting_jobs.sql)
create or replace function public.trg_audit_kitting_jobs_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prev_hash text;
  v_payload jsonb;
  v_payload_hash text;
  v_triggered_by uuid;
  v_lock_key bigint;
begin
  if new.status is null or new.status = old.status then
    return new;
  end if;
  begin
    v_triggered_by := coalesce(auth.uid(), new.updated_by);
  exception when others then
    v_triggered_by := new.updated_by;
  end;
  v_lock_key := ('x' || substr(md5(new.org_id::text), 1, 16))::bit(64)::bigint;
  perform pg_advisory_xact_lock(v_lock_key);
  -- F-Wave9-AUDIT-CHAIN-SAME-TXN-01: chain head via monotonic seq.
  v_prev_hash := public.kitstak_audit_chain_head(new.org_id);
  v_payload := jsonb_build_object(
    'org_id', new.org_id,
    'entity_type', 'kitting_job',
    'entity_id', new.id,
    'from_state', old.status,
    'to_state', new.status,
    'action', 'status_change',
    'triggered_by', v_triggered_by,
    'diff_json', jsonb_build_object('status', jsonb_build_object('from', old.status, 'to', new.status)),
    'prev_hash', v_prev_hash
  );
  v_payload_hash := encode(
    extensions.digest(public.kitstak_audit_canonical(v_payload), 'sha256'), 'hex'
  );
  insert into public.audit_log (
    org_id, entity_type, entity_id, from_state, to_state, action,
    triggered_by, diff_json, prev_hash, payload_hash
  ) values (
    new.org_id, 'kitting_job', new.id, old.status, new.status, 'status_change',
    v_triggered_by,
    jsonb_build_object('status', jsonb_build_object('from', old.status, 'to', new.status)),
    v_prev_hash, v_payload_hash
  );
  return new;
end;
$$;

-- trg_audit_fulfillments_status (source: 0076_copack_fulfillments.sql)
create or replace function public.trg_audit_fulfillments_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prev_hash text;
  v_payload jsonb;
  v_payload_hash text;
  v_triggered_by uuid;
  v_lock_key bigint;
begin
  if new.status is null or new.status = old.status then
    return new;
  end if;
  begin
    v_triggered_by := coalesce(auth.uid(), new.updated_by);
  exception when others then
    v_triggered_by := new.updated_by;
  end;
  v_lock_key := ('x' || substr(md5(new.org_id::text), 1, 16))::bit(64)::bigint;
  perform pg_advisory_xact_lock(v_lock_key);
  -- F-Wave9-AUDIT-CHAIN-SAME-TXN-01: chain head via monotonic seq.
  v_prev_hash := public.kitstak_audit_chain_head(new.org_id);
  v_payload := jsonb_build_object(
    'org_id', new.org_id,
    'entity_type', 'fulfillment',
    'entity_id', new.id,
    'from_state', old.status,
    'to_state', new.status,
    'action', 'status_change',
    'triggered_by', v_triggered_by,
    'diff_json', jsonb_build_object('status', jsonb_build_object('from', old.status, 'to', new.status)),
    'prev_hash', v_prev_hash
  );
  v_payload_hash := encode(
    extensions.digest(public.kitstak_audit_canonical(v_payload), 'sha256'), 'hex'
  );
  insert into public.audit_log (
    org_id, entity_type, entity_id, from_state, to_state, action,
    triggered_by, diff_json, prev_hash, payload_hash
  ) values (
    new.org_id, 'fulfillment', new.id, old.status, new.status, 'status_change',
    v_triggered_by,
    jsonb_build_object('status', jsonb_build_object('from', old.status, 'to', new.status)),
    v_prev_hash, v_payload_hash
  );
  return new;
end;
$$;

-- trg_audit_workforce_members_status (source: 0078_kitforce_members_teams.sql)
create or replace function public.trg_audit_workforce_members_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prev_hash text;
  v_payload jsonb;
  v_payload_hash text;
  v_triggered_by uuid;
  v_lock_key bigint;
begin
  if new.status is null or new.status = old.status then
    return new;
  end if;
  begin
    v_triggered_by := coalesce(auth.uid(), new.updated_by);
  exception when others then
    v_triggered_by := new.updated_by;
  end;
  v_lock_key := ('x' || substr(md5(new.org_id::text), 1, 16))::bit(64)::bigint;
  perform pg_advisory_xact_lock(v_lock_key);
  -- F-Wave9-AUDIT-CHAIN-SAME-TXN-01: chain head via monotonic seq.
  v_prev_hash := public.kitstak_audit_chain_head(new.org_id);
  v_payload := jsonb_build_object(
    'org_id', new.org_id,
    'entity_type', 'workforce_member',
    'entity_id', new.id,
    'from_state', old.status,
    'to_state', new.status,
    'action', 'status_change',
    'triggered_by', v_triggered_by,
    'diff_json', jsonb_build_object('status', jsonb_build_object('from', old.status, 'to', new.status)),
    'prev_hash', v_prev_hash
  );
  v_payload_hash := encode(
    extensions.digest(public.kitstak_audit_canonical(v_payload), 'sha256'), 'hex'
  );
  insert into public.audit_log (
    org_id, entity_type, entity_id, from_state, to_state, action,
    triggered_by, diff_json, prev_hash, payload_hash
  ) values (
    new.org_id, 'workforce_member', new.id, old.status, new.status, 'status_change',
    v_triggered_by,
    jsonb_build_object('status', jsonb_build_object('from', old.status, 'to', new.status)),
    v_prev_hash, v_payload_hash
  );
  return new;
end;
$$;

-- trg_audit_shifts_status (source: 0079_kitforce_shifts.sql)
create or replace function public.trg_audit_shifts_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prev_hash text;
  v_payload jsonb;
  v_payload_hash text;
  v_triggered_by uuid;
  v_lock_key bigint;
begin
  if new.status is null or new.status = old.status then
    return new;
  end if;
  begin
    v_triggered_by := coalesce(auth.uid(), new.updated_by);
  exception when others then
    v_triggered_by := new.updated_by;
  end;
  v_lock_key := ('x' || substr(md5(new.org_id::text), 1, 16))::bit(64)::bigint;
  perform pg_advisory_xact_lock(v_lock_key);
  -- F-Wave9-AUDIT-CHAIN-SAME-TXN-01: chain head via monotonic seq.
  v_prev_hash := public.kitstak_audit_chain_head(new.org_id);
  v_payload := jsonb_build_object(
    'org_id', new.org_id,
    'entity_type', 'shift',
    'entity_id', new.id,
    'from_state', old.status,
    'to_state', new.status,
    'action', 'status_change',
    'triggered_by', v_triggered_by,
    'diff_json', jsonb_build_object('status', jsonb_build_object('from', old.status, 'to', new.status)),
    'prev_hash', v_prev_hash
  );
  v_payload_hash := encode(
    extensions.digest(public.kitstak_audit_canonical(v_payload), 'sha256'), 'hex'
  );
  insert into public.audit_log (
    org_id, entity_type, entity_id, from_state, to_state, action,
    triggered_by, diff_json, prev_hash, payload_hash
  ) values (
    new.org_id, 'shift', new.id, old.status, new.status, 'status_change',
    v_triggered_by,
    jsonb_build_object('status', jsonb_build_object('from', old.status, 'to', new.status)),
    v_prev_hash, v_payload_hash
  );
  return new;
end;
$$;

-- trg_audit_work_assignments_status (source: 0080_kitforce_assignments.sql)
create or replace function public.trg_audit_work_assignments_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prev_hash text;
  v_payload jsonb;
  v_payload_hash text;
  v_triggered_by uuid;
  v_lock_key bigint;
begin
  if new.status is null or new.status = old.status then
    return new;
  end if;
  begin
    v_triggered_by := coalesce(auth.uid(), new.updated_by);
  exception when others then
    v_triggered_by := new.updated_by;
  end;
  v_lock_key := ('x' || substr(md5(new.org_id::text), 1, 16))::bit(64)::bigint;
  perform pg_advisory_xact_lock(v_lock_key);
  -- F-Wave9-AUDIT-CHAIN-SAME-TXN-01: chain head via monotonic seq.
  v_prev_hash := public.kitstak_audit_chain_head(new.org_id);
  v_payload := jsonb_build_object(
    'org_id', new.org_id,
    'entity_type', 'work_assignment',
    'entity_id', new.id,
    'from_state', old.status,
    'to_state', new.status,
    'action', 'status_change',
    'triggered_by', v_triggered_by,
    'diff_json', jsonb_build_object('status', jsonb_build_object('from', old.status, 'to', new.status)),
    'prev_hash', v_prev_hash
  );
  v_payload_hash := encode(
    extensions.digest(public.kitstak_audit_canonical(v_payload), 'sha256'), 'hex'
  );
  insert into public.audit_log (
    org_id, entity_type, entity_id, from_state, to_state, action,
    triggered_by, diff_json, prev_hash, payload_hash
  ) values (
    new.org_id, 'work_assignment', new.id, old.status, new.status, 'status_change',
    v_triggered_by,
    jsonb_build_object('status', jsonb_build_object('from', old.status, 'to', new.status)),
    v_prev_hash, v_payload_hash
  );
  return new;
end;
$$;
