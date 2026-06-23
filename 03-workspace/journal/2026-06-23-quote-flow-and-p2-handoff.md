# Handoff: Quote flow plan execution and the P2 wave (2026-06-23)

Status: in progress. This is a handoff, not a wave closeout. The P0 and P1 work
is shipped and live; P2 is partway through and continues from here.

Source plan: `Kitstak-Quote-Flow-Implementation-Plan.md` in the sibling repo dir
`C:\Users\Mike Lunsford\Desktop\KitStak\TS1 Kitstak combo\Cowork Output\` (a
walkthrough of kitstak.com on 2026-06-23). It is NOT in this repo.

## Shipped and live on prod (verified directly via the Supabase MCP)

All P0 and P1 quote-flow tasks, seven PRs, squash-merged to main and deployed:

- #365 P0-1: quote state actions update the detail view without a reload
  (authoritative setQueryData in `apps/web/src/lib/hooks/quoteActionCache.ts`).
- #366 P0-2: no customer-UUID flash on the quote header (loading gate
  `resolveCustomerLabel.ts` + a cache seed in QuoteCreatePage).
- #367 P1-3: Duplicate quote. migration 0129 `duplicate_quote` SECURITY DEFINER
  RPC + `POST /quotes/:id/duplicate` + SPA button and list row action.
- #368 P1-1: live estimated subtotal on the create screen (`quoteLineEstimate.ts`).
- #369 P1-2: tax / payment / pricing-tier pickers replace the raw-UUID fields.
- #370 P1-4: migration 0130 seeds the six default job types for every org and
  wires `seed_org_default_job_types` into `provision_organization`.
- #371 P1-5: `formatQuantity` helper, em-dash-free list placeholders. (Sell KPI
  cards were already wired; the walkthrough "empty" was the zero-state.)

ADRs (PR #372, merged):
- ADR 0004 native tiered quoting. Accepted, Option A.
- ADR 0005 recurring billing interval. Accepted, line-level, Phase 1 first.

ADR 0005 Phase 1a (PR #373, merged): migration 0131 adds `billing_interval`
(`one_time` default, monthly) to `quote_line_items`; canon both mirrors; quotes-api
add/patch carry it; the create-page lines editor has a One time / Monthly
selector.

Prod verification (2026-06-23): max_migration 0131; `duplicate_quote` live; 36
job types (6 orgs x 6) backfilled; `billing_interval` column live with default
`one_time`.

## Open, awaiting operator merge

- #374 ADR 0004 foundation (unit 1 of the tiering wave). migration 0132 creates
  `quote_tiers` (child of quotes, Pattern B RLS) plus a nullable
  `quote_line_items.tier_id` FK (ON DELETE CASCADE) and the canon
  (`QuoteTierSchema`, `tier_id` on the quote-line read shape). Behaviour
  preserving: nothing creates a tier yet, so every line stays `tier_id` null.
  CI green, staging-validated (tier_id set, cascade delete works, zero trace).
  Flagged halt-for-merge because it adds an RLS table and a column on the
  load-bearing quote line table.

Note on the merge instruction (2026-06-23): the operator asked to "merge #347",
which is an old already-merged PR (the list-toolbar rollout). The intended PR is
#374. The auto-merge classifier blocked a #374 merge under the #347 instruction;
the merge is held for explicit operator confirmation of the correct number.

## Remaining work (not started)

### ADR 0004 native tiered quoting wave (build off main after #374 lands)
Each is its own focused, staging-validated, halt-for-merge PR:
1. Tier-grain recompute. Redefine `recompute_quote_totals` to roll up per tier and
   populate `quote_tiers.{subtotal,discount,tax,total}_cents`. Decide the quote
   header total when tiers are present (the ADR allows null or the accepted
   tier's total). Keep the non-tiered path byte-identical (tier_id null).
2. Tier CRUD on the edge. quotes-api tier endpoints (create / update / delete /
   reorder), gated on `quotes.quote.write`. Add `tier_id` to the line
   create/update request (currently omitted on purpose). Idempotency-Key on the
   non-GET handlers.
3. Tier-building SPA. Add / remove tiers, lines per tier, per-tier totals, on the
   quote detail and create screens.
4. Multi-tier PDF. The pdf-worker quote template renders a section per tier.
   Exercise the rendered document once against a real tiered quote.
5. Convert. `convert_quote_to_project` gains a `tier_id` argument so the operator
   picks the accepted tier; only that tier's lines copy into the project. A
   non-tiered quote passes null and converts as today.

### ADR 0005 recurring billing
- Phase 1b: carry `billing_interval` through `convert_quote_to_project` and
  `convert_project_to_invoice` onto `project_line_items` and `invoice_line_items`,
  with their canon (ProjectLineItem in sales.ts, InvoiceLineItem in finance.ts,
  both mirrors).
- Phase 1a.2: the interval toggle on the QuoteDetailPage add-line and edit-line
  forms (Phase 1a put it on the create-page editor only; the detail-page
  add-line and template-applied lines default to one_time).
- Phase 2: a pg_cron recurring-invoice generator in invoicing-api plus a
  `recurring_schedules` table (RLS from its migration; idempotent per period).

### P2-3 draft PDF preview
A minor UX tweak (a watermarked draft preview, or rewording the "Send unlocks the
PDF" tooltip in `pdfGating.ts`), not an architecture decision. Operator yes/no
pending.

## Operating notes for whoever resumes

- Staging Supabase ref `dnkgaufydcnedgkuoyml` is usable via the MCP `execute_sql`
  (pass it as `project_id`) even though it is absent from `list_projects`.
  Validate every migration there in an aborting transaction: `begin;` the DDL,
  then a `do $$ ... $$` block that builds fixtures, calls the function, and
  `raise exception` with the assertion values to force the rollback AND surface
  the results in the error, then `rollback;`. Leaves zero trace. Do NOT run
  `next_doc_number`-consuming SQL on prod (it may gap numbering).
- Prod Supabase ref `zmnvwhqjahwidprnjxrq`. After a migration PR merges, the
  `migrate` workflow applies it to prod; verify directly via the MCP.
  `deploy-functions` redeploys the edge bundles; Vercel `deploy-prod` ships the
  SPA. All three plus CodeQL should go green.
- The Zod canon is byte-identical between `supabase/functions/_shared/types/*.ts`
  and `apps/web/src/lib/types/*.ts` (same line numbers). Edit both. `pnpm
  test:contract` is the parity gate and a drift is a release blocker.
- Gotcha: a request-schema field with `.default()` makes the `z.infer` (output)
  type REQUIRED, so every constructor of that request type must set it. Adding
  `billing_interval` broke `applyJobTemplate.ts`, the QuoteDetailPage add-line,
  and the w13-ux-02 test until each set it. Expect the same when `tier_id` lands
  on the line create/update request.
- Migration regression tests assert the SQL text (mirror `db-0094` /
  `db-0129` / `db-0132`), since apps/web has no live-DB harness. Watch for
  over-broad negative regexes (a `where x is not null` partial index tripped the
  db-0132 "nullable" check).
- `migration-header-format-guard` enforces the canonical header on every future
  migration; include the separator, Migration, Wave, Phase, Closes, Date,
  Constitutional alignment, and a DOWN MIGRATION note.
- Worktrees under `.claude/worktrees/*` have no node_modules; run `pnpm install`
  once. Run vitest / git / gh via PowerShell. Commit via `git commit -F`, open
  PRs via `gh --body-file` (PowerShell mangles inline quotes).
- One PR per task, branched off `origin/main`, squash-merged. Halt before merging
  anything that touches a migration, money helpers, RLS, idempotency, audit_log,
  or the Zod canon; the operator merges those.

## Memory

The durable state lives in `memory/quote_flow_plan_p0_execution.md` (indexed in
`MEMORY.md`). It is current as of this handoff.
