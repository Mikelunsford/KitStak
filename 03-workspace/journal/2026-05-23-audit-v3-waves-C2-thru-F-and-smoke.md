# 2026-05-23 — Audit v3 Waves C2 through F + operator smoke closeout

**Date:** 2026-05-23 (afternoon session, follow-up to the morning Waves A + B + C1 closeout)
**Driven by:** the morning session left six audit-v3 follow-ups deferred (Waves C2, C3, C4, D, E, F) when an agent was killed mid-flight before the C2 commit landed. The migration `0063` was already in prod but no SPA path consumed the new `project_id` column on `manufacturing_runs` or `shipments`. This session closed all six waves, the operator walked prod end-to-end against an explicit smoke plan, and the two findings that surfaced were fixed before sign-off.
**Status:** **Closed.** 9 PRs merged to main. 0 new migrations (0063 already lived). 1 ship-train process hardening (deploy-prod concurrency). Operator smoke fully green at session end.

## What shipped

| PR | Wave | Title | Notes |
|---|---|---|---|
| #133 | C2 | manufacturing_runs + shipments schemas/handlers accept `project_id` | `ManufacturingRunSchema`, `ManufacturingRunCreateSchema`, `ShipmentSchema` gain `project_id: Uuid.nullable().optional()`. `manufacturing-api` POST writes `body.project_id ?? null`; PATCH supports link/unlink via explicit-undefined check. `ops-api` `ShipmentCreate` schema gains `project_id`; existing `...body` spread carries it through naturally. 8 new schema unit tests + 9 new regression tests covering insert / update / legacy-row parse for both bundles. Modeled on the receiving-project-link UX-Q6 precedent. |
| #134 | D | restore Customer / Project / Aging columns on lists | Quotes / Invoices / Shipments / Manufacturing Runs lists now show the FK columns operators were clicking into detail pages to see. Customer + Project resolve via the existing `EntityLabel` primitive (no new endpoints, no N+1, leverages cached list queries with BNEW-8 pending-state handling so operators don't see raw UUIDs flash). Aging math extracted to a pure helper `invoiceAging.ts` per the project's pure-helper testing convention. Quotes' Project column resolves via `converted_to_project_id` (the only project linkage a quote owns). All empty placeholders are "." (period); existing "-" on the invoices list normalized to match constitution. 10 tests. |
| #135 | C3 | ProjectPicker + `?project_id=` prefill on mfg/ship create | Agent discovered `ProjectPicker` already shipped and was consumed by four pages (invoice, receiving, shipment, expenses). The wiring work was: bind `ManufacturingRunCreatePage` to `ProjectPicker` with URL prefill + POST body submission; refresh `ShipmentCreatePage` stale comment about server not accepting `project_id` (C2 fixed that); add a UUID guard so malformed `?project_id=not-a-uuid` falls back to `null` instead of poisoning the picker. New shared `urlParams.ts` consolidates the validator, with `receivingProjectParam.ts` now re-exporting from it so the three create pages share one source of truth. 7 unit cases including upper-case UUID parse + non-string-cast. |
| #136 | C4 | Manufacturing Runs + Shipments sections on ProjectDetailPage | Two new sections on `ProjectDetailPage`, server-filtered via `?project_id=` query param on `GET /manufacturing-runs` and `GET /shipments`. Empty-state copy "No manufacturing runs linked to this project yet." (no em-dash). CTAs deep-link to create pages with `?project_id=<id>`. **Drift catch:** C2 only wired POST/PATCH writes; the GET filters had to land in this PR. Both handlers consume the param under the existing org/RLS gate (Pattern A, cross-tenant returns `200 + []`). New `projectChildLinks.ts` helper with 4 URL builders + 8 unit tests locking the contract. Replaced an existing duck-typed `s as unknown as { project_id?... }` cast on the shipments side with the now-typed read. |
| #137 | E | form polish bundle (6 items) | Hidden optional UUIDs (`default_tax_id` / `payment_method_id` / `pricing_tier_id`) moved behind an "Advanced (optional)" disclosure on `QuoteCreatePage` (NOT `QuoteDetailPage` — agent surfaced that QuoteDetail was already clean from morning's B2 and the actual offenders lived on QuoteCreate; called out for operator confirmation). Payment method `<select>` with 6 options on `PaymentCreatePage`. Same-as-billing toggle on `CustomerCreatePage` with one-time copy that unchecks on manual shipping edit. PDF gating predicate (`pdfGating.ts`) disables Download PDF on draft invoices + draft/`revise_requested` quotes with tooltip explanation. Signed-qty formatter (`formatStockMovementQty.ts`) renders `+N` inbound / `-N` outbound on stock movements (outbound in accent). Clickable Source column on stock movements links to receiving_order / shipment / manufacturing_run / production_run with non-link badge fallback for unmapped types. 27 unit tests across the bundle. |
| #138 | F | RelativeTime + FormGrid + inline Receive Payment + LineItemsEditor + PostHog `time_to_send_invoice` | `RelativeTime` uses native `Intl.RelativeTimeFormat` (banned-deps clean — no dayjs / date-fns / moment); migrated `AuditTimeline` off its ad-hoc copy as proof-of-shape; 14 tests. `FormGrid` responsive 2/3-column primitive applied to `InvoiceCreatePage` (max-width bumped to 4xl); 5 tests. Inline `ReceivePaymentModal` replaces the navigate-to-PaymentCreatePage flow on `InvoiceDetailPage`, pre-fills via PR #131 (outstanding balance) + PR #127 (today) helpers, posts payment + applies allocation atomically, closes and refreshes inline; 11 tests. `BillableLineItemsEditor` extracted as slot-prop component for detail-page line editing (distinct from the existing `LineItemsEditor` which handles in-memory create drafts — agent named the new one `BillableLineItemsEditor` after discovering the naming collision and documented the split in JSDoc); migrated `InvoiceDetailPage`; quote + shipment migrations filed as `F-Wave9-AUDIT-V3-WAVE-F-LINE-EDITOR-MIGRATIONS-01`. PostHog `time_to_send_invoice` event added to the bounded `AnalyticsEvent` canon with inline filing reference; emitted alongside `invoice_sent` in `useSendInvoice`; properties: `invoice_id`, `created_at`, `sent_at`, `seconds_to_send`; 8 tests including a `__setPostHogForTests` integration assertion on the wire shape. |
| #139 | SMOKE-01 | migrate Payment method dropdown to ReceivePaymentModal | Operator smoke caught it: E 5b shipped the `<select>` on the standalone `PaymentCreatePage` (#137) but the inline `ReceivePaymentModal` built in F (#138) was still a freeform textbox. Single-file rendering swap — wire layer was already correct, both surfaces already wire `payment_method` as lowercase string and omit-when-empty. Added `it.each` test asserting each of the six selected values round-trips into `payment.payment_method`. |
| #140 | SMOKE-02 | humanize Aging column copy on invoices list | Operator smoke caught it: D's Aging column rendered `-30 days` for not-yet-due invoices, which reads as "past due" to operators. `invoiceAging.ts` rewritten to branch by state first (paid → `Paid`, cancelled/draft → `.`), then anchor exclusively on `due_date` (no more issue_date fallback). Returns one of seven operator-facing copies: `Paid`, `.`, `Due today`, `Due in N days` (singular `Due in 1 day`), `N days late` (singular `1 day late`). 12 deterministic tests pinned to 2026-05-23 UTC, plus a brand-discipline regex over every branch. |
| #141 | process | serialize deploy-prod with concurrency group | SMOKE-02 didn't actually reach prod on the first try. SMOKE-01 (#139, `e8fa2f1`) and SMOKE-02 (#140, `9f89c98`) merged 12 seconds apart; both triggered parallel `deploy-prod` runs whose Vercel-side alias promotions raced. SMOKE-01's promotion landed AFTER SMOKE-02's despite SMOKE-01 merging FIRST, leaving `www.kitstak.com` serving the pre-SMOKE-02 build. Diagnosis by curl + grep on the live `InvoicesListPage` chunk: the new copy strings were nowhere in the served bundle. Fix is two lines of YAML: `concurrency: { group: deploy-prod, cancel-in-progress: false }`. `cancel-in-progress: false` is deliberate — we never want to abort a Vercel promotion mid-flight; subsequent prod deploys queue behind any in-flight one. The fix commit itself served as the clean redeploy trigger that put SMOKE-02 on prod. |

