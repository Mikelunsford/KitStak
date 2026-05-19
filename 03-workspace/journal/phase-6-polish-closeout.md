# Phase 6 Polish Close-out (PRs #31 to #35)

Wave: 6
Phase: 6 polish (carryover from F-Wave6-FLOW-01)
Date: 2026-05-19
Branch: five hotfix branches across PRs #31 to #35, then docs branch `claude/dazzling-sanderson-38a562`
Status: Closed (baseline at `347062f`; Phase 6 polish carryover now empty)

Risks closed: `F-Wave6-WAREHOUSE-NAME-01`, `F-Wave6-ITEMS-403-01`, `F-Wave6-LINEFORM-01`, `F-Wave6-PRODUCTION-CREATE-01`, `F-Wave6-AUDIT-02`.
Risks filed: `F-Wave7-FK-RENDER-SWEEP-01`, `F-Wave7-MUTATION-ERRORS-SWEEP-01` (filed in PR #33), `F-Wave7-AUDIT-CACHE-SWEEP-01`, `F-Wave7-ESM-SH-DRIFT-01`.

## Context

PRs #24 through #29 closed the six bugs the operator hit while walking F-Wave6-FLOW-01 end-to-end on prod. The walk surfaced five additional clunky-UX items that were not gate-blocking and got bucketed as Phase 6 polish carryover at the close of that session. The operator opened the polish session the next morning. The orchestrator dispatched five agents in sequence; each shipped its own hotfix PR. Two of the five closeouts produced reframes that turned out to be the most durable output of the session: the AUDIT-02 root cause was not where it looked, and the deploy esm.sh pattern surfaced as a quietly load-bearing systemic risk.

This entry documents the five fixes, the two reframes, and the four Phase 7 follow-ups filed off the back of the session.

## Findings, in dispatch order

### PR #31. F-Wave6-WAREHOUSE-NAME-01. ReceivingOrderDetailPage raw UUID render

Symptom: `ReceivingOrderDetailPage` rendered `Warehouse: 8c9f2... (UUID)` instead of a human label. The operator could not tell which warehouse a given receiving order belonged to without cross-referencing Supabase studio.

Fix shape: page resolves `warehouse_id` via `useWarehousesList` and renders `{code} · {display_name}`, falling back to the raw UUID if the lookup returns nothing. SPA-only edit.

Spawned: `F-Wave7-FK-RENDER-SWEEP-01`. Five other detail pages render raw FK UUIDs in the same shape: ShipmentDetailPage, ProductionRunDetailPage, JournalEntryDetailPage, ContactDetailPage, LeadDetailPage. Sweep across all six pages, lift to a shared `<EntityLabel kind="warehouse" id={...} />` helper if the duplication justifies it.

PR: https://github.com/kitstak/app/pull/31 · commit `73e4a96`

### PR #32. F-Wave6-ITEMS-403-01. ItemPicker 403 on sales-config-api/items

Symptom: `ItemPicker` on every page that mounts it (Quote, Project, Invoice, PO, Vendor Bill, Expense create / detail) returned `403 FORBIDDEN` on `GET /sales-config-api/items`. Every role hit it, including `org_owner`.

Root cause: `sales-config-api/index.ts` imported `requireCap` from `_shared/handler-helpers.ts`. That helper validates against the singular byte-mirrored `_shared/capabilities.ts`, which carries only the 14 `org.*` capabilities seeded in Wave 1. Sales caps live in the sales side-car (`_shared/capabilities/sales.ts`). Every `sales.*` cap lookup against the singular canon failed, so every check fell through to the `FORBIDDEN` branch for every role. The bundle has been silently 403'ing since it shipped in Wave 2; nothing in the SPA exercised an authenticated `sales-config-api` route until Wave 6.5 mounted `ItemPicker` across the chassis.

Fix shape: new `supabase/functions/sales-config-api/_helpers.ts` shim consulting the sales side-car canon, identical to the established quotes-api / invoicing-api / projects-api pattern (D-011). One import line redirected in `index.ts`. The singular byte-mirrored `_shared/capabilities.ts` was not touched.

Deploy gotcha: first `deploy-functions` run on the merge SHA (run 26123760836) failed on a transient esm.sh 522 against `https://esm.sh/zod@3.23.8`. Rerun on the same SHA succeeded. This was the seed of the second reframe below.

PR: https://github.com/kitstak/app/pull/32 · commit `c06b545`

### PR #33. F-Wave6-LINEFORM-01. Add Material form silent fail on validation error

Symptom: operator typed `2.5` into the "Unit price (cents)" field on the Add Material form on `ProjectDetailPage`, hit Submit, nothing happened. No error surfaced, no row added.

Root cause: the submit handler called `await mutateAsync(...)` with no `onError` and no inline error surface. The server returned 422 `INVALID_INPUT` on the `2.5` non-integer cents value. The mutation rejected; the handler caught nothing; the form was left in its pre-submit state with no signal to the operator.

Fix shape: handler switched to `mutate(..., { onSuccess })` so React Query's error state is preserved on the mutation object. `addLine.error.message` rendered inline beneath the form, mirroring PR #21's convert-to-project pattern. Submit button disabled while pending. Label clarified from `Unit price (cents)` to `Unit price (whole cents, e.g. 250 = $2.50)` to defuse the dollars-vs-cents trap. Three lines of substantive code change.

Spawned: `F-Wave7-MUTATION-ERRORS-SWEEP-01` (filed in STATUS.md in PR #33). Grep across the SPA surfaces 128 `useMutation` call sites across 28 files. Seven of those are `*CreatePage.tsx` files in `pages/crm/` (Activity, Contact, Customer, CustomerEdit, Lead, Opportunity, OpportunityDetail) which sit on the operator's daily path and almost certainly silently swallow validation errors today.

PR: https://github.com/kitstak/app/pull/33 · commit `f6b8469`

### PR #34. F-Wave6-PRODUCTION-CREATE-01. Missing ProductionRunCreatePage and /new route

Symptom: operator clicked "New Production Run" on `ProductionRunsListPage`. Page rendered a 500. Same shape as the F-Wave6-WAREHOUSE-CREATE-01 root cause (PR #27): no `/new` route registered, URL fell through to `/:id`, Postgres threw on `where id = 'new'::uuid`, server surfaced 500.

Fix shape: mirror of PR #27. New `ProductionRunCreatePage.tsx` modeled on `WarehouseCreatePage.tsx` (the Wave 6.5 create-page convention). `/3pl-operations/production/new` registered before `/:id` in `routes.ts`. The list page gains a capability-gated "New Production Run" CTA in the header. Bundle delta +0.83 kB; budget at 29.4 / 40 kB.

PR: https://github.com/kitstak/app/pull/34 · commit `9982980`

### PR #35. F-Wave6-AUDIT-02. Quote submitted -> approved audit row missing

Symptom: at the end of the F-Wave6-FLOW-01 walk, the operator's test quote's HISTORY tab showed only `draft -> submitted`. The expected `submitted -> approved` row did not appear, even though the quote was at `approved` and the Convert-to-Project button was enabled.

Headline reframe. This is a new bug class for the codebase. Two prior hypotheses both turned out to be wrong:

**Hypothesis A: trigger gap.** Maybe migration 0044 left a transition uncovered, or `convert_quote_to_project` (which fires inside an RPC transaction) bypassed the trigger. Read-only inspection of `audit_log` against the operator's test quote disconfirmed this: a `submitted -> approved` row exists with the right `entity_type`, `entity_id`, `from_state`, `to_state`, hash chain link, and timestamp. The DB write happened.

**Hypothesis B: filter in AuditTimeline.** Maybe `AuditTimeline.tsx` filters certain row shapes (system actor, missing actor, specific transition tuples). Code read of the component disconfirmed this: it renders every row the hook returns, no shape-level filter.

**Actual root cause: stale TanStack Query cache.** `useQuoteAction` (submit, approve, send) and `useConvertQuoteToProject` invalidate `quotesKeys.*` on success. Neither invalidates the audit timeline's query key. The audit timeline query is keyed off `auditKeys.byEntity('quote', id)` (or was, before this PR; see below). With the chassis defaults of `staleTime: 30_000` and `refetchOnWindowFocus: false`, an operator who lands on a quote detail page, clicks Submit (transitions draft -> submitted), then clicks Approve (transitions submitted -> approved), then expands HISTORY, sees the cached audit timeline as of the page's initial load. The DB row exists; the SPA never re-fetches.

The diagnostic path was the most durable output of the session. The two hypotheses are intuitive enough that another agent walking the same symptom blind would chase them in the same order. The third diagnosis (cache invalidation) requires reading both the mutation hook layer and the query layer to spot the missing key. Codifying this as a known bug class: every TanStack mutation that writes a state transition must invalidate both the entity query keys and the audit-log query key for that entity.

Fix shape: new `apps/web/src/lib/queryKeys/auditLog.ts` factory with `auditLogKeys.byEntity(entityType, entityId)`. `AuditTimeline.tsx` rekeyed off the factory. `useQuotes.ts` invalidates `auditLogKeys.byEntity('quote', id)` after every state-changing mutation (submit, approve, send, convert) on top of its existing `quotesKeys.*` invalidations. SPA-only edit, no migration.

Spawned: `F-Wave7-AUDIT-CACHE-SWEEP-01`. The same stale-audit-cache bug almost certainly affects every other state-machine detail page in the SPA: projects, invoices, credit notes, journal entries, purchase orders, vendor bills, expenses, receiving orders, production runs, shipments, leads, opportunities, project phases. Thirteen mutation hooks need the same `auditLogKeys.byEntity(...)` invalidation added.

PR: https://github.com/kitstak/app/pull/35 · commit `347062f`

## Reframes

### Reframe 1: AUDIT-02 was a TanStack cache-invalidation bug

See PR #35 above for the diagnostic path. The bug class is durable across the codebase. The fix shape (an `auditLogKeys` factory plus invalidation calls in every state-changing mutation hook) is mechanical once the diagnosis lands. The diagnosis itself is not mechanical; the first two hypotheses were both wrong, both took a read pass through the DB or the component to disconfirm, and the third diagnosis only surfaced once those two were ruled out.

### Reframe 2: deploy esm.sh URL imports are a systemic risk

The PR #32 deploy-functions failure on a transient esm.sh 522 looked like a routine flake. The orchestrator triaged before re-running, and discovered a wider pattern. Twenty-five files across `supabase/functions/` use direct CDN URL imports of the shape `https://esm.sh/zod@3.23.8` or `https://esm.sh/@supabase/supabase-js@2.45.0`, including shared infrastructure files (`_shared/handler-helpers.ts`, `_shared/idempotency.ts`). Every edge function deploy depends on esm.sh being up at deploy time. PR #32's deploy failed exactly once on this dependency.

`supabase/functions/deno.json` already maps `"zod": "npm:zod@3.23.8"` (set up in PR #6, Wave 2 hotfix). The bare `import { z } from 'zod'` shape would resolve through the import map and bypass the CDN entirely. The 25 files have never been converted because every existing site shipped working and nothing in the gate set surfaces the latent dependency on a third-party CDN.

Filed `F-Wave7-ESM-SH-DRIFT-01`. Convert all 25 sites to bare imports. The Supabase Preview branch also auto-discovers `deno.json`, so the conversion does not require a workflow change.

## Phase 7 follow-ups filed this session

- `F-Wave7-FK-RENDER-SWEEP-01`: five other detail pages render raw FK UUIDs (Shipment, ProductionRun, JournalEntry, Contact, Lead). Generalize PR #31's `useWarehousesList`-resolve pattern across all six pages, lift to a shared helper if it reads cleanly.
- `F-Wave7-MUTATION-ERRORS-SWEEP-01` (already in STATUS.md from PR #33): 128 `useMutation` call sites across 28 files need the inline-error treatment PR #21 (convert-to-project) and PR #33 (Add Material) applied. Seven CRM CreatePages on the daily path are the priority targets.
- `F-Wave7-AUDIT-CACHE-SWEEP-01`: thirteen state-machine detail pages have the same missing audit-log invalidation pattern AUDIT-02 surfaced. Add `auditLogKeys.byEntity(...)` invalidation to every state-changing mutation hook.
- `F-Wave7-ESM-SH-DRIFT-01`: twenty-five `https://esm.sh/...` URL imports across `supabase/functions/` need conversion to bare imports resolved by the existing `deno.json` import map. Every deploy is currently a coin flip against CDN availability.

## Lessons

1. **Multi-agent dispatch produced clean scope boundaries.** Five agents, five PRs, zero scope bleed. Each fix touched only the files the symptom pointed at. The parallelism was not the primary win (the operator was driving sequentially anyway); the win was that each agent's prompt was narrow enough that none of them tried to fold a follow-up into the same diff. Compare to Wave 6.5 where two agents shipped placeholders that needed Canon Steward intervention to consolidate. The hotfix-storm shape (one agent per symptom, one PR per fix) is the cleanest dispatch pattern in the wave history.

2. **Hypothesis-laddering is the right pattern for SPA-edge integration bugs.** The AUDIT-02 close-out followed three hypotheses in order. The first two were the obvious candidates given the symptom; the third required reading both layers of the SPA at the same time. A single-agent prompt that named all three hypotheses up front would have moved faster, but the agent did not have the prior pattern to draw on. Going forward, "missing data on a detail page after a mutation completed" should ladder: DB write happened? -> filter at the render layer? -> cache invalidation at the query layer?

3. **Deploy flakes deserve a triage pass before a re-run.** The PR #32 esm.sh 522 was the kind of flake that gets re-run reflexively. The orchestrator's triage pass surfaced 25 files of latent risk. The cost of the triage was ten minutes; the cost of not triaging would have been future deploy failures with no narrative explanation. Going forward, every transient deploy failure should be triaged for a systemic pattern before the re-run.

## Gates verified at close

At baseline `347062f`, post-merge of PR #35:

| Gate | Result |
|---|---|
| `pnpm typecheck` | 0 errors |
| `pnpm lint` | 0 warnings, 0 errors |
| `pnpm test` | green |
| `pnpm test:contract` | 25 / 25 |
| `pnpm build` | clean |
| `pnpm bundle-budget` | 29.4 / 40 kB (PR #34 added +0.83 kB for ProductionRunCreatePage) |

Migration count holds at 48; no schema changes this session. Byte-mirror parity intact across 22 pairs. Singular `_shared/{types,workflow,capabilities,money}.ts` untouched. All copy clean (no em dashes, no double hyphens, no emojis). TS1 read-only zone untouched.

Phase 6 polish carryover: closed. Phase 7 stabilization scope grew by four items.
