# Review: dead code, e2e business logic, unwired elements, incomplete features

Scope: whole codebase (apps/web/src SPA + supabase/functions edge bundles).
Date: 2026-06-26. Branch: main (HEAD bd5e1da).
Method: 16 parallel auditors (13 domain + 3 cross-cutting), each tracing flows SPA -> service -> apiClient -> edge route -> DB and self-verifying every claim with repo-wide greps. Every P0/P1 candidate then re-checked by an independent adversarial verifier. 19 agents, 543 tool calls.
No code was changed. This is a findings report only.

> Correction (added at closeout, 2026-06-26): R-W15-CONFIG-01 below flags the
> job-types write surface as a permanently-empty dropdown. That is wrong for
> job-types: migration 0130 (2026-06-23) already seeds default job types into
> every org and into provision_organization, so the Job Template builder is not
> blocked. The identical-but-real gap was expense categories, fixed by migration
> 0142. The units and item_categories halves of R-W15-CONFIG-01 stand (leave
> dormant). See `epic-build-or-delete-scope-2026-06-26.md` and the Wave 15 journal.

## Verdict

Ship, with two P1 fixes scheduled before the next external demo of the affected surfaces.

Zero P0. Zero tenant, money, or auth defects surfaced in this pass. No constitution stop-list item is implicated. Two confirmed P1 operator-facing breaks, both "feature is visibly present but unusable," both with the backend fully built (so both are SPA wiring fixes, not schema work). The rest is one large structural theme (built-but-unwired mutation surface), a set of backend-only features with no frontend, a few stranded pages, and stale 501 PDF stubs. None of that blocks a ship.

Headline good news: both prior P0/HIGH broken links from the 2026-06-19 wiring map (StockMovements receiving_order and production_run source cells) are FIXED at HEAD, and the previously stranded production-run detail page is now reachable. The nav redesign closed them.

## Counts

| Bucket | Count |
|---|---|
| Raw findings | 80 |
| After dedup | 70 |
| P0 | 0 |
| P1 (confirmed) | 2 distinct |
| P2 | 14 |
| P3 | ~47 |
| By-design / resolved (excluded from defect count) | 7 |
| Adversarial verifications run | 3 |
| Confirmed | 3 |
| Killed (false-positive / by-design) | 0 |

Verification killed nothing: all three P0/P1 candidates held at high confidence, which is a strong signal the two P1s are real. The false-positive problem that wrecked the 2026-06-19 inventory (it flagged ~300 live symbols as dead) did not recur. Every finding below carries a cited location and was confirmed against current HEAD.

Two auditor severity inconsistencies were normalized in this report and are flagged inline:
1. The two stale 501 PDF stub routes (quote, invoice) were graded P2 by one auditor and P3 by another. They are uncalled and superseded by pdf-worker, no operator impact: normalized to P3.
2. Three single orphaned hooks in Co-Pack/KitForce (useUpdateKittingJob, useDeleteTimeEntry, kitforce /members/:id/rate) were graded P2 by the copack auditor while equivalent single dead hooks elsewhere were graded P3. Normalized to P3.

---

## P1. Fix before the next demo of these surfaces

### R-W15-CRM-01 · Lead conversion is unreachable through the SPA · `e2e-break`

Location: `apps/web/src/pages/crm/leads/LeadEditPage.tsx` (form omits a status control; onSubmit draft lines 65-74 never send status) gating `apps/web/src/pages/crm/leads/LeadDetailPage.tsx:66`.

The CONVERT button renders only when `l.status === 'qualified'` (LeadDetailPage.tsx:66). A lead is created at status `new` (LeadCreatePage has no status input, crm.ts:202 defaults `new`). No SPA surface can advance lead status: LeadEditPage patches eight fields but never status, and LeadsKanbanPage drag-drop is explicitly deferred ("Wave 3 follow-up", LeadsKanbanPage.tsx:17-18). So a lead can never reach `qualified`, CONVERT never appears, and the shipped LeadConvertPage plus the `/crm/leads/:id/convert` route (routes.ts:1169) and the `convert_lead` RPC are dead in practice.

