# Closeout: recurring-billing operationalization, tier-editor polish, and audit-created-symmetry extension

Date: 2026-06-24. Continues the same-day tiered-quoting and recurring-billing
closeout (`2026-06-24-tiered-quoting-recurring-billing-closeout.md`). That wave
took ADR 0004 and ADR 0005 from foundation to end-to-end through migration 0138
and left three follow-ups. This session closes all three.

## Scope

- Operationalize ADR 0005 Phase 2. The 0138 generator and its daily pg_cron were
  live but no `recurring_schedules` rows existed, so nothing billed. This adds the
  schedule-CRUD edge endpoint and the project-detail control that turns recurring
  billing on.
- The per-tier inline line-field editor in `QuoteTiersPanel` (ADR 0004 polish).
- The pre-existing app-wide created-audit symmetry follow-up
  (F-Wave9-AUDIT-CREATED-SYMMETRY-01).

## Deliverables (PRs and migrations)

Three PRs. One migration (0139).

| PR | Unit | Migration | Status |
|----|------|-----------|--------|
| #387 | ADR 0005 Phase 2.2 schedule CRUD (invoicing-api endpoints + finance canon + project-detail control) | none | merged, prod-verified (c36ada0) |
| #388 | ADR 0004 per-tier inline line-field editor in QuoteTiersPanel | none | merged (7c4852d, autonomous SPA) |
| #389 | created-audit symmetry extension to post-0070 entities | 0139 | merged, prod-verified (c9f2fe4) |

## Risks closed

- Recurring billing is now operable end to end. `invoicing-api` gains
  `POST /recurring-schedules` plus `:id/pause`, `:id/resume`, `:id/end` and a
  `GET` list, each idempotency-keyed and org-scoped, reusing the invoicing
  read/write caps (no new capability). One live schedule per project (a second
  create returns 409) so the daily generator can never double-bill. Status
  transitions use the same compare-and-set lost-write guard as the invoice
  transitions. A `RecurringBillingControl` on the project-detail Invoices tab
  starts, pauses, resumes, or ends the schedule, gated on `invoices.write`.
  `resume` was added beyond the create / pause / end / list brief because a
  paused schedule with no resume is a dead-end.
- The tier-building panel now edits a line's fields in place. Each tier line's
  Edit expands an inline editor (name, SKU, quantity, unit price, discount, tax,
  billing interval) saving through the existing line-update path, replacing the
  jump to the page-level EDIT LINE form. The page form stays for the non-tiered
  flat table.
- Created-audit symmetry is extended. The investigation found the follow-up was
  largely already closed: migration 0070 (and 0061) gave 18 core entities a
  `created` audit row, and prod confirmed it live (quote, invoice, customer,
  project, and more all carry created rows). The real gap was the entities
  shipped after 0070: the 3PL, Co-Pack, KitForce, and WMS pillars plus
  `quote_tiers` and `recurring_schedules`. 0139 adds AFTER INSERT triggers for 19
  such entities, reusing the 0070 `kitstak_audit_created` helper unchanged.

## The audit_log CHECK landmine (caught on staging)

The staging dry-run surfaced a regression the static tests could not: the
`audit_log_entity_type_check` constraint did not list `recurring_schedule` or
`quote_tier` (the only two of the 19 not already admitted), so the new created
trigger's audit insert failed the CHECK and aborted the parent insert. 0139
extends the CHECK (drop and re-add as a strict superset, the same `in (...)`
style 0110 used) so every existing row still validates. The db-0083 superset
invariant guard moves its authoritative-redefinition pin from 0110 to 0139.

## Risks carried (follow-ups)

- None functional. The created-audit extension is forward-only with no backfill,
  matching 0070: entities created before 0139 carry no `created` row, the same
  treatment 0070 gave pre-2026-05-27 entities. A future backfill across the
  per-org hash chain is out of scope and unscheduled.
- Housekeeping only: the de-registered `wizardly-curie` worktree left a physical
  `node_modules` folder that Windows long-path deletion could not remove; git no
  longer tracks it.

## Constitutional invariants verified

- Money: untouched. Schedule CRUD manages only the schedule row; the generator's
  banker's-rounded invoice math (0137 / 0138) is unchanged. The inline editor
  sends only trusted inputs; the server owns every `_cents` and the tax snapshot.
- Zod canon: the `RecurringSchedule` read shape and `CreateRecurringScheduleRequest`
  were added byte-identical to both `finance.ts` mirrors (parity 47/47 on #387).
- RLS: `recurring_schedules` keeps its 0138 Pattern A RLS; the edge path is
  service-role with an explicit `org_id` filter, and a cross-tenant project
  resolves to 404 via `assertRefInOrg`. The audit triggers are SECURITY DEFINER,
  writing `audit_log` under the table owner, preserving the append-only posture;
  `quote_tiers` derives its org from the parent quote (the 0070 project_phases
  pattern).
- Idempotency: every non-GET schedule handler enforces the Idempotency-Key.
- Capabilities: no change. Schedule CRUD reuses `invoices.read` / `invoices.write`.
- Audit: 0139 is the audit-symmetry expansion. The hash chain and per-org
  advisory lock live entirely in the reused 0070 helper; existing transition
  triggers are untouched.
- Migrations: 0139 is forward-only, idempotent (CREATE OR REPLACE, DROP TRIGGER /
  DROP CONSTRAINT IF EXISTS), carrying the canonical header. The
  migration-header-format-guard passes.
- Validation: #389 was validated on staging (`dnkgaufydcnedgkuoyml`) in an
  aborting transaction proving the warehouse (null-status, direct org),
  recurring_schedule (status path), and quote_tier (parent-derive) triggers each
  fire and write a chained created row, then rolled back to zero trace. The
  schedule-CRUD edge SQL (#387) was likewise validated against the live staging
  schema in an aborting transaction. Both verified directly on prod
  (`zmnvwhqjahwidprnjxrq`) after the workflows ran: max_migration 0139, the 19
  created triggers live, the entity_type CHECK extended.

## Gates

Every PR: typecheck, lint (0 warnings), unit and regression, contract parity
(47), and CI green including RLS and e2e against staging, build, and the prod
deploy. The schedule-CRUD edge was exercised through 14 handler tests under the
Supabase mock plus 6 control-state unit tests; the audit migration carries 120
static assertions plus the 0083 superset guard; the full suite stands at 1116
passing / 2 skipped. #388 (SPA-only) merged on green; #387 (canon) and #389
(migration plus audit_log) were held for operator sign-off and merged by the
operator.

## Prod state at closeout

Prod at migration 0139. Recurring billing is usable from the project-detail
Invoices tab; the daily generator stays a no-op until an operator starts a
schedule. The tier-building panel edits lines in place. Every entity created
across the spine and the four add-on pillars now writes a `created` audit row.
Open PRs: none.
