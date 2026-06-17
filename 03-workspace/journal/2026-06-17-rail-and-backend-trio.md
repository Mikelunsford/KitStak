# Rail consistency and the held backend trio

Date: 2026-06-17. Scope: the two deferred rail follow-ups plus the three held backend items, scoped, built, and shipped to prod the same day as the F-UIUX rollout closeout. Four PRs (#321 to #324). CHANGELOG 0.23.0. Prod at migration 0119.

## How it ran

The operator asked to scope the held backend trio and the rail follow-ups, then said "proceed with your recommendations and ship and build", and later "ship the held PRs too if CI passes". The flow: a five-agent scoping workflow first, then a unit-per-branch build to the scoped recommendations, each gated and (for the money-touching unit) adversarially reviewed, then merged on green CI with the prod deploy watched.

## The scoping reframe

The scoping pass changed the shape of the work. The "backend trio" was mostly already built:

- **Default-for-org** shipped its `default_for_org` columns, the one-default-per-org partial unique indexes, and the atomic-flip RPCs (`set_default_tax` / `set_default_payment_method`) back in migration 0011. The gap was that the create/update path raw-wrote the flag and bypassed the flip, so a second default violated the unique index and returned a 500. No migration needed, just edge routing plus SPA.
- **Credit-note numbering** was already seeded on prod (the `CN-` numbering_sequences row exists for every org); the handler just never called the chassis. No migration. Only **journal-entry** numbering was genuinely new, and it needed care: journal entries are also auto-minted by the 0024 triggers with `JE-INV-` / `JE-PAY-` / `JE-CN-` numbers, so the manual lane took a `JE-M-` prefix to stay clear of that namespace.
- **Inline-line** turned out to be half-built: the invoice line PATCH already existed end to end (handler, service, hook); only the invoice editor UI was missing. Only the **quote** line PATCH was new backend.

So across all three, only one small migration (0119, journal-entry numbering, a one-for-one copy of 0103) and one new endpoint (the quote line PATCH) were genuinely new. The rest was wiring and UI.

## What shipped

- **#321 rail consistency** (F-UIUX-RAIL-OPP-CLIENT-CAP-01 + F-UIUX-RAIL-FIRST-EDGE-01). The opportunity ADVANCE STAGE buttons and the interactive rail now gate on `crm.opportunities.stage.transition`, so the whole block hides for roles without it (ops, accounting, viewer), matching every other detail page. The Pattern D rail is wired on the safe first edge of the manufacturing run (draft to started), production run (planned to in_progress), and credit note (draft to issued), each gate pinned to the exact initial-state edge so the rail can never offer the destructive complete or the navigate-to-apply step. SPA-only, no HALT; shipped first and live on prod.

- **#322 auto-numbering** (F-UIUX-AUTONUMBER-JE-01). Credit-note and manual journal-entry create now allocate the next document number from the org-scoped numbering chassis (`next_doc_number`) when the field is left blank. Credit notes needed no migration; journal entries got migration 0119 (the `journal_entry` row per org with prefix `JE-M-`, plus the `seed_org_numbering` extension, a faithful superset of 0103). The 0024 auto-JE writers were left untouched. Both SPA forms keep the number field as an optional override. Migration 0119 applied clean to prod and staging.

- **#323 default-org** (F-UIUX-DEFAULT-FOR-ORG-01). The sales-config create/update path strips `default_for_org` from the raw write and, when the caller set it true, routes the atomic flip through the existing RPC inside the same idempotency closure (fixing the 500-on-second-default), with unchecking on edit deliberately non-destructive. The two list pages gained a cap-gated Set-as-default row action, and quote create pre-selects the org-default tax and payment method when the header fields are blank.

- **#324 inline-line** (F-UIUX-INLINE-LINES-01). A new `PATCH /quotes/:id/line-items/:lineId` endpoint mirrors the create handler: cap-gated, server-side draft guard, ownership double-scoped to line and quote id (cross-tenant or cross-quote ids return 404), `assertRefInOrg` on item/vas/tax, idempotency-wrapped under a unique route key, and a server-authoritative recompute of the four line cents via the now-exported `computeLineMath` (rounding parity with create held by reusing the same function). `tax_rate_snapshot` is re-resolved on a `tax_id` change because the DB before-insert snapshot trigger does not fire on UPDATE. `kind` is frozen. No migration (the UPDATE RLS policy shipped in 0116). The invoice side reused its already-built PATCH; only the editor UI was added. An adversarial money-integrity review returned no critical or high happy-path issues; two HIGH null-row edge cases (a `BigInt("null")` 500 and a silent-zero tax) were hardened with create-schema-default fallbacks, and the recompute RPC error is now surfaced instead of swallowed.

## Engineering notes

- **Deploy-functions deploys every bundle each run**, so the final run on the commit carrying all merges redeploys the whole bundle list at the combined state. The migrate workflow applied 0119 forward-only to both prod and staging in one run.
- **The PowerShell here-string with `git commit -m` mangles embedded double quotes** (a PowerShell 5.1 native-argument quirk): the auto-numbering commit failed on `"Leave blank to auto-assign"`. Switched to `git commit -F <file>` and `gh pr create --body-file <file>` for the rest of the session. A trailing `Remove-Item` of a temp file tripped a sandbox guard once; dropped the cleanup step.

## Remaining

Carried doc-lag, unchanged: the SSO #298 store-metadata MVP is live on prod (migration 0118) but the CHANGELOG `[Unreleased]` block still labels it built-and-held. New small follow-up `F-UIUX-RECOMPUTE-ERR-PARITY-01`: `addLineItem` and `removeLineItem` share the same pre-existing unchecked `recompute_quote_totals` RPC pattern that the new quote PATCH now guards; align them.