The backend is fully capable: `patchLead` FSM-validates `new -> working -> qualified` transitions and applies `body.status` (crm-api/handlers/leads.ts:191-209). This is a pure SPA completeness gap.

Impact: the core CRM lead-to-customer/opportunity pipeline cannot be completed in the product. Operators can create leads and view a 5-column pipeline but cannot move one forward.

Fix: add a status-transition control (Advance/Qualify buttons on LeadDetailPage mirroring the working OpportunityDetailPage stage control, or a status select in LeadEditPage that PATCHes through updateLead). Effort: S.

Adversarial verdict: confirmed, high confidence. Independently re-verified the full status lifecycle and the backend capability.

### R-W15-EXPORT-01 · Exports "Download CSV" is broken end to end · `e2e-break`

Location: `apps/web/src/lib/services/exportsService.ts:6-13`; consuming page `apps/web/src/pages/exports/ExportsPage.tsx:40`; live route `/exports` (sidebar "Data" group).

`exportUrl()` returns a relative path `/exports-api/exports/${entityType}?format=csv` and `triggerExport()` does `window.location.assign(...)`. Two independent failures:

1. The relative URL never reaches the function host. vercel.json has a single rewrite `/(.*)` -> `/index.html` and no `/exports-api` rewrite; vite.config.ts has no proxy; routes.ts has no `/exports-api` route. So the navigation just reloads the SPA and lands on NotFoundPage. Every real edge call goes through apiClient (which prepends `${SUPABASE_URL}/functions/v1`), but exportsService bypasses apiClient entirely.
2. Even with the correct absolute host, a top-level GET browser navigation cannot attach `Authorization: Bearer` headers, so exports-api/index.ts:104-106 (`requireCaller` + `requireCap`) 401s.

Impact: every Download CSV button on the Exports page sends the operator to the SPA 404. The entire data-export feature is non-functional in dev and prod.

Fix: build the absolute functions URL and stream through an authenticated `fetch` to a Blob download, or mint a short-lived signed URL server-side. Do not `window.location.assign` a relative unauthenticated path. Effort: M.

Adversarial verdict: confirmed, high confidence. Both legs verified against vercel.json, vite.config.ts, routes.ts, and the edge auth guard.

---

## P2. Real gaps, schedule them

The dominant theme is one structural pattern, broken out first, then the standalone P2s.

### Theme: built-but-unwired mutation surface (the biggest single cleanup decision)

Across roughly ten domains, edit and delete chains (service fn -> hook -> edge route) are fully plumbed but have zero UI callers. Each is simultaneously dead code and a missing edit capability. The operator decision is per-entity: build the edit/delete UI, or delete the scaffolding. This pattern accounts for ~25 of the 70 findings. The P2 members (where the missing capability has real operational cost) are:

| ID | Entity | What is missing | Location |
|---|---|---|---|
| R-W15-EDIT-01 | Purchase orders | No header or line edit after create; 4 dead hooks. Operator must recreate the PO to fix a line. | `usePurchaseOrders.ts:51,79,90,102`; PATCH routes `vendors-api/handlers/purchase-orders.ts:155,211,235,267` |
| R-W15-EDIT-02 | Expense categories | create/update built but no management UI; the Expense category dropdown can be permanently empty on a fresh org. | `useExpenses.ts:72,80`; `vendors-api/index.ts:33-34` |
| R-W15-EDIT-03 | Projects (header) | No path to fix name/customer/budget/job_type after create. PATCH `/projects/:id` unused. | `projects-api/index.ts:543` |
| R-W15-EDIT-04 | Project line items | Add and remove only, no edit; asymmetric with quote lines which are editable. | `projects-api/index.ts:551` |
| R-W15-EDIT-05 | 3PL parent entities (account, job-template, supply-plan, job-run, billing-review) | Edit (PATCH) chains for all 5 have no UI; only FSM transitions and deactivate exist. | `useAccounts.ts:67` + 4 peers |
| R-W15-EDIT-06 | 3PL parent entities | Soft-delete (DELETE) chains for all 5 have no UI; no operator path to remove these records. | `useAccounts.ts:102` + 4 peers |
| R-W15-EDIT-07 | Warehouse | Delete path and `warehouses.warehouse.delete` capability unreachable; no delete control on WarehouseDetailPage. | `useInventory.ts:47`; `inventory-api/index.ts:169` |
| R-W15-EDIT-08 | Co-Pack sales order (header) | useUpdateSalesOrder dead; no edit page though every sibling KitForce entity has one. | `useCoPack.ts:141` |
| R-W15-EDIT-09 | Receiving (divergent dual path) | `useReceiveReceivingOrder` + POST `/receiving-orders/:id/receive` + `receiving.receive` cap are dead; the live path is `/transition`. Two ways to reach "received," only one wired. | `useOps.ts:111`; `ops-api/index.ts:489` |