## What did NOT ship (filed as follow-ups, no work lost)

| Item | Reason | Follow-up |
|---|---|---|
| Quote + Shipment detail-page line editor migration to `BillableLineItemsEditor` | Out of scope for F. F shipped Invoice migration as proof-of-shape only. | `F-Wave9-AUDIT-V3-WAVE-F-LINE-EDITOR-MIGRATIONS-01` |
| Customer + Project on Shipment / Mfg detail headers | Smoke flagged: parent project shows children, but children's own headers don't show their links. Needs layout decision. | `F-Wave9-SMOKE-2026-05-23-03` |
| Pending stepper + duplicate SHIP button | Smoke flagged. Pending stepper was previously operator-decided out-of-scope; smoke confirms it's still confusing. Needs revisit. Duplicate SHIP/SHIPPED on Picking-state shipments is a real bug. | `F-Wave9-SMOKE-2026-05-23-04` |
| PostHog `time_to_send_invoice` verification | Smoke didn't authenticate PostHog tab during the walk. Reference invoice: INV-2026-00004. | `F-Wave9-SMOKE-2026-05-23-05` |
| Quote-line vs shipment-line decimal precision divergence | Quote line table renders `3.500` (3 decimals); shipment line table renders `2.00` (2 decimals). Display formatter divergence, not storage. | Minor, not yet ticketed |
| `status_change` vs `state_change` audit log naming on receiving | Confirmed still inconsistent. | Minor, not yet ticketed |

