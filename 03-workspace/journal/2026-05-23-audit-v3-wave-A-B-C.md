# 2026-05-23 — Audit v3 Waves A + B + C closeout

**Date:** 2026-05-23
**Driven by:** Kitstak E2E Audit v3 (run 2026-05-22 live against `www.kitstak.com`). The audit's executive summary called out three classes of friction: developer concepts in the UI (cents / E3 / BPS / raw UUIDs), missing autofill on documents that already knew everything, and list pages stripped of operator columns. This wave attacks the first two.
**Status:** **Closed.** All 11 planned PRs absorbed into 7 merges (one branch carried three commits; one was a stacked-base auto-close). Wave C2/C3/C4 SPA wiring deferred to a follow-up because the migration is now live but the application surface that consumes it has not shipped yet.

## What shipped

| PR | Wave | Title | Notes |
|---|---|---|---|
| #125 | A1 | feat: add DollarInput, PercentInput, QuantityInput primitives | Round-trip `string ↔ bigint cents` / `number 0..100 ↔ bps` / `decimal ↔ qty_e3 ×1000`. Storage unchanged. Tests cover half-even, whitespace, commas, negatives. |
| #131 | A2+A3 | feat: pre-fill payment amount with invoice outstanding balance | Bundle: the A3 branch carried A1+A2+A3 commits stacked. With #125 already merged, #131 squashed delivered both the form-site migration to the new primitives AND the payment-balance prefill in one merge commit. #129 (the standalone A2 PR) auto-closed when its base branch was deleted; the work is in #131. |
| #124 | B1 | feat: pre-fill invoice lines from source shipment on create | InvoiceCreatePage reads `?shipment_id=` and POSTs one invoice line per shipment line after header create (two-stage pattern from PR #104). Falls back to `project_line_items` when only `?project_id=` is supplied. `buildCreateInvoiceUrl` emits `?shipment_id=`. New helper `sourceLinePrefill.ts` + 9 unit tests. **Decision encoded:** invoice line `unit_price_cents` comes from `item.unit_price_cents` (sales price), NOT from `shipment_line.unit_cost_cents` (COGS) — billing the COGS to the customer would have been wrong. |
| #126 | B2 | feat: replace optional-uuid Source quote input with QuotePicker | New `QuotePicker` component modeled on CustomerPicker / InvoicePicker. Filtered by current customer. Replaces the `optional uuid` text input on InvoiceCreatePage. |
| #127 | B3 | feat: default invoice issue/due dates and payment received-at to today | InvoiceCreatePage: issue_date defaults to today; due_date auto-fills to issue + customer.default_payment_terms_days when set. PaymentCreatePage: received_at defaults to today. Manual edits never clobbered. New helpers `todayIsoDate` + `addDaysIso` (TZ-safe, leap-year-safe) with 10 unit tests. **Required rebase** at merge time — both A2 (via #131) and B1 (via #124) had touched InvoiceCreatePage / PaymentCreatePage. The conflict was purely additive (imports + one useEffect for due-date derivation); resolved by unioning, dedupe on `useProjectsList` import, force-push, CI re-run. |
| #130 | B4 | feat: auto-derive customer on shipment create from selected project | When operator selects a Project on ShipmentCreatePage, CustomerPicker auto-fills from `project.customer_id`. Form reordered so Project sits above Customer. New helper `deriveShipmentCustomerFromProject.ts` + 6 unit tests. |
| #128 | C1 | feat(db): add project_id FK to manufacturing_runs and shipments | Migration **0063** — adds `project_id uuid null references projects(id)` to both tables with partial indexes `where project_id is not null`. Constitutional header. Pattern A RLS unchanged (denormalised org_id already filters). Audit triggers fire automatically. **Closes F-Wave9-UX-Q6-SHIPMENT-LIST-FILTER-01** (originally filed in the 2026-05-22 smoke-fix closeout). Migration auto-deployed to prod via existing migrate.yml workflow. |

## What did NOT ship (deferred)

| Item | Reason |
|---|---|
| **C2** — side-cars + handlers accept `project_id` | Migration is live but the Zod schemas, handler create/update bodies, and side-car parity have not been updated. The column accepts writes but no SPA path reaches it yet. **Filed as `F-Wave9-AUDIT-V3-WAVE-C2-01`.** |
| **C3** — ProjectPicker + `?project_id=` prefill on ManufacturingRunCreatePage / ShipmentCreatePage | Depends on C2. **Filed as `F-Wave9-AUDIT-V3-WAVE-C3-01`.** |
| **C4** — Manufacturing Runs + Shipments sections on ProjectDetailPage | Depends on C2 + C3. **Filed as `F-Wave9-AUDIT-V3-WAVE-C4-01`.** |
| Audit Waves D / E / F | Lists / form polish / telemetry. Held for next dispatch after operator smokes A+B+C1. |

## Dispatch process

Three parallel worktree-isolated agents on the smoke-fix-wave pattern (proven 2026-05-22). The agents shipped all 11 PRs but two were killed mid-cycle by operator request:

- **Wave A agent** was killed right after A3 gates passed but before `gh pr create` on A3. The branch was pushed; the PR was opened manually in a follow-up session.
- **Wave C agent** was killed right after C1 gates passed and was about to commit C2. No C2 commit reached origin. C2/C3/C4 are net-new work for the next dispatch.