Recommendation: treat R-W15-EDIT-* as one backlog epic. For v1, decide which entities genuinely need post-create editing (PO and expense categories have the clearest operational pain) and delete the rest of the scaffolding so the dead surface stops accruing audit and maintenance cost. The P3 inline line-edit hooks (3PL daily-log lines, kitting consumed/produced lines, receiving/shipment line items, WMS putaway/location/lot edit+delete) belong to the same epic and are listed in the P3 table.

### Standalone P2s

| ID | Title | Location | Fix |
|---|---|---|---|
| R-W15-CRM-02 | OpportunityEditPage ships an editable Stage dropdown the server rejects: any stage change makes Save 409. Two divergent live stage paths, one works. | `OpportunityEditPage.tsx:111` (server guard `opportunities.ts:210-216`) | Make Stage display-only in the edit form, or drop `stage` from the patch body; stage moves belong to the detail-page transition buttons. |
| R-W15-SHELL-01 | `RequireFlag` route guard is a dead fail-open stub: hardcodes `const flagOn = true`, renders `<Outlet/>` unconditionally, `TODO(Wave 2): replace fail-open`. Never mounted today, but a latent trap given the constitution's flag-gating discipline. | `components/shell/RequireFlag.tsx:33` | Delete the module, or finish it with `useOrgFlags()`-driven gating before anyone wires it into a route. |
| R-W15-NOTIF-01 | `NotificationsBell` is fully built but mounted nowhere; the whole in-app notifications UI is unreachable. collaboration-api GET /notifications + POST /notifications/:id/read have no live consumer. | `components/shell/NotificationsBell.tsx:15` | Mount in the Topbar action cluster, or delete the component and its hooks if notifications are deferred. |
| R-W15-FEEDBACK-01 | Staff feedback notifications deep-link to the tenant route `/feedback/tickets/:id`, which 404s for cross-tenant triage (the org-scoped getTicket throws NOT_FOUND for another org's ticket). The staff inbox is `/admin/feedback/:id`. | `feedback-api/notifications.ts:25` | Set the staff link prefix to `/admin/feedback/`, leaving `feedback-admin-api` on `/feedback/tickets/` for the tester. Operators can still reach tickets via the inbox, so not total loss. |
| R-W15-AR-01 | Payments list links every payment (including fully-settled) to a stubbed Apply form; there is no `/invoicing/payments/:id` detail route. A $0-unapplied payment opens "Apply" and submitting 500s on the DB check. | `PaymentsListPage.tsx:43`; PaymentApplyPage is a Wave-2 stub | Add a read-only `/invoicing/payments/:id` detail page; point the row at it; show Apply only when `unapplied_cents > 0`. |
| R-W15-DASH-01 | `/dashboard/summary` (DashboardSummaryPage, a full KPI page) is stranded with zero inbound navigation after the section-dashboard redesign. | `routes.ts:1195-1197` | Add an inbound link from Insights/DashboardPage, or remove the route and page if superseded by section dashboards. |
| R-W15-LIST-01 | The list-toolbar migration left two divergent live code paths: only 4 of ~37 lists carry the useServerList keyset path, both paths ship in those files behind `UI_LIST_TOOLBAR`, and filter state is URL-persisted on some peers and ephemeral on others. | `CustomersListPage.tsx:61-68` (relates to F-WS7-SERVER-PAGINATION) | Finish the useServerList migration across remaining lists, then retire the legacy client path behind the flag. |
| R-W15-CONFIG-01 | Dead config surfaces with no admin UI: item_categories CRUD (no picker on the item form, `category_id` can never be set), units CRUD (superseded by free-text `unit_of_measure`, structured `unit_id` orphaned), job-types write routes (the Job Template builder dropdown is permanently empty unless seeded in DB). | `sales-config-api/index.ts:562-579` | Per surface: build the admin page + picker, or remove the unused routes and the FK wiring. job-types needs at minimum a seed at provisioning or the Job Template builder is unusable on a fresh org. |
| R-W15-QUOTE-01 | Backend-only quote features with no frontend: version history (`quote_versions` table + listVersions handler, no UI) and the approvals workflow (POST/PATCH `/quotes/:id/approvals` + `quote_approvals` table, no UI; the FSM `approve` transition is what the UI actually uses). | `quotes-api/index.ts:1110,1113-1114` | Build a Versions panel and an approvals panel on QuoteDetailPage, or descope the version/approval backends if not on the roadmap. |
| F-Wave9-LEGACY-PRODUCTION-ROUTE-RETIRE-01 | ProductionRunsListPage and ProductionRunCreatePage are dead and unrouted (legacy `/3pl-operations/production` + `/new` redirect to the manufacturing pillar). The create page is also the regressed raw-UUID form. Superseded by the manufacturing pillar. | `pages/3pl-operations/production/ProductionRunsListPage.tsx`, `ProductionRunCreatePage.tsx` | Delete both pages and prune `useProductionRunsList` / `useCreateProductionRun`; consider retiring the ops-api list/create `/production-runs` routes. |

---

## P3. Polish and cleanup (full table)

Pure dead-code removal, stale copy, and presentational gaps. None blocks anything. Grouped for batch handling.

### Dead service/hook/route surface (cleanup or wire later)

| Location | Note |
|---|---|
| `customersService.ts:86`, `contactsService.ts:82`, `activitiesService.ts:59,74` | deleteCustomer, deleteContact, getActivity, updateActivity: no UI caller (no delete control, no activity detail/edit route). Re-verified dead at HEAD. |
| `routes.ts:1394` + `QuoteSendPage.tsx` | QuoteSendPage `/quotes/:id/send` orphan route; superseded by the inline Send button on QuoteDetailPage. |
| `quotes-api/index.ts:1091` | DELETE `/quotes/:id` no SPA caller (quotes removed via FSM cancel). |
| `projects-api/index.ts:544` | DELETE `/projects/:id` no SPA caller (projects removed via FSM cancel). |
| `projects-api/index.ts:555-556` | Project phases cannot be renamed or deleted (PATCH/DELETE phase routes unused; only reorder + transition exist). |
| `useItems.ts:42` / `itemsService.ts:45` | useDeleteItem + deleteItem dead; no item delete control. |
| `taxesService.ts:40` | deleteTax dead (setDefaultTax in same file is live). |
| `sales-config-api/index.ts:552,575` | DELETE value-added-services and pricing-tiers routes have no client. |
| `useOps.ts:64,220,298,352` | useUpdateReceivingOrder, useUpdateShipment, and both line-item update hooks dead; headers and lines not editable in place. |
| `usePayments.ts:71,81` | useUpdatePayment + useDeletePayment dead. |
| `queryKeys/recurringSchedules.ts:10-12` | recurringScheduleKeys.all and .list unused. |
| `useJobRuns.ts:166,249,282` / `useSupplyPlans.ts:159` | 3PL inline line/daily-log update hooks dead (add+remove only). |
| `three-pl-api/routes.ts:108` | GET `/job-runs/:id/daily-logs/:lid` no client caller. |
| `bomLineDraft.ts:47` | makeEmptyBomLineDraft exported, test-only. |
| `useOps.ts:136,146` | useProductionRunsList + useCreateProductionRun have only dead callers (the two dead production pages). |
| `useCoPack.ts:268` | useUpdateKittingJob orphaned (normalized to P3). |
| `useKitForce.ts:416` | useDeleteTimeEntry orphaned (normalized to P3). |
| `kitforce-api/index.ts:475` | GET `/members/:id/rate` no consumer; rate already delivered role-stripped on the member object (normalized to P3). |
| `useCoPack.ts:349,400` | useUpdateKittingConsumedLine + useUpdateKittingProducedLine dead. |
| `useWmsPutaway/Locations/Lots.ts` | 6 WMS edit/soft-delete hooks + service fns dead (deactivate/quarantine exist, edit/delete do not). |
| `useWmsBinStock.ts:26` / `wmsBinStockService.ts:59` | Bin-stock single-row read chain dead; no `/wms/bin-stock/:id` route. |
| `components/shell/GlobalSearchBar.tsx:13` | Superseded by Cmd-K CommandBar; orphaned. |
| `portalService.ts:75` / `customer-portal-api/index.ts:303` | Portal attachments path (edge route + service + schema + capability) has no UI consumer; half-built. |

### Stranded / placeholder pages and stale copy

| Location | Note |
|---|---|
| `pages/wms/WmsHomePage.tsx:15` (route `routes.ts:1568`) | `/wms` orphan landing, no inbound nav, stale "surfaces land here as later phases ship" copy (they shipped, reached via the inventory sidebar). |
| `quotes-api/index.ts:1012`, `invoicing-api/handlers/invoices.ts:521` | Two stale 501 PDF stub routes superseded by pdf-worker; uncalled (normalized to P3). |
| `QuoteSendPage.tsx:14` | Stale copy: "PDF email wiring lands when the pdf-worker is online." pdf-worker is online; the send works but never attaches a PDF. |
| `search-api/index.ts:85,125` | Emits pre-spine-reroute hrefs for quotes/projects; resolves via SpineMoveRedirect today (not a 404), but a hard 404 if the redirect rows are ever retired. F-Wave10-SEARCH-API-REROUTE-HREF-01. |
| `PODetailPage.tsx:204` | Renders the raw vendor UUID though the vendor display_name is already loaded; inconsistent with VendorBillDetailPage. |
| `VendorBillCreatePage.tsx:87` | Linked PO is still a raw-UUID TextInput (no PurchaseOrderPicker exists). Optional field, does not block submit. |
| `vendors-api/index.ts:10-34` | Header route-map comment omits two GET routes the handlers serve; stale comment, not stale code. |
| `xcut-deadcode` re-verify | StockMovements receiving_order link FIXED; `/3pl-operations/receiving/:id` now resolves. |

---

## By-design and resolved (excluded from the defect count)

These were inspected and correctly excluded. Recorded so the next reviewer does not re-flag them.

- StockMovements SourceCell links (receiving_order, production_run): both prior P0/HIGH broken links are FIXED at HEAD by the nav-redesign route table. The production-run detail page is no longer stranded.
- EntityLabel kind="account" noun collision: re-verified clean; no 3PL surface routes through the account-kind resolver.
- admin-console-api `/orgs/impersonate` (501) and adminService listPlatformOrgs/readPlatformAuditPage: intentionally dark behind `platform_admin.enabled`, no SPA page. Deferred to the platform-admin wave.
- `_shared/notifications/senders.ts:103` SMTP transport "not implemented": chassis-only stub; prod uses Resend; fails closed.
- `/imports/history` route: documented synchronous-imports placeholder; benign.
- Portal dual-role strand (F-Wave14-PORTAL-DUALROLE-SWITCH-01): known authz design gap, deferred, not re-reported.

---

## Suggested next commands

1. The two P1s are independent and small. Hand them to the fix loop:
   - `/debug R-W15-EXPORT-01` (exports CSV, authenticated Blob download).
   - `/implement R-W15-CRM-01` (lead status-transition control to unblock CONVERT).
2. The unwired-mutation epic (R-W15-EDIT-01..09 plus the P3 line-edit hooks) is a single decision: build-or-delete per entity. Recommend a scoping pass before any code: `/implement R-W15-EDIT-* scope` to decide which post-create editors v1 actually needs (PO and expense categories first), then delete the rest of the scaffolding.
3. The dead-code P3 table is safe for a refactor-cleaner sweep once the build-or-delete decisions above are made, so the same hooks are not deleted and rebuilt.

Nothing here touches RLS, money helpers, idempotency, audit_log, or migrations, so none of it is a constitution stop-list item. No new dependency is implied by any fix.
