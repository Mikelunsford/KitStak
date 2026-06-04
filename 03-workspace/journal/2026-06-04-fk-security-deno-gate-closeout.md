# Session closeout: 2026-06-04 (cross-tenant FK security fix, edge Deno gate, FK-validation follow-ups)

Branch state at closeout: `main` clean and synced to origin, single branch. The
working tree carries only the operator's pre-existing pending changes (the
`CLAUDE AGENTS` deletions, `audit-output/`, `3pl-job-builder-planning.md`), which
were stashed and restored around the branch work and are unrelated to this
session's commits. Five PRs resolved: four merged to prod (#238, #240, #241,
#242) and one closed as superseded (#239).

## Headline

Closed the cross-tenant foreign-key gap that two prior audits flagged as the top
risk, then hardened the surrounding surface. Every client-supplied foreign key
across all edge bundles is now org-checked before a write. A Deno typecheck gate
guards the edge functions on every PR, and the three FK-validation follow-ups are
resolved. The grade moved from B+ with a known multi-tenant soft spot to B+ with
that soft spot closed.

## 1. Read-only optimization audit

Ran `.claude/audits/03-claude-code-orchestrator-readonly.md` as a background
workflow: 73 read-only agents across pillars, edge bundles, cross-cutting lenses,
and hotspots, plus two deepen rounds and a three-pass cross-check. About 5.76M
agent tokens, roughly 52 minutes. Output is untracked in `audit-output/`
(`kitstak-optimization-audit.md`, 657 lines, and `raw-findings.json` with all 550
raw findings). Nothing in the repo was modified; the audit agents were read-only
by construction.

Verdict: the constitution holds. 21 byte-mirror pairs verified identical, RLS
Pattern A explicit `org_id` binding confirmed across handlers, money and
idempotency and plugin-gate patterns compliant. 105 deduped findings: 69 confirmed
safe, 31 deferred to a write pass, 5 constitutional stops. Density was not fully
resolved (deepen capped at two rounds with 16 residual high-density sub-areas,
concentrated on the FK cross-tenant cluster and an auth-api N+1 cluster). Grade:
B plus, held back largely by the cross-tenant FK class below.

## 2. Cross-tenant FK security fix (PR #238)

Root cause: every foreign key in the schema is a plain single-column constraint
that checks existence, not org (verified via `pg_constraint`; zero composite
`(id, org_id)` FKs). Edge handlers write with the service-role client (which
bypasses RLS), so a client-supplied FK id could persist a reference to another
tenant's row. The proven breach: `payments.applyPayment` and
`credit_notes.applyCreditNote` accepted an `invoice_id` validated only as a UUID;
the SECURITY DEFINER recompute triggers then ran a bare cross-org `UPDATE invoices`,
mutating the victim org's `paid_cents` and status and forging a row into its
append-only `audit_log`. Same class as the 2026-06-03 e2e/security audit CRITICAL.

Fix: a new shared helper `assertRefInOrg(table, caller, id, options)` in
`supabase/functions/_shared/crud.ts` does an org-scoped existence check and throws
`NOT_FOUND` 404 (the constitutional answer for a cross-tenant reference on a write,
never 403, and indistinguishable from "does not exist" so it leaks no existence
oracle). It is called, or an existing org-scoped helper is reused, before every
client-supplied FK write across 14 bundles: invoicing, finance, crm, vendors,
projects, ops, inventory, copack, manufacturing, kitforce, quotes, sales-config,
collaboration, imports. About 129 call sites. The polymorphic `activities.entity_id`
fails closed on an unmapped `entity_type`; `owner_user_id` validates against
`org_memberships.user_id`; `quote_line_items` has no `org_id` and is skipped
(parent-scoped via its quote).

Coverage was verified against the authoritative `pg_constraint` list, not an
agent enumeration. That cross-check caught gaps the scoping agents missed:
`shifts.team_id` and `warehouse_id`, copack fulfillment `warehouse_id` and
`shipment_id`, `quotes.default_tax_id` / `payment_method_id` / `pricing_tier_id`,
`projects.job_type_id`, and the imports raw-row FK columns. All closed.

The validation broke three edge-handler regression mocks (ops and manufacturing
round-trip plus auto-numbering) because `assertRefInOrg` queries parent rows
(`warehouses`, `projects`) the mocks did not seed. CI caught this before merge.
Fix: seed those parents in the affected `test/regression` state builders. A new
"Category 12" block in `apps/web/playwright/rls-probe.spec.ts` probes the proven
paths: payment apply, credit-note apply, and PO create with a foreign tenant id
must all 404.

How it was built: read-only scoping agents, then a 14-bundle edit-and-review
Workflow, then a static cross-check of all call sites, then the authoritative
`pg_constraint` audit, then an adversarial completeness review. Lesson: drive
FK-coverage work from `pg_constraint`, not from agent enumeration.

## 3. Two substantive type fixes (PR #240)

The Deno gate (below) surfaced two errors worth a real look, fixed standalone:

- `stripe-webhook` pins `apiVersion: '2024-09-30.acacia'` on purpose so SDK
  upgrades do not change the wire shapes Stripe sends. The `stripe@17` types only
  accept their `LatestApiVersion` literal, so the value is cast to
  `Stripe.LatestApiVersion` to keep the deliberate pin. Zero runtime change.
- `kitforce` time-entry clock-in compared `hourly_rate_cents` (the integer-or-
  string money wire type) with `> 0` and could snapshot a string into the BIGINT
  cents column. Coerced to a number for the comparison and the snapshot; identical
  branch logic.

