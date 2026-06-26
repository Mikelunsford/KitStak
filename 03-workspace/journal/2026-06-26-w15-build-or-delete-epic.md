# Wave 15: the build-or-delete epic (2026-06-26)

A review-to-remediation arc on the unwired mutation and feature surface. Three PRs
merged to prod: edit surfaces operators were missing, a data seed for the one
permanently-empty dropdown, and a dead-code sweep of the scaffolding that was
never going to be wired. All gates green, constitution clean, migration staging
validated and prod verified.

## The arc

1. A deep review of the codebase for dead code, unwired elements, incomplete
   features, and broken end-to-end business logic. Sixteen parallel auditors,
   each self-verifying with repo-wide greps, then an adversarial pass over every
   P0 and P1. Report at `03-workspace/audits/review-codebase-2026-06-26.md`.
2. A build-or-delete scope over the unwired mutation surface the review found.
   Sixteen scoping analysts plus a v1 strategist decided, per surface, build the
   UI or delete the scaffolding. Register at
   `03-workspace/audits/epic-build-or-delete-scope-2026-06-26.md`.
3. Execution: build the four v1-relevant surfaces, seed the empty dropdown, and
   delete the rest.

The review's headline finding was that the dominant defect was not a security or
money problem but a large built-but-unwired mutation surface: edit and delete
chains plumbed service to hook to edge route across roughly ten domains with no UI
caller. Each was simultaneously dead code and a missing edit capability. The scope
resolved it: about 85 percent delete, 15 percent build.

Good news from the review, recorded so it is not re-flagged: both prior P0 or HIGH
broken links from the 2026-06-19 wiring map (the StockMovements receiving_order
and production_run source cells) are fixed at HEAD, resolved by the nav redesign.

## What shipped

### PR #397, edit surfaces (squash 41ccf2d)

Three already-built-but-unsurfaced mutation paths wired to the SPA. Every edge
route was already requireCap plus respondWithIdempotency plus assertRefInOrg, so
this is SPA-only: no schema, RLS, money, idempotency, audit_log, or capability
change.

- Account edit. AccountEditPage at `/3pl-operations/accounts/:id/edit` over the
  live useUpdateAccount hook, with a capability-gated Edit button on the detail
  page. Highest value: a 3PL account's account_number is pinned by job runs,
  supply plans, and billing reviews, so there is no clean recreate path.
- Project header edit. ProjectEditPage at `/projects/:id/edit`, a new updateProject
  service and useUpdateProject hook, and UpdateProjectRequestSchema added
  byte-identical to both sales.ts mirrors (contract parity held, verified by
  SHA256). The project number is shown read-only, not patched.
- Payment detail plus delete-revive. A read-only PaymentDetailPage at
  `/invoicing/payments/:id` mirroring CreditNoteDetailPage, the list row repointed
  off the apply stub to the detail, and useDeletePayment wired behind a destructive
  confirm and the payments.delete gate. Payments are the one entity with no FSM
  cancel, so soft-delete is the sole mis-keyed-payment remedy.

Reviewed by three specialists (code, constitution, security). One finding fixed
before merge: the Project Edit button now gates on projects.project.write to match
the Account pattern.

### PR #398, expense-category seed (squash cf77101, migration 0142)

The one permanently-empty dropdown in the scope. The Expenses category select had
no provisioning seed, so on every org it was empty and an expense could only be
saved uncategorized. Migration 0142 mirrors 0130_seed_default_job_types exactly:
an idempotent seed function (ON CONFLICT (org_id, code) DO NOTHING, SECURITY
DEFINER, service_role only), wired into provision_organization, plus a one-shot
backfill. Eight default categories: Freight, Packaging, Warehouse Supplies,
Equipment, Software, Utilities, Labor, Other.

Operator sign-off was held for the provision_organization change, then validated
on staging (`dnkgaufydcnedgkuoyml`, reachable by ref though it lives in a separate
org): 4 orgs seeded to exactly 8 categories each, re-run idempotent, function
SECURITY DEFINER with anon execute denied and service_role granted, provision wired.
Prod verified after the migrate workflow: all 6 prod orgs now carry 8 categories
(48 rows). The empty dropdown is fixed in production.

### PR #400, dead-code sweep (squash 18feb4c, replaced #399)

The delete half of the scope. About 1,621 lines removed across 53 files, 8 whole
files deleted, in 6 domain commits. Executed as six sequential agent batches, each
self-verifying with typecheck, committed only after its files were staged
explicitly:

- 3PL commercial: 13 edit and soft-delete hooks plus 13 service fns.
- Inventory and ops: the divergent receive-RPC, warehouse-delete, receiving and
  shipment header and line update hooks and services, plus the two unrouted legacy
  production pages (F-Wave9-LEGACY-PRODUCTION-ROUTE-RETIRE-01).
