# Audit chain same-transaction ordering fix

Date: 2026-06-01
Closes: F-Wave9-AUDIT-CHAIN-SAME-TXN-01
Migration: 0085_audit_chain_same_txn_ordering.sql
Status: HELD FOR OPERATOR CONFIRMATION (touches audit_log). Not merged. Not applied to prod or staging.

## Background

The Cowork SMOKE-05 sweep ran `verify_audit_chain` across five sampled prod
orgs and found the per-org hash chain broken on three of them. The weakness is
structural to the audit writers and the verifier, not data corruption.

## Confirmed root cause

`public.audit_log` (migration 0001) has no monotonic ordering column. Its only
two ordering candidates are:

- `id uuid default uuid_generate_v4()` — random, not monotonic with insertion.
- `triggered_at timestamptz default now()` — constant within a transaction,
  because `now()` returns the transaction-start time.

Every chain writer reads the per-org head with:

```sql
select payload_hash into v_prev_hash
  from public.audit_log
 where org_id = <X>
 order by triggered_at desc, id desc
 limit 1;
```

and `verify_audit_chain` walks forward with `order by triggered_at asc, id asc`.

When one transaction writes more than one audit row for the same org, those
rows share the same `triggered_at`. The tiebreaker is the random uuid `id`, so
the descending lookup can return the wrong prior row as `prev_hash`, and the
ascending walk can read rows in a different order than they were written. The
chain then does not link and the verifier reports a break.

Real same-transaction multi-write paths in the codebase:

- `provision_organization` inserts an organization in `provisioning` status and
  transitions it to `active` in the same transaction (fires the organizations
  status trigger).
- `convert_quote_to_project` and the line-item triggers write a quote/project
  state row plus N line-item audit rows in one transaction.
- The 0070 created-symmetry INSERT triggers fire alongside a status trigger for
  cascades.

## Empirical confirmation (throwaway Postgres 15, Docker)

- 30 `audit_append`-style calls for one org in one transaction:
  `distinct_timestamps = 1`, `broken_links = 30` under the old
  `(triggered_at, id)` ordering.
- The same workload after adding `seq` and ordering by it: `0` broken links,
  for both single-org and two-org-interleaved transactions.
- The real rewritten `audit_append_state_change` helper driving 25 same-txn
  rows: `0` broken links via the rewritten `verify_audit_chain`.

## Fix (Option A: monotonic seq column)

Chosen over a per-org chain-head cache or advisory-lock-plus-last-hash scheme
(Option B) because it matches the existing append-only model, adds no new
write-path state to keep consistent, and is a single ordering change rather than
a new concurrency protocol. The existing per-org advisory lock is retained.

Migration 0085:

1. Adds `audit_log.seq bigint` with a dedicated sequence
   `audit_log_seq_seq`, a `(org_id, seq desc)` index, and `NOT NULL` plus the
   sequence default (added nullable first so the backfill can run).
2. Backfills existing rows with `row_number() over (order by triggered_at asc,
   id asc)` — the same ordering the verifier used before — so the backfilled
   `seq` reproduces each org's current chain order. The rank value is written
   directly, not via `nextval()` (which Postgres evaluates in physical/ctid
   order and would reorder history). Then advances the sequence past `max(seq)`.
3. Adds `kitstak_audit_chain_head(uuid)` — the single seq-ordered head lookup —
   and repoints all 23 reusable writers plus `verify_audit_chain` to it /
   `order by seq asc`.

History is never reordered, and `from_state` / `to_state` / `payload_hash` /
`prev_hash` of existing rows are never read for mutation or rewritten. `seq` is
metadata about insertion order, not part of the hashed canonical payload, so
every previously sealed `payload_hash` stays valid.

## Functions changed (24 + 1 new)

New: `kitstak_audit_chain_head(uuid)`.
Verifier: `verify_audit_chain(uuid)`.
Shared helpers: `audit_append_state_change`, `kitstak_audit_state`,
`kitstak_audit_created`.
Inline triggers: `trg_audit_organizations_status`, `tg_lead_audit_state_change`,
`tg_opportunity_audit_stage_change`, `trg_audit_purchase_orders_status`,
`trg_audit_vendor_bills_status`, `trg_audit_expenses_status`,
`trg_audit_receiving_orders_status`, `trg_audit_production_runs_status`,
`trg_audit_shipments_status`, `trg_audit_manufacturing_runs_status`,
`trg_audit_manufacturing_runs_created`, `trg_org_memberships_created_audit`,
`trg_org_memberships_updated_audit`,
`trg_audit_organizations_subscription_status`, `trg_audit_sales_orders_status`,
`trg_audit_kitting_jobs_status`, `trg_audit_fulfillments_status`,
`trg_audit_workforce_members_status`, `trg_audit_shifts_status`,
`trg_audit_work_assignments_status`.

Intentionally not changed: the one-time backfill DO-blocks inside 0061 and 0067.
They already executed, they are historical DML rather than reusable functions,
and their re-run is gated by NOT EXISTS guards. The 0085 backfill assigns those
rows a `seq` consistent with the same `(triggered_at, id)` ordering.

The writer rewrites were produced by `scripts/gen-0085-audit-chain.mjs`, which
copies each function body verbatim from its source migration and swaps only the
inline lookup for the helper call, so the hashed payload is byte-identical.

## Verification

- Static-content regression suite:
  `apps/web/test/regression/db-0085-audit-chain-same-txn-ordering.test.ts`
  (26 assertions, green).
- Full regression suite green (406 passed, 2 skipped). Contract test green
  (Zod + money parity, 22 passed).
- Behavioural repro for the orchestrator:
  `supabase/tests/audit-chain-same-txn-repro.sql`. Run after a clean
  `supabase db reset`:

  ```
  supabase db reset
  psql "$(supabase status -o env | grep DB_URL | cut -d= -f2- | tr -d '"')" \
    -v ON_ERROR_STOP=1 -f supabase/tests/audit-chain-same-txn-repro.sql
  ```

  Expected: `same_txn_distinct_timestamps | 1`, `PASS same-transaction chain`,
  `PASS provision_organization`.

## Operator notes

This migration touches `audit_log`, the constitution's hardest invariant. The
PR is held for operator confirmation and is not merged. It was not applied to
prod or staging via MCP. After confirmation, the file-based post-merge push
ships it to prod; staging should be reset (it is frozen well before 0085) or
have 0085 applied as part of the broader drift remediation.

## Orchestrator verification + metadata follow-on (2026-06-01)

An independent fresh-DB verification (supabase db reset over the full 0001 to 0085 sequence, then the repro) found the original migration fixed the same-transaction ordering (Case 1, the shared helper, verified 0 broken) but provision_organization (Case 2) still reported a break. Root cause: the org_membership writers (0067 and 0068) hash a non-empty 'metadata' object (user_id plus role_id), but verify_audit_chain reconstructed the payload without it. Confirmed by recompute: the stored hash matched the with-metadata recompute, not the without. Pre-existing and pervasive (every org has an owner membership row), and the dominant cause of the SMOKE-05 chain breaks, separate from the ordering issue.

Fix: verify_audit_chain now reconstructs the optional 'metadata' key, but only when non-empty. The audit_log.metadata column is NOT NULL and defaults to '{}', so the 9-key writers leave it at '{}' and hashed without the key, while membership stores a non-empty object it also hashed. The guard "r.metadata is not null and r.metadata <> '{}'::jsonb" reconstructs each writer's true payload. A lock-in assertion was added to the static test.

Re-verified on a fresh 0001 to 0085 DB: Case 1 and Case 2 both verify with 0 broken. Static test 27 green; contract parity green.