Verified with a locally installed Deno 2.1.4: both bundles typecheck clean.

## 4. Edge functions made Deno-clean and the gate enabled (PR #241)

`supabase functions deploy` bundles with esbuild, which transpiles but does not
typecheck, so a Deno-side type error only surfaced post-merge at deploy. Adding a
`deno check` step to `ci.yml` revealed 47 pre-existing type errors. 44 were the
untyped service-role client cast pattern (`const { data } = await admin().from(...)
.select(...)` then `data as Row`), resolved with `as unknown as Row` (Deno's own
recommendation). The substantive ones: a `dashboard-api` helper typed its callback
parameter as `PostgrestQueryBuilder` but received a `PostgrestFilterBuilder`, which
cascaded into eight property-access errors, fixed by hoisting the org-scoped query
into a typed helper; a `leads.ts` status guard against `'converted'` (a value the
Zod schema already rejects) was preserved as a runtime backstop via a cast.

The gate runs `deno check --node-modules-dir=none --import-map=
supabase/functions/deno.json` over every bundle entry point (handlers and
`_shared` covered transitively). `node-modules-dir=none` resolves the `npm:`
import map from Deno's own cache, matching the edge runtime, and avoids the pnpm
`node_modules` confusing Deno's resolver. `deno check` exits 0 on all 28 bundles.

PR #239 was the initial gate-only draft off stale main; it is closed and
superseded by #241, which carries the gate plus the cleanup so the gate goes
green.

## 5. FK-validation follow-ups (PR #242)

The three open follow-ups from #238, operator-approved (flip default plus opt out,
allowlist):

- Soft-deleted referents: `assertRefInOrg` now filters soft-deleted parents by
  default. Of all FK parent tables only three lack a `deleted_at` column
  (`chart_of_accounts`, `expense_categories`, `org_memberships`); those call sites
  opt out with `softDelete: false` so the filter never errors. Blocks linking new
  or repointed records to deleted entities. Low churn: one helper default plus the
  opt-outs.
- Batch validation: new `assertRefsInOrg(table, caller, ids)` validates many ids
  in a single `where in (...)` query. Replaces the per-id loops in journal-entry
  line validation (`account_id`) and the imports commit.
- Imports mass-assignment (MASSG-IMPORTS-01): the commit handler now inserts the
  Zod-parsed row (declared columns only) plus server-set `org_id` / `created_by` /
  `updated_by`, instead of spreading the raw client row. A client can no longer
  inject `created_by`, `id`, `status`, or any undeclared column. The FK map is
  reduced to schema-declared FKs since undeclared columns are now stripped before
  insert.

Process trap caught and recovered: the #242 branch was cut from stale local `main`
(before #241 merged), so the cleanup errors reappeared plus one new cast I had
introduced in the batch helper. Rebased onto current `origin/main` and fixed the
cast.

## New finding (separate open follow-up)

While building the imports allowlist I found the import `RowSchemas` declare column
names that do not match the target tables: invoice `number` vs `invoice_number`,
customer `email` / `phone` vs `primary_email` / `primary_phone`, item
`unit_of_measure` vs `unit_id`, expense `number` vs `expense_number`. So the import
feature is likely broken for four of five entities regardless of #242 (the insert
would fail on a non-existent column). #242 deliberately did not change the import
wire contract (the SPA builds the payload), only the insert allowlist. A separate
fix should align the schemas to real columns and verify the SPA payload.

## Constitutional invariants verified

- 404 not 403 on every cross-tenant write. RLS, money, idempotency, and `audit_log`
  observed only; none changed.
- No byte-mirror pair touched (`crud.ts` is not mirrored; the contract suite stayed
  green).
- Forward-only: no migration, no schema change in any of the four PRs.
- No new dependency. Branding held on disk (no em dashes, double hyphens, or emojis
  in code or comments).

## Verification

- Deno 2.1.4 installed locally; `deno check` exits 0 on all 28 bundles after each
  change.
- `pnpm --filter web test` green throughout: 724 src plus 438 regression tests. The
  regression mocks treat a missing `deleted_at` as null, so the soft-delete flip is
  behavior-preserving against the seeded fixtures.
- All four merges deployed via deploy-functions (the FK fix is live in prod). The
  Deno gate validated #242 on the PR itself, proving the gate works on real PRs.

## Open follow-ups

- Import column-mapping fix (the new finding above): align `RowSchemas` to real
  table columns and verify the SPA import payload.
- Lower-priority polish carried from the optimization audit: DataTable column sort
  (F-Wave10-UI-KIT-DATATABLE-SORT-01), server pagination (F-WS7-SERVER-PAGINATION),
  index-coverage migrations on `org_id` / FK / status columns, the auth-api N+1
  `getUserById` batching in `listOrgMembers`.
- The read-only optimization audit's residual high-density areas (16 sub-scopes)
  remain a candidate for a deeper pass; the full list is in
  `audit-output/raw-findings.json` under `stillHigh`.

## Process notes

- Drive FK-coverage from `pg_constraint`, not agent enumeration. The authoritative
  cross-check found real gaps two rounds of scoping agents missed.
- Always branch from current `origin/main`, not stale local `main`, when prior PRs
  in the same session have merged; otherwise a rebase is needed and merged fixes
  reappear as conflicts or errors.
- A reviewer agent false-flagged `credit_notes.ts` as bundling a security change
  into the Deno cleanup; the actual diff was two casts. #238's already-merged
  content was mis-attributed as new. Always verify a blocking review flag against
  the real `git diff` before acting.
