# Epic scope: build or delete the unwired mutation surface

Date: 2026-06-26. Source: the R-W15-EDIT cluster and adjacent wire-or-cut findings from `review-codebase-2026-06-26.md`.
Method: 16 read-only scoping analysts (one per decision unit) traced each dead chain and weighed it against first-operator v1 need, then a v1 product strategist reviewed the whole set for consistency and over/under-building. 17 agents. No code changed.

## Bottom line

This reads as a feature epic but it is roughly 85 percent cleanup and 15 percent build. Of 58 scoped surfaces: 48 DELETE, 8 build-ish (1 BUILD, 7 BUILD-MINIMAL), 2 SEED. Every build is S-effort pure SPA work plus one seed migration. The edge routes are already production-grade (requireCap + respondWithIdempotency + assertRefInOrg + RLS + audit triggers), so no build touches schema, RLS, money, idempotency, or audit_log.

The deletes are safe because they remove dead SPA hooks, services, pages, and components only. The production-grade edge routes and their capabilities stay referenced server-side, so deletion causes zero capabilities-canon churn and no parity-test ripple. They ship as a handful of batched dead-code PRs with no constitution stops.

Only four surfaces clear the v1 build bar, and they share one theme: correcting master or spine records that have no clean recreate path (Account, Project, Payment), plus one data seed to kill the lone permanently-empty dropdown (expense categories). Single highest-value build: Account edit.

### Correction to the review

R-W15-CONFIG-01 flagged the job-types dropdown as "permanently empty unless seeded in DB." That is already fixed: migration `0130_seed_default_job_types.sql` (2026-06-23) seeds default job_types for every org and wires the seed into `provision_organization`, so new orgs get them too. The job-types builder is not blocked. The identical-but-unsolved case is expense categories, and 0130 is the exact template for its fix.

---

## Do: the v1 build list (4 items, all S-effort SPA, plus 1 seed)

Ordered by value to the first operator.

### 1. Account edit · BUILD · R-W15-EDIT-05a

3PL commercial master data. Account is referenced by job runs, supply plans, and billing reviews that pin its `account_number`, so there is no clean recreate path: a typo or a changed term cannot be fixed by cancel-and-recreate without orphaning children. The hook `useUpdateAccount` (useAccounts.ts:67) and `updateAccount` service are live to a real `PATCH /accounts/:id`; only the UI is missing.

Build: an Edit affordance on AccountDetailPage (or an AccountEditPage) wired to `useUpdateAccount`, mirroring an existing EditPage. Effort: S. Constitution: none.

### 2. Project header edit · BUILD · R-W15-EDIT-03

Long-lived spine entity with children (receiving orders, shipments, lines, phases) and no cancel-and-recreate escape. Today there is no path to fix a project name, customer, budget, or job type after creation. The edge `PATCH /projects/:id` (cap `projects.project.write`) is real; the SPA has no `updateProject` service or hook yet.

Build: add `projectsService.updateProject` + `useUpdateProject` + an editable field or edit form on ProjectDetailPage, mirroring QuoteDetailPage's in-place editable field. Effort: S. Constitution: none.

### 3. Payment detail page + delete-revive · BUILD-MINIMAL · R-W15-AR-01

Two paired surfaces on the paying-customer AR side:
- A read-only `/invoicing/payments/:id` PaymentDetailPage reusing the live `usePayment`/`getPayment`, then repoint the PaymentsListPage row from `/:id/apply` to `/:id` (closes the live UX wart where every payment, including fully-settled, opens an Apply form).
- Wire `useDeletePayment` as a guarded destructive-confirm action on that page. Payments are the one entity in the epic with no FSM cancel and no deactivate, so soft-delete is the only correction primitive for a mis-keyed payment. This is the single principled exception to the otherwise-uniform "delete the soft-delete hooks" call.

Effort: S. Constitution: none (edge `PATCH`/`DELETE /payments/:id` are real wrapped handlers; `payments.write` stays live via createPayment regardless).

### 4. Expense category seed · SEED · R-W15-EDIT-02

The only permanently-empty dropdown in the epic. ExpenseCreatePage shows a Category select populated from `expense_categories`, which has no provisioning seed, so on a fresh org it is always empty and expenses can only be saved uncategorized. The field is optional so this is not a blocked flow, but categorization is dead until seeded.

Ship: a `seed_org_default_expense_categories` idempotent `ON CONFLICT` function wired into `provision_organization` plus a one-shot backfill, mirroring migration 0130 exactly. Zero SPA work. Then delete the dead `useCreateExpenseCategory`/`useUpdateExpenseCategory` hooks (the authoring UI is not needed once defaults are seeded).

