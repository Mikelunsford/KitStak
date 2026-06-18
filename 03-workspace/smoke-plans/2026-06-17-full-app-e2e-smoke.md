# Full-app E2E smoke test, post UI/UX wave. Kitstak

**Target executor**: Claude Cowork (or any LLM agent with browser automation + Supabase MCP + Bash)
**Target env**: prod (`https://www.kitstak.com` against Supabase `zmnvwhqjahwidprnjxrq`). A staging run against `dnkgaufydcnedgkuoyml` is acceptable and safer.
**Scope**: The whole application. Provisioning a fresh org through every spine surface and all six add-ons, every settings and admin surface, every registered state machine, and the recent UI/UX layer shipped across PRs #300 through #326.
**Prod HEAD at authoring**: `e8feb0f`. Max migration on prod: `0119`.
**Duration estimate**: 4 to 6 hours for a complete pass. Can be split across sessions by phase.
**Tester role**: `org_owner` of a freshly provisioned test org (NOT the operator's live org `4e234c7d-4a1e-4764-9a4e-c275586c803e`). Spin a second test org and a `customer_user` for the cross-tenant and portal phases.

This plan is a map for Cowork to explore and cross-check. Treat every stated route, capability string, FSM state, and tab label as a claim to confirm against the running app, not as ground truth. Where a claim is marked VERIFY, it was derived from code reading and has a known risk of drift. File a finding when the app disagrees with this document, even if the app is the one that is wrong.

---

## Mission

Walk the entire application end to end and confirm:

1. A brand-new org can be provisioned and the owner can sign in, set a password, invite staff, and reach a working dashboard.
2. Every pillar plugin gate behaves: surface 404s when the plugin is off, works when on. Every per-route feature flag returns 403 FEATURE_DISABLED when off.
3. Every registered state machine advances along its legal path, writes an audit_log row per transition, and rejects illegal transitions.
4. Every money value stores and renders correctly (cents in, dollars out, banker's rounding, currency snapshot).
5. The recent UI/UX layer works on the surfaces it shipped to: entity hub tabs, the interactive next-step rail, next-step toasts, the command palette and quick-create, inline draft-line editing, auto-numbering, the default-for-org control, name resolution, and the dashboard hero plus setup checklist.
6. The stock ledger stays coherent across receiving, manufacturing, kitting, fulfillment, and WMS putaway.
7. Cross-tenant isolation holds: cross-tenant reads return 200 plus empty, cross-tenant writes return 404, plugin gates return 404, never a 403 where a 404 is constitutionally required.

Report findings as `F-FULLSMOKE-<NN>`. Severities:
- **P0**: cross-tenant RLS bleed, data loss, security violation, a constitutional gate broken (403 where 404 is required, audit row missing on a transition, money stored as float), or any 500 on a normal write.
- **P1**: functional regression that blocks a normal operator flow.
- **P2**: UX gap, copy violation, missing feedback, a recent UI/UX feature not behaving as specified.
- **P3**: polish suggestion.

---

## Constitutional invariants to verify continuously

Keep these in view on every surface. They are the house rules and a break on any of them is a finding.

1. **Money in cents**: BIGINT cents stored, `_cents` columns, never float. Wire is integer or string. Currency snapshotted at issuance on every line. UI renders dollars. Line "unit price" inputs are raw cents unless the field label says dollars.
2. **RLS**: cross-tenant READ returns 200 plus empty array. Cross-tenant WRITE returns 404. Plugin bundle gate returns 404. Per-route feature flag miss returns 403 FEATURE_DISABLED with `{ flag }`. A 403 where 404 is expected is a release blocker.
3. **Idempotency**: every non-GET handler requires an `Idempotency-Key` header (UUID v4). Same key plus a different body returns 409 IDEMPOTENCY_CONFLICT.
4. **Audit log**: append-only, hash-chained. Every state transition writes exactly one audit_log row. No write that emits an audit row may 500.
5. **Capabilities**: a role without the cap gets 403 FORBIDDEN on the write. The SPA hides the button, the server is the authority.
6. **Brand discipline**: no em-dashes, double hyphens, or emojis in UI copy. No raw enum, ISO timestamp, or UUID leaks where a humanized label or entity number belongs.

---

## Pre-flight

### F1. Provision a fresh test org

Do NOT use the operator's live org. Mint a fresh `auth.users` row via service role first (the RPC has no signup trigger and requires a pre-existing owner), then provision.

```sql
-- provision_organization(p_slug, p_display_name, p_owner_user_id, p_owner_email)
-- service_role only. Seeds: org row, owner profile (display_name NULL), org_owner
-- membership, branding, feature flags (ALL disabled), numbering sequences,
-- chart of accounts, and a default warehouse. Stamps kitstak_org_id +
-- kitstak_org_role onto auth.users.raw_app_meta_data (migration 0069).
select provision_organization(
  'fullsmoke_YYYYMMDD_HHmm',
  'Full Smoke Co.',
  '<fresh-test-user-uuid>',
  'fullsmoke+YYYYMMDD@kitstak.test'
);
```

### F2. THE CRITICAL GATE (read this before anything else)

`seed_org_settings` seeds **every plugin flag disabled**. The spine edge bundles `quotes-api`, `projects-api`, `inventory-api`, and `ops-api` still **bundle-gate on `plugins.three_pl`** (follow-up `F-Wave10-SPINE-EDGE-GATE-RECONCILE-01` to ungate them is open, not shipped). The SPA routes for the spine are NOT client-gated, so the pages render, but every data fetch returns 404 until `plugins.three_pl` is enabled.

Net effect on a fresh org: the spine looks broken (pages load, lists are empty or error) until you turn `plugins.three_pl` on. And the billing/subscription gate blocks enabling paid plugins through the UI without an active or trialing subscription. So for this smoke run, enable the plugin flags directly via service role, bypassing the UI gate:

```sql
-- Enable the pillars you will test. UPSERT because plugins.wms is NOT in the
-- seed array (it was added in Wave 12 after seed_org_settings was written), so
-- its row may not exist yet for this org.
insert into public.org_feature_flags (org_id, flag_key, is_enabled, config)
values
  ('<test-org-id>', 'plugins.three_pl',     true, '{}'::jsonb),
  ('<test-org-id>', 'plugins.manufacturing', true, '{}'::jsonb),
  ('<test-org-id>', 'plugins.copack_ecom',   true, '{}'::jsonb),
  ('<test-org-id>', 'plugins.kitforce',      true, '{}'::jsonb),
  ('<test-org-id>', 'plugins.kitcost',       true, '{}'::jsonb),
  ('<test-org-id>', 'plugins.wms',           true, '{}'::jsonb)
on conflict (org_id, flag_key) do update set is_enabled = true;
```

Before enabling, run the plugin-gate negative test in Phase 1 (confirm gated routes 404 while off). Then enable and confirm they work. That sequence is the single most important gate check in this run.

Note: `feature.collaboration`, `feature.global_search`, `feature.imports`, `feature.exports`, and `feature.customer_portal` are also seeded disabled. Enable the ones you intend to exercise (global search, imports, exports, customer portal) the same way. VERIFY the exact flag key for journal entries; it is referenced in code as `finance.journal_entries.enabled` but is not in the seed array, so the finance journal-entry surface may render FeatureUnavailable until that flag is set.

### F3. Confirm the seed dependencies landed

```sql
-- Default warehouse (hard dependency for receiving, shipments, manufacturing,
-- kitting, putaway). Quote-to-project conversion sets supply_plan.warehouse_id
-- NULL if this is missing.
select id, name, is_default from public.warehouses where org_id = '<test-org-id>';

-- Numbering sequences (quote, invoice, credit_note, payment, purchase_order,
-- vendor_bill, expense, receiving_order, shipment, production_run,
-- manufacturing_run). Auto-numbering for credit notes and journal entries was
-- added later (CN-, JE-M-); confirm those resolve when you create one.
select doc_type, prefix, next_value from public.org_numbering_sequences
  where org_id = '<test-org-id>' order by doc_type;

-- Chart of accounts seeded (journal entries need valid accounts).
select code, name from public.accounts where org_id = '<test-org-id>' order by code;
```

If the default warehouse row is missing, STOP and file P0. Several add-on transitions will fail downstream.

### F4. Dashboards to keep open

| Purpose | URL |
|---|---|
| Supabase prod SQL editor | https://supabase.com/dashboard/project/zmnvwhqjahwidprnjxrq/sql/new |
| Supabase prod Edge logs | https://supabase.com/dashboard/project/zmnvwhqjahwidprnjxrq/logs/edge-functions |
| Supabase staging SQL editor | https://supabase.com/dashboard/project/dnkgaufydcnedgkuoyml/sql/new |
| Vercel runtime logs | https://vercel.com/mikes-projects-5e3ecc74/kitstak/logs |
| Sentry issues | https://kitstak.sentry.io/issues/?project=4511423235751936 |

Keep the browser console open the whole walk. Any uncaught error or red on-screen text is a finding.

---

## Phase 0: Identity, provisioning, and account lifecycle

Surfaces: `/signin`, `/no-active-org`, `/auth/recovery`, `/account/security`, `/admin/members`.

### 0.1 NO_ACTIVE_ORG negative test
1. Mint a fresh auth user but do NOT provision an org for them yet. Sign in.
2. Expected: the app renders `NoActiveOrgPage` ("NO ACTIVE WORKSPACE"), not an empty dashboard, with a Sign Out button. The edge mirror returns 401 NO_ACTIVE_ORG. A silent empty dashboard here is a P1.

### 0.2 Provision then sign in
1. Provision the org (F1). Sign out and back in so a fresh JWT mints with the org claim.
2. Confirm `session.user.app_metadata` carries `kitstak_org_id` and `kitstak_org_role = org_owner`. Dashboard loads.

### 0.3 Password and recovery
1. From `/signin`, use Forgot Password. Expected anti-enumeration copy regardless of whether the email exists ("If an account exists for that email, a reset link has been sent.").
2. Follow a recovery link to `/auth/recovery`. Set a new password. Expected redirect into the app.
3. Visit `/account/security` directly and change the password. Min 8 chars. No cap required, every user can change their own.

### 0.4 Staff invite and roles
1. At `/admin/members`, invite a member as `org_admin`. Confirm the role dropdown offers org_admin, sales, ops, accounting, viewer and NOT org_owner.
2. Members list shows the new row, claimed = false, with a Resend action only while unclaimed.
3. Follow the invite link, set a password, confirm the invitee lands on the welcome path. After password set, the welcome redirect should not fire on the next visit.
4. Privilege-escalation negative test: as an org_admin caller, PATCH a member to role org_owner. Expected refusal (privilege-escalation guard). As org_owner, the same promote should succeed.
5. Confirm the eight roles exist: org_owner, org_admin, sales, ops, accounting, viewer, customer_user, vendor_user.

---

## Phase 1: Navigation, IA, plugin gates, and command surfaces

Surfaces: AppShell, Sidebar, Topbar, CommandBar, `/search`, redirect entries.

### 1.1 Plugin gate negative then positive (run BEFORE F2 enable, then after)
1. With all plugins OFF, hit one route per gated namespace and confirm each renders the NotFound surface (404 semantics): `/3pl-operations/accounts`, `/manufacturing`, `/copack/orders`, `/kitforce/members`, `/kitcost/dashboard`, `/wms`.
2. Enable plugins (F2). Re-hit each. Now they load. A surface that rendered while its plugin was off is a P0 gate leak.
3. Spine edge gate: with three_pl OFF, load `/quotes`. The page renders but the list call should 404 at the edge. With three_pl ON, the list loads. Record both. This is the F-Wave10 spine-edge-gate reality; confirm it is still the case or file that it changed.

### 1.2 Sidebar sections and the task-IA re-key (PR #308)
The sidebar is grouped into eight task sections, not pillars: SELL, BUY, INVENTORY AND WAREHOUSE, PRODUCTION AND FULFILLMENT, MONEY, WORKFORCE, INSIGHTS, SETTINGS. Confirm:
1. Each section expands and collapses, state persists across reload (localStorage), and a deep link auto-expands the section containing the route.
2. The filter box at the top of the sidebar filters nav entries by substring.
3. SETTINGS is owner and admin only.
4. Default-open by role: sales opens SELL, ops opens INVENTORY, accounting opens MONEY.

### 1.3 Per-route capability gating on nav (PR #319), behavioral
Each nav entry is gated on its own read capability, so non-owner roles see fewer links. This is intentional. Sign in as each role (invite one of each, or temporarily switch the test user's `kitstak_org_role`) and confirm:
- **sales**: sees SELL (customers, contacts, leads, opportunities, activities, quotes, projects). Does not see BUY, WORKFORCE, INSIGHTS, SETTINGS.
- **ops**: sees INVENTORY and BUY. Does not see SELL, MONEY, WORKFORCE, SETTINGS.
- **accounting**: sees MONEY (invoices, payments, credit notes, chart of accounts, period close, journal entries). Does not see SELL, BUY, INVENTORY, WORKFORCE.
- **viewer**: sees read surfaces across SELL, BUY, INVENTORY, MONEY, no SETTINGS, no WORKFORCE.
- **org_owner / org_admin**: all sections, subject to plugin entitlement.

VERIFY the exact capability string on each nav entry against the code; treat the role-to-link mapping above as the expected shape, not gospel. The server is the authority, so for any link a role can see, confirm a write it should not do still returns 403.

### 1.4 Topbar quick-create and command palette
1. Topbar "+" create menu shows only role-permitted and entitlement-permitted actions (new customer, quote, project, invoice, payment, vendor, item, and the flag-gated new sales order and new manufacturing run).
2. Cmd/Ctrl-K opens the command palette. Type an entity name, confirm results across customers, quotes, invoices, projects, items, job runs, and Enter navigates to detail. Type a create verb ("New quote") and a nav verb ("Go to period close") and confirm they route, gated by capability. Escape closes, arrows navigate.
3. Global search box routes to `/search` (GlobalSearchResultsPage), org-scoped.

### 1.5 Spine re-route redirects
Hit a legacy deep link and confirm it redirects to the new spine home with query and hash preserved. Examples: `/3pl-operations/warehouses/<id>` to `/inventory/warehouses/<id>`, `/3pl-operations/quotes/<id>` to `/quotes/<id>`, `/3pl-operations/sales-config/taxes` to `/settings/sales-config/taxes`. Legacy production: `/3pl-operations/production` and `/3pl-operations/production/new` redirect to the manufacturing runs surface; `/3pl-operations/production/:id` still renders the detail for old deep links.

---

## Phase 2: Spine CRM

Surfaces under `/crm/*`.

### 2.1 Customers (entity hub tabs, PR #311)
1. Create a customer at `/crm/customers/new`. Confirm name resolution and the auto-assigned reference render, not a raw UUID.
2. On the detail page confirm the tabbed hub. Expected tabs: Overview, Quotes, Projects, Invoices, Payments, Contacts, Activities (VERIFY exact set and order). Tabs are URL-synced (`?tab=quotes`), keyboard navigable, and deep-linkable.
3. Each related tab uses the shared RelatedSection: a "New X" CTA, a list or an empty-state card with coaching copy. From the Quotes tab, "New quote" should open the quote create form with the customer pre-filled.
4. Edit the customer at `/crm/customers/:id/edit`.

### 2.2 Contacts and Activities
1. Create a contact, view detail, edit. Confirm contacts can link to a customer.
2. Create an activity at `/crm/activities/new`. Confirm it lists.

### 2.3 Leads (Kanban + FSM)
1. `/crm/leads` is a Kanban. Create a lead. Walk new to working to qualified to converted via the lead actions. Confirm each transition writes audit and the badge is humanized.
2. Disqualify a separate lead, then reopen it to working (legal side-trip).
3. Convert a qualified lead at `/crm/leads/:id/convert`. Confirm what it creates (customer and or opportunity and or quote).

### 2.4 Opportunities (pipeline + FSM + interactive rail)
1. `/crm/opportunities` is a pipeline. Create an opportunity. The detail page carries the interactive next-step rail (PR #312, #316): the next legal stage advance is a primary CTA, gated on `crm.opportunities.stage.transition`.
2. Walk discovery, evaluation, proposal, negotiation, closed_won. Confirm the rail advances each stage and writes audit. Test a rewind (proposal back to evaluation) and a lose (to closed_lost).

---

## Phase 3: Spine Quote-to-Cash

This is the spine core and exercises the most recent UI/UX features at once. Surfaces: `/quotes/*`, `/projects/*`, `/invoicing/*`.

### 3.1 Quote (FSM + rail + toast + inline lines + default-for-org)
1. Pre-seed a default tax and a default payment method first (Phase 7.6), so the default-for-org preselect can be observed here.
2. Create a quote at `/quotes/new`. On success a next-step toast fires: "Quote {number} created with {n} lines. Send it for approval next." or, with no lines, "Quote created. Add line items to build it out." The toast offers a CTA to the next step. Confirm the quote number auto-assigns (Q-YYYY-NNNNN).
3. Confirm the tax and payment method dropdowns pre-selected the org defaults (PR #323).
4. On the detail page, add lines (item, qty, unit price in cents, tax, discount). Confirm cents-in dollars-out: entering 250 renders $2.50.
5. Inline draft-line editing (PR #324): while the quote is draft, edit a line in place (description, qty, unit price cents, tax rate, discount cents) and Save line. Confirm the PATCH lands and totals re-derive server-side. Confirm inline edit is gone once the quote leaves draft.
6. The interactive rail surfaces "Send for approval". Walk draft to submitted to approved. Confirm audit per transition and humanized badges.
7. Convert approved quote to project (`quotes.convert_to_project`). Confirm the quote moves to project_pending and a project is created. VERIFY whether conversion snapshots quote lines into the project and copies job_type, and whether it sets supply_plan.warehouse_id from the org default warehouse.

### 3.2 Project (FSM)
1. Open the new project at `/projects/:id`. Confirm the StateStepper. Walk pending, ready_to_build, in_production, ready_to_ship, completed (cap `projects.transition`). Cancel path is separate.
2. VERIFY whether ProjectDetailPage is a tabbed hub or a single-column layout with inline sections (phases, materials, receiving, manufacturing, shipments, invoices). Project hub wrapping shipped in PR #317; confirm it rendered.

### 3.3 Invoice (FSM + inline lines + toast + name resolution)
1. Create an invoice at `/invoicing/invoices/new`. Confirm a next-step toast: "Invoice {number} created ... Issue and send it next." VERIFY how the invoice references a project or quote, if at all.
2. Inline draft-line editing on the invoice detail while draft, same as the quote.
3. Walk draft to pending or sent to paid. Note the rich invoice FSM: draft, pending, sent, partially_paid, paid, overdue, refunded, cancelled, on_hold. partially_paid auto-advances to paid as allocations cover the balance.
4. Confirm name resolution: the customer renders as a label, not a UUID.

### 3.4 Payment and apply
1. Create a payment at `/invoicing/payments/new`. Apply it to the invoice at `/invoicing/payments/:id/apply`. Confirm the invoice advances to partially_paid or paid and `unapplied_cents` tracks correctly. Payment is not a state machine; it is a record plus allocations.

### 3.5 Credit note (FSM + apply + auto-number + rail)
1. Create a credit note at `/invoicing/credit-notes/new`. Confirm the number auto-assigns with a CN- prefix and there is no number input (PR #322).
2. The detail rail surfaces "Issue" (safe first edge, draft to issued, PR #309). Then apply at `/invoicing/credit-notes/:id/apply` (issued to applied, cap `credit_notes.apply`). Confirm the apply reduces the target invoice balance and writes audit.

---

## Phase 4: Catalog and Inventory

Surfaces under `/catalog/*` and `/inventory/*`.

### 4.1 Items
1. Create an item at `/catalog/items/new`, view detail, edit. Confirm SKU and name render via EntityLabel where referenced elsewhere (WH-001 style code plus display name).

### 4.2 BOMs (note the data model quirk)
There is no `boms` table. A BOM is the logical set of `bom_items` rows keyed by `parent_item_id`. Each bom_item links a parent item to a component item with qty and unit cost.
1. Create a BOM at `/catalog/boms/new` (or add bom_items via the item editor). Confirm BomDetailPage renders. Known minor: BomDetailPage may omit its hub eyebrow (one-line cosmetic, do not file new).

### 4.3 VAS
1. Create a value-added service at `/catalog/vas/new`, edit at `/catalog/vas/:id/edit`.

### 4.4 Stock (read surfaces)
1. `/inventory/stock/levels` shows quantity_on_hand per item per warehouse. `/inventory/stock/movements` is the ledger. Both should be empty for a fresh org until a receiving, manufacturing, kitting, or putaway flow posts movements. Revisit these after Phases 5, 9, 10, 13 to confirm the ledger updated.

### 4.5 Warehouses
1. Create a warehouse, view detail, edit. Confirm the seeded default warehouse is present and flagged default.

---

## Phase 5: Purchasing and Procure-to-Pay

Surfaces under `/purchasing/*`.

### 5.1 Vendors (entity hub tabs)
1. Create a vendor, view detail. Confirm the tabbed hub. Expected tabs: Overview, Purchase orders, Vendor bills, Expenses, Receiving (VERIFY exact set). RelatedSection per tab. Edit the vendor.

### 5.2 Purchase Order (FSM + rail + toast)
1. Create a PO at `/purchasing/purchase-orders/new`. Confirm a next-step toast: "PO {number} created ... Send it to the vendor next." Add lines.
2. The detail rail surfaces the next edge. Walk draft, submitted, approved, then partial_received or received, then closed (cap `purchase_orders.purchase_order.transition`). Confirm audit per transition.

### 5.3 Receiving (FSM + stock effect)
1. Create a receiving order at `/3pl-operations/receiving/new` (this is in the 3PL add-on namespace, needs three_pl on). VERIFY whether receiving ties to a PO.
2. Walk created, in_progress, received (complete, cap `receiving.receive`). On complete, trigger `tg_receiving_orders_emit_movements` (migration 0058) emits stock_movements of type receive for each line, warehouse_id set, location_id null. Confirm `/inventory/stock/levels` rolled up quantity_on_hand.

### 5.4 Vendor Bill (FSM) and Expense (FSM + rail)
1. Create a vendor bill at `/purchasing/vendor-bills/new`, walk draft, submitted, approved, partial_paid, paid, closed.
2. Create an expense at `/purchasing/expenses/new`. The detail rail surfaces the next edge (PR #316). Walk draft, submitted, approved, paid, reimbursed; test the reject path. Note the badge for rejected renders as "Declined".

---

## Phase 6: Finance

Surfaces under `/finance/*`. The MONEY sidebar section.

### 6.1 Chart of Accounts
1. `/finance/coa` lists the seeded accounts. Create one at `/finance/coa/new`, edit at `/finance/coa/:id/edit`.

### 6.2 Journal Entries (FSM + auto-number + flag gate)
1. If `/finance/journal-entries` renders FeatureUnavailable, enable `finance.journal_entries.enabled` (VERIFY the exact key) and retry. A 403 FEATURE_DISABLED with `{ flag }` while off is the correct behavior; a 404 is a finding.
2. Create a journal entry. Confirm the number auto-assigns with a JE-M- prefix and there is no number input (PR #322, migration 0119).
3. Add balanced lines (debit total equals credit total, accounts from the COA). Post (draft to posted, cap `journal_entries.post`). Confirm the server rejects an unbalanced entry. Test reverse (posted to reversed).

### 6.3 Period Close (FSM)
1. `/finance/period-close`. VERIFY how a financial period is created (the create surface may be implicit; the route `/finance/periods/new` referenced in some notes may not exist). Walk open, in_review, closed (cap `period_close.close`), then reopen (cap `period_close.reopen`). Confirm closing a period blocks new entries into it.

---

## Phase 7: Settings and Admin

Surfaces under `/admin/*` and `/account/*`. Admin-guarded.

### 7.1 Org Settings
1. `/admin/settings`: org name, timezone, currency. Confirm the owner profile display_name is editable here (seeded NULL by design).

### 7.2 Branding
1. `/admin/branding`: confirm the seeded navy, accent, ink defaults and that overrides persist. Confirm no stock-photo or generic-gradient affordances.

### 7.3 Feature Flags admin
1. `/admin/flags`: the full flag table renders. Toggling is non-optimistic (waits for the server). Enabling a paid plugin without an active or trialing subscription should be pre-emptively disabled with "Requires an active subscription." and the server returns BILLING_REQUIRED if forced. Disabling is always allowed.

### 7.4 Numbering admin
1. `/admin/numbering`: confirm the seeded sequences and prefixes for all doc types, including the later CN- and JE-M- additions.

### 7.5 Members, Billing, SSO, Account Security
1. `/admin/members`: covered in Phase 0.
2. `/admin/billing`: Stripe plan and subscription. Live on prod but the account may still be under Stripe review; a live charge round-trip is out of scope unless you intend to test it. Note the trial gate (`billing.trial_gate.enabled`) is per-org and default OFF; no org is walled unless it is flipped on. If you enable it, confirm the SubscriptionGate wall and TrialBanner appear.
3. `/admin/sso`: connection management. The org.sso.read and org.sso.write caps gate the buttons. The live IdP handshake plus mark-validated is a manual operator step and out of scope; confirm the surface renders and stores connection metadata.
4. `/account/security`: covered in Phase 0.

### 7.6 Default-for-org (PR #323), do this before Phase 3
1. `/settings/sales-config/taxes`: create two taxes. Mark one Default for org. Open the other and confirm its Default for org is now unchecked (setting one unsets others). Same for `/settings/sales-config/payment-methods`. The list shows Yes or No and a Set as default action on non-default rows.
2. Also exercise currencies (read), exchange rates (create), pricing tiers (create, edit).

---

## Phase 8: Add-on, 3PL Operations (the Wave 12 commercial chain)

Needs `plugins.three_pl` on. Surfaces under `/3pl-operations/*`.

### 8.1 Accounts
1. Create an account at `/3pl-operations/accounts/new`, view detail. Accounts are a config entity (active or inactive), not an FSM.

### 8.2 Job Builder
1. Create a job template at `/3pl-operations/job-builders/new` with template lines or steps. Number auto-assigns JB-.
2. Apply a job template to a quote (A3 integration): from the quote create or detail, expand the template lines into quote lines. Priced steps carry as free-text item lines. Confirm job_type threads onto the quote and through conversion to the project.

### 8.3 Supply Plan (FSM)
1. Create a supply plan at `/3pl-operations/supply-plans/new`, linked to a project. Number auto-assigns SUP-. Walk draft, released (reserves stock from warehouse_id, defaults to org default), fulfilled. Confirm the line shortage math (required, available, reserved, shortage) recalculates on release.

### 8.4 Job Run (FSM + daily logs + stock)
1. Create a job run at `/3pl-operations/job-runs/new`. Number auto-assigns JR-. Confirm it snapshots the job template at create (frozen copy).
2. Walk planned, in_progress, completed, closed. Add a daily log (draft to posted, cap `threepl.job_run.daily_log.post`). Posting a daily log emits consumed and produced stock_movements and snapshots labor hours and rate. Confirm `/inventory/stock/movements` reflects the posts.

### 8.5 Billing Review and Profitability
1. Create a billing review at `/3pl-operations/billing-reviews/new`. Number auto-assigns BILL-. Walk draft, approved (cap `threepl.billing_review.approve`). Approval reconciles estimate vs actual and cuts a draft invoice (review moves to invoiced, invoice_id filled). Confirm the linked invoice exists.
2. `/3pl-operations/profitability`: read-only report. Confirm it renders job profitability without leaking raw values.

### 8.6 Shipments (FSM)
1. Create a shipment at `/3pl-operations/shipments/new`. The detail rail surfaces the next edge (PR #316). Walk created, picking, shipped (cap `shipments.ship`). Note: a `delivered` state is referenced in some specs but is not in the current FSM; confirm only created, picking, shipped, cancelled exist.

---

## Phase 9: Add-on, Manufacturing

Needs `plugins.manufacturing` on. Surfaces under `/manufacturing/*`.

1. `/manufacturing` home renders.
2. Create a manufacturing run at `/manufacturing/runs/new` (standalone) and at `/manufacturing/runs/from-bom` (from a BOM). From-bom pre-fills the warehouse and pre-populates consumed_line_items from the parent item's bom_items.
3. Walk draft, started (cap `manufacturing.run.start`), completed (cap `manufacturing.run.complete`). On complete, the run consumes the component lines and produces the output; stock_movements emit for both. consumed_line_items require item_id; produced_line_items allow a null item_id for unknowns or rework. Confirm `/inventory/stock/levels` reflects the consume and produce.
4. Confirm the detail rail and StateStepper render. Test the cancel path.

---

## Phase 10: Add-on, Co-Pack and Ecom (two marquee paths)

Needs `plugins.copack_ecom` on. Surfaces under `/copack/*`. A focused reference plan exists at `03-workspace/smoke-plans/2026-06-01-copack-kitforce-smoke.md`; re-confirm against current code.

### 10.1 Channels
1. Create channels of each kind (Manual, Shopify, Amazon, Other) at `/copack/channels`. Confirm the Kind column renders the label, not raw uppercase. Toggle active and inactive.

### 10.2 Sales Orders (FSM)
1. Create a sales order at `/copack/orders/new` tied to a channel and customer. Number SO-YYYY-NNNNN. Add lines, confirm cents-in dollars-out. Line remove fires a destructive confirm and the table re-renders without reload.
2. Confirm (draft to confirmed, cap `copack.order.confirm`). Post-confirm editing is blocked. Keep the confirmed order for fulfillment.

### 10.3 MARQUEE 1: Fulfillment ship advances the order
1. Create a fulfillment at `/copack/fulfillments/new` against the confirmed order; only confirmed orders are selectable; pick a warehouse. Confirm the SO reference renders the SO number, not a UUID.
2. Walk pending, picking (pick), packed (pack), shipped (ship, confirm dialog). Each transition must return 200 and write a humanized audit row. On ship, verify the parent sales order auto-advanced to shipped and shipped_at stamped.

```sql
select f.fulfillment_number, f.status as ful_status, so.order_number, so.status as order_status, so.shipped_at
from fulfillments f join sales_orders so on so.id = f.sales_order_id
where f.org_id = '<test-org-id>' order by f.created_at desc limit 3;
```

### 10.4 MARQUEE 2: Kitting completion emits stock movements
1. Create a kitting job at `/copack/kitting/new`. Number KIT-YYYY-NNNNN. Add a consumed component line (item, qty, unit cost cents) and a produced kit line. Line remove fires a confirm.
2. Walk draft, started (start), completed (complete, confirm dialog). Each must return 200, not 500. On complete, verify stock_movements emitted for consumed and produced lines.

```sql
select sm.movement_type, sm.quantity, sm.item_id, sm.created_at
from stock_movements sm where sm.org_id = '<test-org-id>'
  and sm.created_at > now() - interval '15 minutes' order by sm.created_at desc;
```

---

## Phase 11: Add-on, KitForce (labor)

Needs `plugins.kitforce` on. Surfaces under `/kitforce/*`.

### 11.1 Members (entity hub tabs)
1. Create a member at `/kitforce/members/new` with a non-zero hourly rate (for example $24.50/hr). Number EMP-YYYY-NNNNN, status ACTIVE.
2. The member detail is a tabbed hub (PR #318). Expected tabs: Overview, Assignments, Time entries, Shifts (VERIFY). Confirm the rate renders as dollars for the owner, gated by read_rate. Deactivate and reactivate; confirm both transitions show in history and the status filter works.

### 11.2 Teams
1. Create a team at `/kitforce/teams`. Add and remove a member; confirm both persist and the table re-renders without a manual reload. Remove fires a confirm.

### 11.3 Shifts (FSM)
1. Create a shift scheduled 09:00 to 17:00 local. Confirm timestamps render in local time, not raw ISO or a UTC-shifted value. Walk scheduled, started, completed. Cancel a separate shift.

### 11.4 Work Assignments (FSM)
1. Create an assignment Unassigned (no member at creation). Number WA-YYYY-NNNNN, status open. On detail, a member picker sits next to Assign. Select a member and Assign (open to assigned). Walk assigned, in_progress, done. Cancel path on a separate one.
2. Negative: Assign with no member selected returns a humanized error ("Select a member to assign this work assignment."), no raw member_id.

### 11.5 Time Entries (labor cost)
1. Clock a member in at `/kitforce/time-entries` with the rate override blank. Confirm the Rate column shows the member's real rate, not $0.00.
2. Clock out after a short interval. Minutes render as a rounded one-decimal value, not a raw float.
3. Negative: clock out with an out-time before the in-time. Expect 409 STATE_CONFLICT and the UI shows the error inline, not a silent no-op.

```sql
select te.id, te.minutes, te.hourly_rate_cents, m.default_hourly_rate_cents
from time_entries te join workforce_members m on m.id = te.member_id
where te.org_id = '<test-org-id>' order by te.created_at desc limit 5;
-- hourly_rate_cents must equal default_hourly_rate_cents when no override given, never 0.
```

---

## Phase 12: Add-on, KitCost

Needs `plugins.kitcost` on. Surface `/kitcost/dashboard`.

1. The dashboard loads (Recharts lazy chunk). Confirm charts render with the cost and margin data from the flows above and that the route lazy-loads (Recharts must not be in the main index chunk). Confirm no raw values or enum leaks.

---

## Phase 13: Add-on, WMS (warehouse execution, bin level)

Needs `plugins.wms` on. Recall this flag is NOT in the seed array, so the F2 UPSERT is required. Surfaces under `/wms/*`.

Contract: WMS deepens, it does not replace. Spine `stock_levels` at warehouse grain stay authoritative. WMS adds a nullable `location_id` dimension and a bin-level rollup. Pre-WMS movements have null location_id and stay valid. Sum of bins equals warehouse on_hand by construction. With WMS off, warehouse totals are intact.

1. `/wms` landing renders. Create locations (bins) at `/wms/locations/new`.
2. `/wms/bin-stock` is a read-only bin-level view.
3. Putaway (FSM): create a putaway task at `/wms/putaway/new` (from a receiving suggestion or manual). Walk suggested, in_progress (start). Assign a destination (set actual_location_id). Complete (cap `wms.putaway.complete`). RPC `complete_putaway_task` emits two internal moves: transfer_out from dock (location_id null) plus transfer_in to bin (location_id = actual_location_id). Warehouse total stays flat, bin grain shifts. Negative: complete with a null destination returns a state conflict.
4. Lots (FSM): create a lot at `/wms/lots/new` (lot_code required, item, optional expiration). Status is always active on create. Quarantine via the RPC (cap `wms.lot.quarantine`). Confirm lot-keyed bin rows reconcile to the warehouse total by lot.
5. Reconciliation check: after putaway, confirm the sum of bin_stock_levels for an item equals stock_levels.quantity_on_hand for that item and warehouse.

---

## Phase 14: Imports and Exports

Needs `feature.imports` and `feature.exports` on. Surfaces `/imports`, `/imports/history`, `/exports`.

### 14.1 Imports (allowlist and FK safety)
1. At `/imports`, upload a CSV for an importable entity (customer, item, vendor, invoice, expense). Validate first (returns total, valid, errors), review, then commit.
2. Confirm column aliasing works (customer email maps to primary_email, phone to primary_phone; invoice number to invoice_number; expense number to expense_number).
3. Security: confirm unknown columns are stripped (Zod strict per entity), and a declared FK that does not exist in-org or belongs to another tenant returns 409, not a silent insert. This is the mass-assignment allowlist; a column outside the allowlist must not write. Filing any allowlist bypass is a P0.

### 14.2 Exports
1. At `/exports`, export an entity to CSV (customer, invoice, payment, journal_entry, expense, stock_movement, shipment, vendor_bill). Confirm money columns emit as integer strings (for example "250", not 250.0) to preserve cents precision. Export is read-only, org-scoped.

---

## Phase 15: Customer Portal

Needs `feature.customer_portal` on (VERIFY the flag still exists; one note suggests it was removed in a later migration). Surfaces under `/portal/*`.

1. Provision a `customer_user` linked to a customer in the test org (via `create_portal_membership`, out-of-band). Sign in at `/portal/signin` (separate session from the operator app).
2. `/portal/dashboard` shows tiles. `/portal/quotes`, `/portal/projects`, `/portal/invoices` each list only that customer's records, scoped by the customer_users mapping. Confirm a customer_user from customer A cannot see customer B's records (RLS).
3. Confirm the PDF download action on quotes and the payment-submit action on invoices. These may be partially wired (F-Wave9-PORTAL-NO-ACTION-WIRING-01); record what works.

---

## Phase 16: Cross-tenant and protocol probes

Use a second test org B and its org_id while authenticated as org A.

1. **RLS read**: GET an org B customer, quote, invoice, fulfillment, kitting job, job run while authed as org A. Expect 200 plus empty on a list, or 404 on a direct id. Never org B's row. Never a 403.
2. **RLS write**: POST a transition (for example fulfillment pick, invoice send, payment apply against an org B invoice id) while authed as org A. Expect 404. A 403 where 404 is expected is a P0 release blocker. Pay special attention to apply flows (payment apply, credit note apply) where the target invoice_id must be org-scoped; this was a historical breach (FK cross-tenant) closed by `assertRefInOrg`.
3. **Plugin gate**: with a pillar off, confirm 404 (Phase 1.1).
4. **Per-route flag**: with a flag off, confirm 403 FEATURE_DISABLED with `{ flag }` (journal entries).
5. **Idempotency**: replay a non-GET with the same Idempotency-Key and a changed body. Expect 409 IDEMPOTENCY_CONFLICT. Replay with the same body and key, expect the same result, no duplicate row.
6. **Capability**: as a viewer, attempt a write (create a quote, post a journal entry). Expect 403 FORBIDDEN even though RLS might also block it.

---

## Phase 17: Brand and audit regression sweep

Across every history timeline and detail page touched above, confirm:
- Action labels are humanized: "Status change" not status_change, "Created" not insert, "Invited" not invited.
- State labels are humanized through the from and to copy; no raw enums.
- No raw ISO timestamps; event times read as local date and time.
- No UUID fragment renders where an entity number or name belongs (name resolution and EntityLabel cover this).
- No em-dashes, double hyphens, or emojis in any UI copy.
- No raw DB error text surfaces. If a 500 occurs, the message is friendly and the 500 itself is filed as P0 or P1.
- Every state transition you drove wrote exactly one audit_log row, chained:

```sql
select entity_type, from_state, to_state, action, triggered_at
from audit_log where org_id = '<test-org-id>'
order by triggered_at desc limit 50;
```

---

## Findings template

```
### F-FULLSMOKE-<NN>
- Severity: P0 | P1 | P2 | P3
- Phase: <phase number and name>
- Surface: <route or API path>
- Expected: <what should happen, cite the invariant or feature>
- Actual: <what happened, with exact on-screen, console, or HTTP text>
- Repro: <numbered steps>
- Suspected area: <SPA page | edge bundle | migration or trigger | RLS | flag>
```

### TL;DR block (fill at the end)
- Fresh-org provisioning and first sign-in: PASS / FAIL
- Plugin gates (404 off, work on) and spine-edge three_pl gate: PASS / FAIL
- Quote-to-cash chain end to end: PASS / FAIL
- Procure-to-pay and receiving stock effect: PASS / FAIL
- 3PL commercial chain (account to billing review): PASS / FAIL
- Manufacturing consume and produce stock: PASS / FAIL
- Co-Pack marquee 1 (fulfillment ship to order shipped): PASS / FAIL
- Co-Pack marquee 2 (kitting complete to stock movements): PASS / FAIL
- KitForce labor cost (clock-in rate non-zero): PASS / FAIL
- WMS bin rollup reconciles to warehouse total: PASS / FAIL
- Recent UI/UX layer (hubs, rail, toasts, palette, inline lines, auto-number, default-for-org, name resolution): PASS / FAIL
- Cross-tenant isolation (404 not 403) and idempotency 409: PASS / FAIL
- Brand and audit sweep clean: PASS / FAIL

---

## Teardown

Cascade-delete the test orgs after the walk. Leave an org in place only if a finding needs inspection; record the org_id and user_id in the findings doc if so.

```sql
delete from organizations where id = '<test-org-id>';      -- cascades to child rows
delete from organizations where id = '<test-org-b-id>';
-- Remove the test auth.users rows separately if your env does not cascade them.
```

---

## Appendix A: Surface inventory (hit every one)

Spine, ungated client-side, but spine edge bundles need `plugins.three_pl` on (see F2):
- Dashboard: `/dashboard`, `/dashboard/summary`
- CRM: `/crm/customers`(+new,:id,:id/edit), `/crm/contacts`(+:id,:id/edit,new), `/crm/leads`(+:id,:id/edit,:id/convert,new), `/crm/opportunities`(+:id,:id/edit,new), `/crm/activities`(+new)
- Quotes: `/quotes`(+new,:id,:id/send)
- Projects: `/projects`(+new,:id)
- Catalog: `/catalog/items`(+new,:id,:id/edit), `/catalog/boms`(+new,:id), `/catalog/vas`(+new,:id/edit)
- Inventory: `/inventory/stock/levels`, `/inventory/stock/movements`, `/inventory/warehouses`(+new,:id,:id/edit)
- Purchasing: `/purchasing/vendors`(+new,:id,:id/edit), `/purchasing/purchase-orders`(+new,:id), `/purchasing/vendor-bills`(+new,:id,:id/edit), `/purchasing/expenses`(+new,:id,:id/edit)
- Sales config: `/settings/sales-config/taxes`(+new,:id/edit), `/settings/sales-config/currencies`, `/settings/sales-config/exchange-rates`(+new), `/settings/sales-config/payment-methods`(+new,:id/edit), `/settings/sales-config/pricing-tiers`(+new,:id/edit)
- Invoicing: `/invoicing/invoices`(+new,:id,:id/send), `/invoicing/payments`(+new,:id/apply), `/invoicing/credit-notes`(+new,:id,:id/apply)
- Finance: `/finance/coa`(+new,:id/edit), `/finance/journal-entries`(+new,:id), `/finance/period-close`
- Cross-cutting: `/search`, `/imports`, `/imports/history`, `/exports`, `/account/security`

Admin (owner/admin): `/admin/settings`, `/admin/branding`, `/admin/flags`, `/admin/numbering`, `/admin/members`, `/admin/billing`, `/admin/sso`

Add-on, 3PL (`plugins.three_pl`): `/3pl-operations/accounts`(+new,:id), `/3pl-operations/job-builders`(+new,:id), `/3pl-operations/supply-plans`(+new,:id), `/3pl-operations/job-runs`(+new,:id), `/3pl-operations/billing-reviews`(+new,:id), `/3pl-operations/profitability`, `/3pl-operations/receiving`(+new,:id), `/3pl-operations/shipments`(+new,:id), `/3pl-operations/production/:id` (legacy detail; list and new redirect to manufacturing)

Add-on, Manufacturing (`plugins.manufacturing`): `/manufacturing`, `/manufacturing/runs`(+new,from-bom,:id)

Add-on, Co-Pack (`plugins.copack_ecom`): `/copack/orders`(+new,:id), `/copack/kitting`(+new,:id), `/copack/channels`, `/copack/fulfillments`(+new,:id)

Add-on, KitForce (`plugins.kitforce`): `/kitforce/members`(+new,:id,:id/edit), `/kitforce/teams`(+:id,:id/edit), `/kitforce/shifts`(+:id), `/kitforce/assignments`(+:id,:id/edit), `/kitforce/time-entries`(+:id/edit)

Add-on, KitCost (`plugins.kitcost`): `/kitcost/dashboard`

Add-on, WMS (`plugins.wms`, not in seed): `/wms`, `/wms/locations`(+new,:id), `/wms/bin-stock`, `/wms/putaway`(+new,:id), `/wms/lots`(+new,:id)

Portal (`feature.customer_portal`): `/portal/signin`, `/portal`, `/portal/quotes`, `/portal/projects`, `/portal/invoices`

Public: `/signin`, `/no-active-org`, `/feature-unavailable`, `/auth/recovery`, `/404`

## Appendix B: State machines (drive every legal edge, reject illegal ones)

Each transition must write one audit_log row and is gated by a capability. Confirmed FSMs:

- **Quote**: draft, submitted, approved, project_pending (terminal), with revise_requested branch and cancelled sink. convert_to_project on approved.
- **Project**: pending, ready_to_build, in_production, ready_to_ship, completed; cancelled.
- **Project phase**: pending, active, completed; cancelled.
- **Invoice**: draft, pending, sent, partially_paid, paid, overdue, refunded, on_hold, cancelled.
- **Credit note**: draft, issued, applied; voided.
- **Journal entry**: draft, posted; reversed.
- **Period close**: open, in_review, closed; reopened.
- **Purchase order**: draft, submitted, approved, partial_received, received, closed; cancelled.
- **Vendor bill**: draft, submitted, approved, partial_paid, paid, closed; cancelled.
- **Expense**: draft, submitted, approved, paid, reimbursed; rejected (renders "Declined").
- **Receiving order**: created, in_progress, received; cancelled. Completion emits stock.
- **Shipment**: created, picking, shipped; cancelled. (No delivered state.)
- **Manufacturing run**: draft, started, completed; cancelled. Completion consumes and produces stock.
- **Production run** (legacy): planned, in_progress, completed; cancelled.
- **Lead**: new, working, qualified, converted; disqualified (reopen allowed).
- **Opportunity**: discovery, evaluation, proposal, negotiation, closed_won; closed_lost; rewinds allowed.
- **Sales order** (Co-Pack): draft, confirmed, picking, packed, shipped; cancelled (advances via fulfillment).
- **Kitting job**: draft, started, completed; cancelled. Completion emits stock.
- **Fulfillment**: pending, picking, packed, shipped; cancelled. Ship advances parent SO.
- **Workforce member**: active, inactive (reversible, not a rich FSM).
- **Shift**: scheduled, started, completed; cancelled.
- **Work assignment**: open, assigned, in_progress, done; cancelled.
- **Supply plan**: draft, released, fulfilled; cancelled.
- **Job run**: planned, in_progress, completed, closed; cancelled.
- **Job run daily log**: draft, posted. Posting emits stock.
- **Billing review**: draft, approved, invoiced; cancelled.
- **Putaway task** (WMS): suggested, in_progress, done; cancelled. Completion emits transfer pair.
- **Lot** (WMS): active, quarantined, expired, consumed.
- **Organization**: provisioning, active, suspended, archived.

No FSM (lifecycle only, no per-transition audit): Payment (record plus allocations), Time entry (clock-in to clock-out), Job templates and Accounts and Warehouse locations (active or inactive config), Notifications and Import jobs (handler-driven, no DB enforcement).

VERIFY every capability string and the exact state set against `supabase/functions/_shared/workflow/*` and its SPA mirror in `apps/web/src/lib/workflow/*` while testing. This appendix is a derived map, and the canon is the code.