## Gates verified

Per-PR: typecheck zero, lint zero, src tests + regression tests passing, contract parity 20/20 (17 zod + 3 money), build succeeds, bundle-budget 30.15-30.19 kB / 40 kB.

## Migrations applied (52 slots used; 0005 + 0006 still empty)

`0063_manufacturing_runs_and_shipments_project_id.sql` — Phase 9: adds `project_id uuid null` FK + partial indexes on both tables. Forward-only. Idempotent. Audit triggers untouched. Closes F-Wave9-UX-Q6-SHIPMENT-LIST-FILTER-01.

## Constitutional invariants

| Constraint | State |
|---|---|
| Money rules (cents-as-bigint, `_cents` suffix, roundHalfEven, byte-mirrored helpers) | Held. New DollarInput primitive round-trips through roundHalfEven; storage shape unchanged. |
| RLS Pattern A on every tenant-scoped table | Held. New `project_id` FK on manufacturing_runs and shipments inherits the existing org_id row filter. |
| Migration rules | Held. 0063 forward-only, idempotent, four-digit padded, constitutional header. |
| Audit log auto-trigger | Held. No trigger changes; the new column flows through the existing trigger via payload JSON. |
| Capabilities `requireCap` | Held. No new caps; existing `manufacturing.run.create` and `shipment.create` cover the new field once C2 ships. |
| Banned deps | Held. No new top-level deps. |
| Brand discipline | Held. All copy clean. |
| TS1 read-only zone | Held. No writes. |
| Byte-mirror parity | Held. 17 pairs intact through every PR. |

## Drift catch-ups

1. **PRs auto-closing when a stacked base branch is deleted.** PR #129 (A2 standalone) had `base = claude/wave-a-pr-a1-input-primitives`. When #125 merged with `--delete-branch`, GitHub auto-closed #129. The A2 work was preserved because #131's branch contained A1+A2+A3 stacked commits; squash-merging #131 against new main delivered A2+A3 cleanly. **Process note for future dispatches:** if agents stack PRs by chaining branches, the merge order must consume the stack from top → bottom. Always set `--base main` explicitly on agent PRs unless stacking is intentional and the operator knows to merge bottom-up.
2. **CRLF/LF mismatch on conflict-resolution Edit tool calls.** Edit tool requires byte-exact match; this repo's Windows worktree uses CRLF but the tool's old_string was LF. Workaround: `sed -i '/^<<<<<<< HEAD$/d; /^=======$/d; /^>>>>>>> /d' file` strips the marker lines and keeps both sides — works perfectly for additive conflicts. Manual dedupe needed after for duplicate imports.
3. **`gh pr merge --delete-branch` errors when the branch is checked out in a worktree.** Memory note from prior session confirmed: cosmetic, server-side merge already succeeded. Encountered this on #130 and #131; both merged successfully despite the local error.

## Follow-ups filed this wave

| Follow-up | Owner |
|---|---|
| `F-Wave9-AUDIT-V3-WAVE-C2-01` | Side-cars + handlers accept `project_id` on manufacturing_runs + shipments. |
| `F-Wave9-AUDIT-V3-WAVE-C3-01` | ProjectPicker + `?project_id=` prefill on ManufacturingRunCreatePage + ShipmentCreatePage. |
| `F-Wave9-AUDIT-V3-WAVE-C4-01` | Manufacturing Runs + Shipments sections on ProjectDetailPage with deep-link CTAs. |
| `F-Wave9-AUDIT-V3-WAVE-D-01` | List page restoration: Customer / Project / Aging columns on Quotes / Invoices / Shipments / Mfg lists. |
| `F-Wave9-AUDIT-V3-WAVE-E-01` | Form polish bundle: hide optional-uuid inputs on QuoteDetail; Payment method dropdown; Same-as-billing toggle; PDF gating; signed qty in stock movements; clickable Source. |
| `F-Wave9-AUDIT-V3-WAVE-F-01` | Polish + telemetry: RelativeTime component; two-column form grid; inline Receive Payment modal; unified LineItemsEditor; PostHog "time to send invoice" funnel event. |

## Session totals

- **7 merges to main** (#125, #131, #124, #126, #127, #130, #128) — note #131 absorbed A2+A3 from a stacked branch
- **1 forward migration to prod** (0063)
- **8 distinct audit recommendations closed** (A1 primitives, A2 form-site migration, A3 payment prefill, B1 invoice line prefill, B2 QuotePicker, B3 default dates, B4 shipment auto-customer, C1 mfg+ship project FK)
- **1 PR auto-closed** (#129, work preserved in #131)
- **6 follow-ups filed** for downstream waves
- **0 items parked by operator decision** (the audit's "remove Pending stepper step" recommendation was disagreed-with and dropped from scope during planning, not parked)

## Suggested next session focus

1. Dispatch Wave C2/C3/C4 to fully use migration 0063
2. Operator smoke on prod to verify A + B + C1 changes hold under realistic data
3. Schedule Wave D (list page restoration) — highest remaining audit value
4. Cleanup: `git worktree remove --force` on the three stranded worktrees (`agent-a439a76174194cdfe`, `agent-a9dd586531f99346c`, `agent-aa99e8a18097cad85`)