- Co-Pack: sales-order, kitting-job, and kitting-line edit hooks and services.
- WMS: location, putaway, and lot edit and soft-delete hooks and services, plus
  the single-row bin-stock read.
- PO, AR, KitForce, catalog, CRM: PO line edit and delete, payment edit,
  time-entry delete, item delete, tax delete, and the CRM delete, get, and
  update-activity wrappers plus their barrel re-exports.
- Shell and pages: the never-mounted NotificationsBell, the dead fail-open
  RequireFlag guard, the CommandBar-superseded GlobalSearchBar, the stranded
  DashboardSummaryPage, the orphan QuoteSendPage, notificationsService, the
  notification hooks and keys, the dead portal-attachments service and keys, and
  the `/dashboard/summary`, `/quotes/:id/send`, and legacy send-redirect routes.

Kept deliberately: every byte-mirror Zod canon type (only the SPA-local re-exports
were removed), all live list, create, lifecycle, and FSM hooks, the three symbols
#397 made live (useUpdateAccount, useUpdateProject, useDeletePayment), and all
cap-gated edge routes, which stay dormant per the scope's leave-dormant call.

## Gates

Every PR green: typecheck, lint, the full unit and regression suite (1141
passing, 2 skipped), contract and parity, build (index chunk 38.45 kB gzip, under
the 40 kB gate, shaved by the sweep), bundle-budget, and CI including RLS and e2e
against staging. The sales.ts mirror was confirmed byte-identical by SHA256.

## Constitutional invariants verified

- Money: untouched. No new monetary math, expense_categories has no _cents column.
- RLS: untouched. expense_categories keeps its 0028 Pattern A policies.
- Idempotency: the edit edge routes already enforce Idempotency-Key; apiClient
  attaches it. The seed is idempotent via ON CONFLICT.
- Audit: untouched. expense_categories has no audit trigger.
- Migrations: forward-only, 0142 numbered after 0141, all DDL idempotent, full
  header with a DOWN MIGRATION block.
- Capabilities canon: untouched. The sweep removed only SPA service re-exports,
  never a capability; the builds reuse existing caps. Server stays the
  authorization authority.
- Branding: no banned imports, no em dashes or double hyphens or emojis in copy.

## Risks closed

- R-W15-EDIT-03 (project header edit), R-W15-EDIT-05a (account edit), R-W15-AR-01
  (payment detail and delete-revive): built.
- R-W15-EDIT-02 (empty expense-category dropdown): seeded, prod verified.
- The dead-code half of R-W15-EDIT-01, 05, 06, 07, 08, 09 and the related P3 dead
  hooks: deleted.
- F-Wave9-LEGACY-PRODUCTION-ROUTE-RETIRE-01: the two legacy production pages and
  their hooks and services are gone.

## Risks carried

- R-W15-CRM-01 (lead conversion unreachable: no SPA control advances a lead to
  qualified, so CONVERT never renders) and R-W15-EXPORT-01 (Exports Download CSV
  navigates to a relative unauthenticated URL and 404s). Both are P1 review
  findings outside the build-or-delete scope, still open. Suggested next:
  `/implement R-W15-CRM-01`, `/debug R-W15-EXPORT-01`.
- Leave-dormant backend surfaces (quote versions and approvals and hard-delete,
  structured units, item_categories): intentionally untouched, removing them is
  canon churn plus a migration for near-zero v1 value.
- R-W15-CONFIG-01 correction: the review flagged the job-types dropdown as
  permanently empty, but it was already seeded by migration 0130 on 2026-06-23.
  Only the expense-category half was a real gap, now fixed. The review doc carries
  a correction note.

## Process notes

- The whole arc was run as a sequence of dynamic Workflows: a 16-auditor review,
  a 16-analyst scope plus a strategist critic, a 4-agent build recon, and a
  6-analyst deletion-spec pass, then sequential editor agents per delete batch.
  Each finding and deletion was grep-verified before action; the build diff went
  through a parallel three-specialist review before commit.
- Infrastructure discoveries, saved to memory: the Supabase MCP can come up bound
  to the separate "KitStak v.02" parallel build, so verify list_projects shows
  prod `zmnvwhqjahwidprnjxrq` at session start. Staging `dnkgaufydcnedgkuoyml` is
  live but in a different org, so it is absent from list_projects yet reachable by
  ref.
- The dead-code branch was stacked on the build branch so the live-versus-dead
  analysis stayed correct (the three build-live symbols were excluded). When #397
  merged and GitHub deleted its base branch, the stacked #399 auto-closed; the
  branch was rebased cleanly onto main and reopened as #400.
