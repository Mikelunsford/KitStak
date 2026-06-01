# Phase B closeout (full-DoD plan) 2026-06-01

Phase B of the full-DoD-green plan. Scope: the edit-affordance sweep, config self-service, and FSM completeness. Six PRs across three workstreams, all migration-free, merged to prod main (baseline 98d8383 to 8e3898d). Dispatched as two sub-waves of three parallel worktree agents each, serial-merged to resolve the shared routes.ts.

## Shipped

### WS3 edit-affordance sweep (sub-wave 1)
Entities that had a PATCH endpoint, update service, and load hook but no edit page now have one, mirroring the CustomerEditPage pattern (load via use<Entity>(id), seed local state, PatchSchema.safeParse, update mutation, invalidate + navigate). Edit button added to each detail page.
- **#192 CRM**: leads, opportunities, contacts. Added the three single-entity load hooks (useLead / useOpportunity / useContact).
- **#193 KitForce**: teams, assignments, time-entries. Teams and time-entries load via the list cache (no GET-by-id service); cold-cache direct URL shows a brief loading state. Time-entry rate field gated behind the C2 rate surface.
- **#194 procurement and inventory**: items, vendors, vendor-bills, expenses, warehouses. This PR also added the missing Create/Patch Zod schemas to sales.ts and vendors_inventory_ops.ts, byte-mirrored into _shared (parity green). Money fields reuse DollarInput (cents on the wire).

### WS4 config self-service (sub-wave 2)
- **#195 Chart of Accounts**: the list page was a read-only stub; added create and edit pages wired to the existing finance-api /coa CRUD (POST/PATCH already shipped). COA Zod schemas kept local to the page files (matching the JournalEntry pattern) so no byte-mirror change was needed. System accounts lock code and type on edit.
- **#197 sales-config**: Add and Edit for taxes (rate_bps via PercentInput), payment methods (kind dropdown), pricing tiers (discount_bps via PercentInput), and VAS (base_price_cents via DollarInput). Exchange rates shipped add-only because sales-config-api has no PATCH route (filed as a follow-up). Currencies left GET-only (global reference). Added the Create/Patch Zod schemas to sales.ts byte-mirrored into _shared (parity green).

### WS5 FSM completeness (sub-wave 2)
- **#196 credit-note issue and void**: added POST /credit-notes/:id/issue (draft to issued) and POST /credit-notes/:id/void (draft or issued to voided) in invoicing-api, plus Issue and Void buttons on the detail page (Void behind the in-app destructiveConfirm modal). No migration: the credit_notes status CHECK already allowed all four states, the creditNoteStateMachine was already in the workflow canon, and the AFTER UPDATE status audit trigger already existed. A shared transitionCreditNoteTo helper models transitionInvoiceTo: 404 on cross-tenant, 409 STATE_CONFLICT on an illegal move (including a same-state self-loop, which is a conflict at the lifecycle-endpoint grain), period-closed mapped to 422, audit via the existing trigger, wrapped in respondWithIdempotency. Reused the existing credit_notes.write cap (its role set matches the RLS write policy), so no capability-matrix change.

## Follow-ups filed
- **F-Wave10-CRM-SALESCONFIG-SPA-GATE-01**: SPA-side OR RequirePlugin guard for crm and sales-config routes (server gate landed in Phase A #190; server is authority so the SPA mirror was deferred).
- **F-Wave10-CREDIT-NOTE-APPLY-FSM-01**: applyCreditNote never transitions the note to applied and lets a draft note be applied; the canon issued to applied edge is unwired. Surfaced by the WS5 work and spun off as a separate task.
- **F-Wave10-EXCHANGE-RATE-PATCH-01**: sales-config-api has POST but no PATCH for exchange_rates; add the route plus edit UI.

## Constitutional invariants verified
- Money rules: every rate or amount uses bps, cents, or e9 fixed-point integers; no floats. Reused DollarInput / PercentInput / cents-based schemas.
- Byte-mirror parity green throughout (pnpm test:contract 22/22) including the sales.ts and vendors_inventory_ops.ts schema additions.
- Credit-note transitions: 404 not 403 for cross-tenant, 409 STATE_CONFLICT for illegal moves, Idempotency-Key enforced, audit via the existing trigger, cap check before the state change.
- No migrations, no RLS changes, no audit_log schema changes across all six PRs.
- Brand voice held on disk across all files, commits, and PRs.

## Process notes
- Two sub-waves of three parallel worktree agents (sonnet for the pattern-replication SPA sweeps, opus for the WS5 handler work). Each agent opened its own PR; the orchestrator serial-merged to resolve the shared routes.ts (additions landed in disjoint sections, so git auto-merge held).
- After the agents finished, two PRs were merged via a background poll-and-merge watcher because no further agent completions were going to re-trigger the orchestrator.
- The procurement agent (#194) and sales-config agent (#197) both chose to add missing Create/Patch schemas rather than skip the entities; both kept the _shared mirror byte-identical, so the parity contract stayed green.
- Every merge produced the known cosmetic gh pr merge --delete-branch failure (branch checked out in an agent worktree); server-side merges succeeded, verified via PR state.
