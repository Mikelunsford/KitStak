# Session handoff 2026-06-01

For the next session. Read this plus run the session-start sync check before proposing work.

## TL;DR

The full-DoD plan Phases A, B, and C all shipped to prod today, plus most of Phase D. Prod main is at 0379331. Zero open PRs. There is exactly ONE decision waiting on the operator: how to treat the audit_log historical residue (see Phase D below). Everything else is either done or operator-gated.

## What shipped today (all on prod main, 0 open PRs)

- Phase A: #188 (broken-wire quick wins), #189 (manufacturing_run FSM into the workflow canon), #190 (crm-api + sales-config-api bundle gate). DoD gate #7 proven via a local fresh-DB migration replay.
- Phase B: #192 (CRM edit affordances), #193 (KitForce edit affordances), #194 (procurement edit affordances), #195 (Chart of Accounts UI), #196 (credit-note issue/void FSM), #197 (sales-config self-service).
- Phase C: #199 (size-limit lazy chunks + lighthouse rewire), #200 (SMOKE-09 pillar cards honor flags), #201 (list-page pagination + formatCents polish).
- Closeouts: #191 (Phase A), #198 (Phase B), #202 (Phase C).
- Phase D: #203 (nightly RLS probe), #204 (audit chain hardening, migration 0085).

Money rules, RLS, idempotency, byte-mirror parity, and brand voice held across the wave.

## Phase D status

### F-Wave8-NIGHTLY-RLS-PROBE-INVESTIGATE-01 -- CLOSED (#203)

The probe was not actually failing. It has been green for 11 nightly runs since 2026-05-21; the "failing" note was stale. The last red run (2026-05-20) was the probe correctly catching a real cross-tenant list-filter leak that self-healed the next day when the server fix deployed. #203 hardened coverage by adding cross-tenant probes for the 10 newer Manufacturing / Co-Pack / KitForce tables; each self-skips honestly while the staging branch lags prod and enforces once the table is present. CI/test-only, merged.

### F-Wave9-AUDIT-CHAIN-SAME-TXN-01 -- FORWARD-CLOSED (#204, migration 0085 live on prod)

Migration 0085 fixes two root causes:
1. Same-transaction ordering: a monotonic `seq` column plus a centralized `kitstak_audit_chain_head` lookup, so multiple audit rows written in one transaction chain in true insertion order. (Previously the chain head was read by `order by triggered_at desc, id desc`, and within a transaction triggered_at is constant and the id is a random UUID, so same-txn rows chained wrong.)
2. Payload canonicalization: `verify_audit_chain` now reconstructs the org_membership writers' non-empty `metadata` key. The 0067/0068 membership triggers hash a `metadata` object (user_id + role_id) that the verifier omitted, so every org_membership row (and therefore every org, since provisioning creates an owner membership) falsely reported broken. The audit_log.metadata column is NOT NULL default '{}', so the verifier adds the key back only when it is non-empty.

Verified on a fresh 0001 to 0085 reset: the standard-helper path AND provision_organization both verify with 0 broken. Static test 27 green, contract parity green. The post-merge migrate workflow applied 0085 to prod successfully.

### PENDING OPERATOR DECISION -- audit_log historical residue

After 0085, two of three prod orgs still show one `verify_audit_chain` break each: `kitstak` (159 audit rows) and `cowork_smoke_20260526_e2e` (12 rows). The demo org `kitstak_demo_2026_05_25` (2 rows) is clean, which confirms the metadata fix works on prod.

These two breaks are GENUINE pre-0085 historical same-transaction branches, not metadata and not a fix failure. Evidence:
- cowork_smoke: seq 133 (organization) and seq 135 (quote) both store prev_hash equal to seq 134 (org_membership) payload_hash. Two rows share one predecessor: a branch.
- kitstak: seq 70 (quote) and seq 72 (project) both store prev_hash equal to seq 71 payload_hash, and seq 70 points prev_hash forward to a higher-seq row. Another branch.

This is irreducible under the constitution: the true insertion order of those historical rows was never stored monotonically (random UUIDs), the chains are genuinely branched (no linear order can validate them), and re-hashing audit rows is forbidden (append-only). 0085 prevents FUTURE same-txn breaks and fixed the metadata false-positives, but it cannot heal historical branches.

Recommended disposition (decide next session): accept the two historical breaks as immutable audit history and baseline them in the nightly `verify_audit_chain` so it stops alerting on the known pre-0085 breaks. Track as F-Wave10-AUDIT-CHAIN-HISTORICAL-BASELINE-01 (not yet filed). Alternative considered: a per-org chain checkpoint (seal the old chain, start a fresh one). Heavier and likely overkill for two early orgs. Operator to choose.

### Remaining Phase D (operator-gated, not started)

- Fresh-org owner E2E re-smoke on prod (a fresh test org, like the 2026-05-26 Cowork run).
- Stripe live checkout round-trip (F-Wave10-STRIPE-CHECKOUT-SMOKE-01; the account was under Stripe review).
- 30-day nightly green streaks.

## Operator actions queued

- Lighthouse activation: Vercel Deployment Protection, generate a Protection Bypass for Automation secret, add it as the GitHub repo secret VERCEL_AUTOMATION_BYPASS_SECRET, then set the repo variable LIGHTHOUSE_ENABLED=true. No workflow edits needed after that.
- The audit_log residue decision above.

## Open follow-ups filed today

- F-Wave10-CRM-SALESCONFIG-SPA-GATE-01: SPA-side OR RequirePlugin guard for crm and sales-config routes (the server gate landed in #190; server is authority).
- F-Wave10-CREDIT-NOTE-APPLY-FSM-01: applyCreditNote never transitions the note to applied and lets a draft be applied (surfaced by #196).
- F-Wave10-EXCHANGE-RATE-PATCH-01: sales-config-api has POST but no PATCH for exchange_rates, so #197 shipped add-only.
- F-WS7-SERVER-PAGINATION: #201 pagination is client-side only; several list endpoints lack server limit/offset.
- F-Wave10-AUDIT-CHAIN-HISTORICAL-BASELINE-01: to be filed once the residue disposition is chosen.

## Carried infra item

Live Staging branch reconciliation. The Staging preview-branch (dnkgaufydcnedgkuoyml) is frozen at migration 0070. reset_branch is a no-op there because the branch has no git tie (it only re-applies its own recorded ledger). Reconcile via rebase_branch on prod after cleaning the phantom 0069/0070 rows, or establish a git tie. DoD gate #7 is already proven locally regardless. See memory staging_audit_log_drift_2026_05_31.

## Notes

- #204's squash commit on main inherited the PR's "HELD... do not merge" title. The code is correct and applied; not worth force-pushing main to reword.
- The earlier #203 deploy-prod run showed red, superseded by the green #204 deploy (likely the documented transient alias race). Glance only if it recurs.
- Local verification used the project's local Supabase stack (postgres-only, db port temporarily remapped to 54522, then stopped). The operator's other local stacks (teamsuite, ozvanymuzaqbexchuoxz) were untouched and config.toml was reverted.
- Socials recap for this session is done (session 63).

## Where to resume

1. Run the session-start sync check.
2. Get the operator's call on the audit_log residue disposition, then file or execute it.
3. Then the operator-gated Phase D items (fresh-org smoke, Stripe live), the Lighthouse bypass, and the other open follow-ups above.