Effort: S. Constitution: STOP-TO-CONFIRM. This touches `provision_organization`, which is a schema change. Precedent 0130 is clean and idempotent, and it does not touch RLS, money, idempotency, or audit_log, but per the constitution any migration of this kind gets operator sign-off before it ships.

### Optional, cuttable from v1 (build only if cheap consistency is wanted)

| Item | ID | Why it is optional |
|---|---|---|
| PO header edit (copy VendorBillEditPage into a header-only POEditPage + `/:id/edit` route + Edit button, wired to live `useUpdatePurchaseOrder`) | R-W15-EDIT-01a | PO is the only purchasing doc without an edit page, so it is a sibling-consistency gap, but draft cancel-and-recreate already works and PO is not on the literal 3PL operating path. Bottom of the list. Effort S. |
| Project phase delete (a row remove control mirroring `useRemoveProjectLineItem`) | R-W15-EDIT-04b | Closes an add-only trap on an optional planning sub-entity. No first-operator flow blocks on an un-removable phase. Effort S. |

---

## Delete: the cleanup sweep (48 surfaces, SPA-only, no canon churn)

Each batch removes dead SPA hooks, services, pages, or components. Edge routes and capabilities stay dormant and referenced, so no `capabilities.ts` change and no parity-test ripple. Implementers must also remove barrel re-exports in `lib/services/index.ts` and any test references. Group into a handful of per-domain PRs.

### Batch A. 3PL commercial dead hooks (13 hooks) · R-W15-EDIT-05/06, threepl-lines
- Soft-delete x5: `useSoftDeleteAccount`/`JobTemplate`/`SupplyPlan`/`JobRun`/`BillingReview` + services. Redundant with deactivate and FSM cancel.
- Edit x4 (not Account): `useUpdateJobTemplate`/`SupplyPlan`/`JobRun`/`BillingReview` + services + `*Patch` type imports. JobTemplate structural content is already editable via live line CRUD; deactivate-and-recreate suffices for the rest.
- Inline edit x4: `useUpdateSupplyPlanLine`, `useUpdateJobRunDailyLog`, `useUpdateJobRunDailyLogConsumedLine`, `useUpdateJobRunDailyLogProducedLine` + service fns. Workaround is remove-and-re-add. (Keep `useUpdateJobTemplateLine` and `useUpdateAccountService`; both are live.)

### Batch B. Inventory and ops dead hooks (6 hooks) · R-W15-EDIT-07/09, inventory-mutations
`useReceiveReceivingOrder` (divergent receive-RPC, redundant with the live `/transition` path), `useDeleteWarehouse`, `useUpdateReceivingOrder`, `useUpdateShipment`, `useUpdateReceivingOrderLineItem`, `useUpdateShipmentLineItem` + services and types. Leave all edge routes and caps.

GUARDRAIL: the receiving-order and shipment header-edit deletes are safe only while pre-receipt and pre-pick cancel-and-recreate stays clean. The day an operator needs to fix a typo on an order that has already partially received or picked lines, flip those two to BUILD. Keep the dormant edge routes so the flip stays S-effort. This is the highest-risk DELETE in the set; watch it.

### Batch C. Co-Pack dead hooks (4 hooks) · R-W15-EDIT-08, copack-mutations
`useUpdateSalesOrder`, `useUpdateKittingJob`, `useUpdateKittingConsumedLine`, `useUpdateKittingProducedLine` + service fns + Patch/Update types in copackService.ts. Co-Pack is add-on 3, off the first-3PL-operator path. Note the cheap symmetry fast-follow: this module's sales-order lines already ship a live inline editor (`useUpdateSalesOrderLine`), so if Co-Pack becomes a focus, header edit is an easy add later.

### Batch D. Misc domain dead hooks
- PO line-item CRUD: `useUpdatePoLineItem`, `useDeletePoLineItem` + services. KEEP `createPoLineItem` service (live in POCreatePage). Keep the `purchase_orders.line_item.write` cap (gates the live create path).
- AR: `useUpdatePayment` + `updatePayment` service. (Payment soft-delete is a BUILD, see above.)
- KitForce: `useDeleteTimeEntry` + `deleteTimeEntry` service.
- Catalog: `useDeleteItem` + `deleteItem` service, `deleteTax` service.
- Project: `useUpdateProjectLineItem`-equivalent line edit, `updatePhase`/`deletePhase` rename path, `deleteProject` path (projects removed via FSM cancel). (Phase delete is optional BUILD, see above.)
- CRM wrappers x4: `deleteCustomer`, `deleteContact`, `getActivity`, `updateActivity` + their index.ts re-exports.

### Batch E. WMS dead hooks (7 hooks) · wms-mutations
`useUpdate`/`useSoftDelete` for `WmsLocation`, `WmsPutaway`, `WmsLot`, plus `useWmsBinStock` + services. WMS is add-on 6 and `plugins.wms` is off on every org. All reuse existing caps; no `wms.*.delete` cap exists to churn.