## Operator smoke (walked against the formal smoke plan in chat)

Operator ran the structured smoke plan section by section. Result: 5 of 6 waves passed primary checks on the first walk. Wave A math integrity verified to the cent on a real quote and invoice. Wave B chain pre-fill verified end-to-end on SHP-2026-00003 → INV-2026-00004 with two line items pre-filled. Wave C deep-link round-trip verified on MFG-2026-00005 linked to PRJ-20260522-99ddecd4 plus the project-detail sections. Wave D failed Aging copy; everything else passed. Wave E passed 5 of 6 (payment method dropdown didn't reach the modal). Wave F passed 6a / 6b / 6c; 6d (BillableLineItemsEditor edit-then-save) not exhaustively tested but renders; 6e (PostHog event) not verified due to unauthenticated PostHog tab during smoke. Brand discipline sweep clean across every page visited.

Two failures were dispatched as SMOKE-01 / SMOKE-02; both shipped within 30 minutes. After the deploy race was diagnosed and patched via #141, operator re-smoked the two surfaces and confirmed full green.

## Dispatch process

This session refined the proven smoke-fix-wave pattern from 2026-05-22:

1. **C2 went solo first** (sequential, not parallel) because C3 and C4 depended on C2's schema acceptance. Single agent, clean PR, merged, then dispatched.
2. **C3 + C4 + D + E + F dispatched as 5 parallel worktree-isolated agents** off the fresh C2-inclusive main. All five PRs landed within ~20 minutes of each other; all five passed gates on the first try; all five merged with `gh pr merge --auto --squash --delete-branch`.
3. **SMOKE-01 + SMOKE-02 dispatched as 2 parallel agents** off the fresh post-F main. Both landed in ~6 minutes.
4. **#141 (process fix) was authored manually** because it was a 12-line YAML change in a workflow file and the agent overhead would have been more than the diff.

Total: 9 PRs, 8 dispatched to agents, 1 hand-written. 7 of 8 agent PRs were clean first-try; the only deviation was C3's discovery that `ProjectPicker` already existed — agent correctly treated the brief as describing intent and focused on the wiring work that was actually missing.

## Gates verified

Per-PR: typecheck zero, lint zero (`--max-warnings 0`), src tests passing, regression tests passing (176 → 176 → 178 → 178 → 178 → 178 → 178 → 178 → unchanged), contract parity 20/20 (17 zod + 3 money) on every PR, build succeeds, bundle-budget 30.15 to 30.36 kB / 40 kB throughout the wave.

## Migrations

**Zero new migrations this session.** Migration `0063` (mfg_runs + shipments `project_id` FK) shipped in the morning session and was already live in prod when this session started. C2 through C4 wired the SPA / handler / side-car layer against the existing column.

## Constitutional invariants

| Constraint | State |
|---|---|
| Money rules (cents-as-bigint, `_cents` suffix, roundHalfEven, byte-mirrored helpers) | Held. No monetary fields added; existing prefill helpers reused (#131 outstanding balance, #127 today date). |
| RLS Pattern A on every tenant-scoped table | Held. C2 / C4 GET filters layer on top of the existing `org_id = current_org_id()` gate; the new `project_id` query-string narrowing is safe because RLS already filters. |
| Migration rules | Held. No new migrations; 0063 unchanged. |
| Audit log auto-trigger | Held. No trigger changes. The new `project_id` column flows through existing triggers via payload JSON (no new audit rows required for a metadata field; matches the customer_id / vendor_id / receiving_orders.project_id pattern). |
| Capabilities `requireCap` | Held. No new caps; existing `manufacturing.run.create` and `shipment.create` cover the new field. |
| Banned deps | Held. F item 6a (`RelativeTime`) deliberately used native `Intl.RelativeTimeFormat` over `dayjs` / `date-fns` / `moment` per the ESLint `no-restricted-imports` rule. |
| Brand discipline | Held. SMOKE-02 added an explicit brand-discipline regex over every aging-copy branch as belt-and-suspenders. |
| TS1 read-only zone | Held. No writes. |
| Byte-mirror parity | Held. 17 pairs intact through every PR; C2 verified via `pnpm test:contract` mid-cycle. |

## Drift catch-ups

1. **`gh pr merge --delete-branch` worktree-conflict error is cosmetic, server-side merge already succeeded** — confirmed again across 9 PRs this session. Pattern proven; memory note holds.
2. **Agent worktrees ship without `node_modules` and need a one-time `pnpm install` (~30-90s)** — affected C2, C3, E. Trivial but worth noting if future briefs want to call it out as a pre-step.
3. **`InvoicesListPage.tsx` consumed a `formatInvoiceAging` helper from PR #134 but the helper signature changed in SMOKE-02 without a caller update** — agent confirmed the helper still returned a ready-to-render string so the renderer needed no change. New contract documented in helper JSDoc.
4. **C2 wired POST + PATCH but missed GET `?project_id=` filters** — caught by C4's agent (the consumer) and fixed in C4 rather than spawning a separate PR. Worth filing as a process note: future schema-acceptance PRs should explicitly enumerate "writes accept" vs "reads accept" vs "filters accept" as three separate checklist items.
5. **Vercel deploy alias race between back-to-back merges** — root cause for SMOKE-02's apparent regression. Captured comprehensively in PR #141's body and the workflow YAML comment so the next investigator finds the diagnosis on the first grep. **Systemic fix shipped, not just a one-off patch.**

## Follow-ups filed this session

| Follow-up | Owner |
|---|---|
| `F-Wave9-AUDIT-V3-WAVE-F-LINE-EDITOR-MIGRATIONS-01` | Migrate Quote + Shipment detail-page line editors to `BillableLineItemsEditor`. |
| `F-Wave9-SMOKE-2026-05-23-03` | Surface Customer + Project on Shipment + Manufacturing Run detail headers. |
| `F-Wave9-SMOKE-2026-05-23-04` | Pending stepper revisit + duplicate SHIP/SHIPPED button on Picking-state shipments. |
| `F-Wave9-SMOKE-2026-05-23-05` | Verify PostHog `time_to_send_invoice` event firing via live events tab using INV-2026-00004 as reference. |

## Session totals

- **9 merges to main** (#133, #134, #135, #136, #137, #138, #139, #140, #141)
- **0 forward migrations to prod** (0063 already live from morning)
- **Audit v3 closed end-to-end** (all 6 follow-ups from morning's deferral list + 2 smoke fixes from operator walk)
- **1 ship-train process hardening** (deploy-prod concurrency)
- **4 follow-ups filed** for downstream waves
- **0 items parked by operator decision** during this session

## Suggested next session focus

1. **Closeout journal sweep** — minor inconsistencies caught during smoke (quote `3.500` vs shipment `2.00` decimal precision divergence; receiving `status_change` vs `state_change` audit log naming). Trivial polish.
2. **SMOKE-03 / SMOKE-04** — both need layout / scope decisions before dispatching.
3. **F-LINE-EDITOR-MIGRATIONS-01** — complete the Quote + Shipment detail-page migrations to `BillableLineItemsEditor` for visual consistency.
4. **Audit v3 retrospective** — over 22 PRs across two days (morning A/B/C1 + afternoon C2-F + smoke), the audit produced a materially different operator experience: every cents/percent/quantity input is friendly, the invoice / payment / shipment / mfg-run create flows pre-fill from their natural upstream context, project linkage is end-to-end across pillars, list pages surface the linkage operators were drilling into details for, and the inline Receive Payment modal closes the most common cash-in friction. Worth tracking the qualitative shift, not just the PR count.
5. **Cleanup**: Windows file-locked worktree directories on disk (git no longer references them; cosmetic only).