### Batch F. Shell components and orphan pages · shell-components, orphan-pages
- `RequireFlag.tsx` (+ `isFeatureDisabledError`): dead fail-open guard, unambiguous landmine, delete.
- `GlobalSearchBar.tsx`: duplicate of the live Cmd-K CommandBar, delete.
- `NotificationsBell.tsx` + orphan hooks `useNotifications`/`useMarkNotificationRead`: in-app notifications are deferred for v1, delete the dead component and hooks; leave the notification caps and collaboration-api routes dormant for when the feature is built.
- `ProductionRunsListPage` + `ProductionRunCreatePage` + `useProductionRunsList` + `useCreateProductionRun` + list/create services (F-Wave9-LEGACY-PRODUCTION-ROUTE-RETIRE-01). Keep `production.run.*` caps and routes for the live ProductionRunDetailPage.
- `DashboardSummaryPage` + its route and lazy import. Keep the shared summary data layer (used by section dashboards).
- `QuoteSendPage.tsx` + lazy const + route entry + the now-dangling `/3pl-operations/quotes/:id/send` legacy redirect. Keep `useSendQuote`/`sendQuote` (the inline Send button uses them).
- Portal attachments: `listPortalAttachments` service + `PortalAttachmentSchema`/type. Leave the edge route and `portal.attachment.read` cap dormant.

---

## Leave dormant: do NOT rip (backend-only, defer)

These have no dead SPA symbol to sweep. Removing them means ripping parity-tested capabilities canon plus a forward migration for near-zero v1 value. The analysts correctly chose leave-dormant over rip. Do not let a tidiness urge turn these into canon churn.

| Surface | Why leave it | ID |
|---|---|---|
| Quote version history (`quote_versions` table, listVersions, `quotes.version.read`) | Backend-only, no UI, no v1 need. Descope decision later; ripping needs a migration + canon change. | R-W15-QUOTE-01a |
| Quote approvals sub-resource (`quote_approvals`, POST/PATCH approvals, `quotes.approval.write`) | The live UI uses the FSM `approve` transition instead. Dormant backend. | R-W15-QUOTE-01b |
| Hard `DELETE /quotes/:id` | Quotes are removed via FSM cancel. Dormant route. | R-W15-QUOTE-01c |
| Structured `units` catalog + `items.unit_id` FK | Superseded by free-text `unit_of_measure`. Full removal is a migration + canon change for zero v1 value. | R-W15-CONFIG-01a |
| `item_categories` CRUD + `items.category_id` FK | No SPA symbol, no v1 need. Same rip cost. | R-W15-CONFIG-01b |
| `DELETE /value-added-services`, `DELETE /pricing-tiers` | Backend-only orphan routes, no SPA symbol. | catalog-deletes |
| `GET /members/:id/rate` | Rate already arrives role-stripped on the member object. Optional backend-only removal, no cap touch; not worth a PR alone. | kitforce |
| WmsHomePage stale copy | `/wms` is dark (plugins.wms off everywhere). Copy refresh is post-v1, not v1 build work. | orphan-pages |
| admin-console impersonate (501), platform-admin scaffolding, SMTP stub | Intentionally dark behind flags. Deferred to their waves. | review by-design |

---

## Constitution flags and guardrails

- Only one item needs operator sign-off before it ships: the expense-category seed migration (touches `provision_organization`). It is the anti-strand call and must actually ship; do not let it regress to a plain hook-delete, or expense categorization becomes a hard dead-end with no in-app remedy. Precedent 0130 is the clean template.
- Every other build is pure SPA (no migration, no canon touch).
- Every delete is SPA-only (dead hooks, services, pages, components). No `capabilities.ts` change, no parity-test ripple, no edge-route or migration change.
- Highest-risk delete: receiving and shipment header edit (Batch B). Safe only while pre-receipt cancel-and-recreate is clean. Flip to BUILD the day a post-receipt typo correction is needed.

## Suggested sequencing and next commands

1. Builds first, since they are the v1-relevant work and small:
   - `/implement R-W15-EDIT-05a` (Account edit) and `/implement R-W15-EDIT-03` (Project header edit), parallel, both S.
   - `/implement R-W15-AR-01` (Payment detail page + delete-revive).
   - `/implement R-W15-EDIT-02` for the expense-category seed, after operator confirms the `provision_organization` migration (constitution stop).
2. Then the cleanup sweep as a few per-domain dead-code PRs (Batches A through F). Safe to hand to `refactor-cleaner` now that the build-or-delete decision is fixed, so nothing gets deleted and rebuilt.
3. Leave-dormant items: no action; recorded here so the next reviewer does not re-flag them.

The two cuttable builds (PO header edit, project phase delete) are scheduling discretion, not v1 blockers.
