# Operator E2E Smoke Test (Exhaustive)

Date authored: 2026-06-16. Supersedes `2026-05-27-org-owner-e2e-cowork.md` (which predated the 3PL commercial layer, WMS, and the Wave 13 hardening).

Prod schema baseline: migration 0118. Routes grounded against `apps/web/src/routes.ts` as of this date. Capability codes grounded against `supabase/functions/_shared/capabilities.ts`.

## Purpose

A single operator (org_owner) walks the entire product end to end on a fresh organization, exercises every pillar and the spine, and asserts the constitutional invariants (money in cents, audit log hash chain, RLS isolation, idempotency, plugin gating, capability enforcement, numbering). The goal is to find breaks before a paying customer does.

## How to run

- Target for UI walk: `https://www.kitstak.com` signed in as the org_owner of a fresh org.
- Target for destructive or scripted runs: staging (`dnkgaufydcnedgkuoyml`), schema identical to prod, disposable. Do not run write-heavy automation against the prod database.
- Verification SQL: run via the Supabase SQL editor or MCP against the same project you are testing. Appendix B has the snippets.
- Marking: each step has a checkbox. Mark `[x]` pass, `[!]` fail (log a finding), `[~]` blocked or not reached.
- Severity for findings: P1 blocks a sale or risks data or money integrity. P2 is a real bug with a workaround. P3 is polish or drift.
- Time budget: about 2 hours if green. 3 to 4 hours with triage.

## Conventions and assertion legend

- "Route" is the SPA path. The spine lives at neutral roots (`/quotes`, `/projects`, `/purchasing/*`, `/catalog/*`, `/inventory/*`, `/invoicing/*`, `/finance/*`). The `/3pl-operations/*` equivalents still resolve as redirects; confirm they land on the neutral root.
- `MONEY` assert: every amount is stored as integer cents (`_cents`), sums reconcile exactly, banker's rounding, currency snapshotted on the line.
- `AUDIT` assert: the action wrote an `audit_log` row scoped to the org, with the correct entity type and action, and the hash chain still verifies.
- `RLS` assert: another org cannot see or mutate this row. Cross-tenant reads return 200 with an empty set. Cross-tenant workflow POSTs return 404. A disabled feature flag returns 403 FEATURE_DISABLED. A disabled plugin bundle returns 404.
- `IDEMPOTENCY` assert: replaying the same request with the same Idempotency-Key is a no-op replay. The same key with a different body is 409.
- `NUMBER` assert: the document number matches the configured prefix and format in `/admin/numbering`.

---

## Phase 0. Pre-flight provisioning

- [ ] **P0.1** Provision a fresh org and org_owner. Use Appendix A. Confirm the call returns an org id and an owner user id.
- [ ] **P0.2** `AUDIT` Confirm `organizations.status = active` and an `org_memberships` row exists with role `org_owner`.
- [ ] **P0.3** Confirm seed completeness: 11 feature flag rows (all disabled by default), the numbering sequences seeded, 13 chart-of-accounts rows, one default warehouse.
- [ ] **P0.4** Confirm the owner auth user has `kitstak_org_id` and `kitstak_org_role` stamped in `raw_app_meta_data` (regression of SMOKE-02).
- [ ] **P0.5** Confirm `profiles.display_name` is null, not the org name (regression of SMOKE-08).
- [ ] **P0.6** Enable the add-on flags you intend to exercise: `plugins.three_pl`, `plugins.wms`, `plugins.manufacturing`, `plugins.copack_ecom`, `plugins.kitforce`, `plugins.kitcost`. Leave at least one off to test the gate in Phase 16.

## Phase 1. Auth, onboarding, shell

- [ ] **1.1** Sign in at `/signin` with the owner credentials. Land on `/dashboard`.
- [ ] **1.2** Confirm the dashboard renders without empty silent failure. If the org context is missing it must route to `/no-active-org`, not a blank card grid (regression of SMOKE-03).
- [ ] **1.3** Confirm the setup checklist or onboarding banner populates and reflects real state.
- [ ] **1.4** Confirm the pillar cards on the dashboard reflect the enabled plugins, not a hardcoded subset (regression of SMOKE-09).
- [ ] **1.5** Open the workspace switcher. Confirm it lists the current org.
- [ ] **1.6** Sign out, then sign back in. Confirm session restoration.
- [ ] **1.7** Visit `/account/security`. Confirm MFA (TOTP) enrollment surface renders. Optionally enroll and verify a code.
- [ ] **1.8** Trigger password recovery from `/auth/recovery`. Confirm the email path starts (do not complete unless you have inbox access).

## Phase 2. Admin and org setup

- [ ] **2.1** `/admin/settings` Edit default currency and a base org setting. Save. `AUDIT`.
- [ ] **2.2** `/admin/branding` Upload a logo and set the brand color. Confirm it renders in the shell. `AUDIT`.
- [ ] **2.3** `/admin/flags` Toggle a plugin flag off then on. Confirm the affected nav and routes appear and disappear. `AUDIT`.
- [ ] **2.4** `/admin/numbering` Confirm each document type has a prefix and current counter. Note the prefixes for the NUMBER asserts below.
- [ ] **2.5** `/admin/members` Invite a second user. Confirm the invite is created. Change a role. Deactivate then reactivate. `AUDIT` on each. Confirm the Name column shows the user name, not the org name (regression of SMOKE-08).
- [ ] **2.6** `/admin/billing` Confirm the subscription and plan render. Do not run a live charge here; Stripe live round-trip is a separate plan.
- [ ] **2.7** `/admin/sso` Confirm the SSO connection management surface renders for the org_owner. Note: SSO is gated by the `auth.sso_saml` flag at the server. With the flag off, configuring a connection must fail closed (403 FEATURE_DISABLED). This is a known cosmetic gap: the menu item shows regardless of the flag.

## Phase 3. CRM

- [ ] **3.1** `/crm/customers/new` Create a customer with name, email, phone, default payment terms. `AUDIT` `NUMBER` if numbered. Cap `crm.customers.write`.
- [ ] **3.2** `/crm/customers/:id/edit` Edit the customer. Confirm the update. `AUDIT`.
- [ ] **3.3** `/crm/contacts/new` Create a contact linked to the customer. Cap `crm.contacts.write`. `AUDIT`.
- [ ] **3.4** `/crm/leads/new` Create a lead. Cap `crm.leads.write`. `AUDIT`.
- [ ] **3.5** `/crm/leads/:id/convert` Convert the lead. Confirm the lead state moves to converted and a customer (and opportunity, if wired) is created. Cap `crm.leads.convert`. `AUDIT` records the transition.
- [ ] **3.6** `/crm/opportunities/new` Create an opportunity. Transition its stage. Cap `crm.opportunities.write`. `AUDIT`.
- [ ] **3.7** `/crm/activities/new` Log an activity against the customer. Cap `crm.activities.write`. `AUDIT`.
- [ ] **3.8** `RLS` Confirm a second org cannot read these customers (Appendix B cross-tenant probe).

## Phase 4. Catalog and sales config

- [ ] **4.1** `/catalog/items/new` Create an item with SKU, display name, unit, and `unit_price_cents`. Cap `items.item.write`. `MONEY` `AUDIT`.
- [ ] **4.2** `/catalog/items/:id/edit` Edit the item price. Confirm the new cents value. `MONEY`.
- [ ] **4.3** `/settings/sales-config/taxes/new` Create a tax. Set it default. Cap `taxes.tax.write`, `taxes.tax.set_default`.
- [ ] **4.4** `/settings/sales-config/currencies` Confirm currencies list reads (global Pattern C table).
- [ ] **4.5** `/settings/sales-config/exchange-rates/new` Create an exchange rate. Cap `currencies.exchange_rate.write`.
- [ ] **4.6** `/settings/sales-config/payment-methods/new` Create a payment method. Set default.
- [ ] **4.7** `/settings/sales-config/pricing-tiers/new` Create a pricing tier and an override. Cap `pricing_tiers.tier.write`.
- [ ] **4.8** `/catalog/vas/new` Create a value-added service. Cap `vas.service.write`. `AUDIT`.
- [ ] **4.9** Create a job type (sales config). Cap `jobs.job_type.write`.
- [ ] **4.10** `/catalog/boms/new` Create a bill of materials (finished good plus components). Cap `stock.bom.write`. Note: `bom_items` is keyed by parent item; there is no separate boms table.

## Phase 5. Quote to cash (canonical money chain)

This is the most important chain. Walk it carefully.

- [ ] **5.1** `/quotes/new` Create a quote for the customer with a currency. Cap `quotes.quote.write`. `NUMBER` (Q prefix). `AUDIT`. Confirm a create row is in `audit_log` (regression of SMOKE-05).
- [ ] **5.2** Add at least two line items, one item-based and one free text. Confirm `unit_price_cents` and the line totals. `MONEY`.
- [ ] **5.3** Submit the quote. Confirm the state moves to submitted. Cap `quotes.quote.submit`. `AUDIT` transition.
- [ ] **5.4** Approve the quote. Confirm the state moves to approved and the totals lock. Cap `quotes.quote.approve`. `AUDIT`.
- [ ] **5.5** `/quotes/:id/send` Send the quote. Override the recipient. Confirm the send is recorded. Cap `quotes.send`. `AUDIT`.
- [ ] **5.6** Download the quote PDF. Confirm brand rendering (Bebas Neue header, Inter Tight body) and that the figures match. Cap `quotes.pdf.read`.
- [ ] **5.7** Convert the quote to a project. Cap `quotes.convert_to_project`. Confirm a project is created carrying the quote lines, and the quote state reflects conversion. `AUDIT` records `convert_quote_to_project`.
- [ ] **5.8** `/projects/:id` Add a project line item. Edit it. Delete it. Cap `projects.line_item.*`. `MONEY`.
- [ ] **5.9** Transition the project through its states to completed. Confirm budget recompute updates the totals. Cap `projects.transition`. `AUDIT` each transition.
- [ ] **5.10** Convert the project to an invoice. Cap `projects.convert_to_invoice`. `NUMBER` (INV prefix). Confirm the invoice carries the project lines. `MONEY`.
- [ ] **5.11** `/invoicing/invoices/:id` Confirm the invoice total equals the sum of its line totals exactly. `MONEY`.
- [ ] **5.12** Transition the invoice to sent. Confirm the state. Cap `invoices.transition`. `AUDIT`. Note SMOKE-07: confirm the state stepper does not show a `pending` state that the audit log never recorded. If send jumps draft to sent, the stepper must not render a filled pending step.
- [ ] **5.13** `/invoicing/invoices/:id/send` Send the invoice and download its PDF. Cap `invoices.send`.
- [ ] **5.14** `/invoicing/payments/new` Create a payment with `amount_cents` and a method. Cap `payments.write`. `MONEY` `AUDIT`.
- [ ] **5.15** `/invoicing/payments/:id/apply` Apply the payment to the invoice. Cap `payments.apply`. Confirm the allocation row and the recomputed invoice balance. `MONEY`. `IDEMPOTENCY`: re-applying the same payment to the same invoice must not double-allocate.
- [ ] **5.16** Confirm the invoice moves to paid when the balance reaches zero (migration 0058). `AUDIT`.
- [ ] **5.17** Over-allocation guard: attempt to apply more than the invoice balance. Confirm it is rejected at the ceiling, not silently allowed.
- [ ] **5.18** `/invoicing/credit-notes/new` Create a credit note. Apply it via `/invoicing/credit-notes/:id/apply`. Cap `credit_notes.apply`. `MONEY` `AUDIT`.
- [ ] **5.19** `RLS` Cross-tenant write probe: from org B, attempt to apply a payment or credit note to org A's invoice. Must 404, must not mutate org A (regression of the Wave 13 cross-tenant FK fix, rls-probe Category 12).

## Phase 6. Purchasing and finance

- [ ] **6.1** `/purchasing/vendors/new` Create a vendor. Cap `vendors.vendor.create`. `AUDIT`.
- [ ] **6.2** `/purchasing/purchase-orders/new` Create a PO with lines. Transition draft to sent to received. Cap `purchase_orders.*`. `MONEY` `AUDIT` `NUMBER`.
- [ ] **6.3** `/purchasing/vendor-bills/new` Create a vendor bill from the PO. Post it. Cap `vendor_bills.vendor_bill.transition`. `MONEY`. Confirm an auto journal entry row is created.
- [ ] **6.4** `/purchasing/expenses/new` Create an expense. Submit, approve, pay. Cap `expenses.expense.*`. `MONEY` `AUDIT`. Confirm an auto journal entry.
- [ ] **6.5** `/finance/coa/new` Create a chart-of-accounts entry. Cap `coa.write`.
- [ ] **6.6** `/finance/journal-entries/new` Create a journal entry with balanced debit and credit lines. Post it. Cap `journal_entries.post`. `MONEY` (debits equal credits). Note: this is gated by `finance.journal_entries.enabled`. With the flag off, POST returns 403 FEATURE_DISABLED.
- [ ] **6.7** `/finance/period-close` Close a period. Cap `period_close.close`. `AUDIT`: confirm the close writes an audit row via a trigger, not a best-effort handler (this was a Wave 13 fix; verify the trigger fired).

## Phase 7. Inventory and 3PL operations (plugins.three_pl)

- [ ] **7.1** `/inventory/warehouses/new` Create a second warehouse. Cap `warehouses.warehouse.create`. `AUDIT`.
- [ ] **7.2** `/3pl-operations/receiving/new` Create a receiving order with lines. Receive it. Cap `receiving.receive`. Confirm `stock_movements` rows fire (one per line) and `stock_levels` updates. `AUDIT` transition. `IDEMPOTENCY`: re-receiving must 409, not double-count.
- [ ] **7.3** `/inventory/stock/levels` Confirm the received quantities appear. `/inventory/stock/movements` Confirm the ledger rows.
- [ ] **7.4** `/3pl-operations/shipments/new` Create a shipment with lines. Transition draft to picking to shipped. Cap `shipments.ship`. Confirm negative stock movements. `AUDIT`.
- [ ] **7.5** Plugin gate: with `plugins.three_pl` off, confirm `/3pl-operations/receiving` and the inventory create surfaces return 404 at the API (regression of SMOKE-06). Spine reads (quotes, projects) must remain available.

## Phase 8. 3PL commercial add-on (plugins.three_pl)

- [ ] **8.1** `/3pl-operations/accounts/new` Create an account. Add a service rate definition with `rate_cents_per_unit`. Cap `threepl.account.write`, `threepl.account_service.write`. `MONEY` `NUMBER` (ACC prefix).
- [ ] **8.2** `/3pl-operations/job-builders/new` Create a job template. Add component, service, and step lines. Cap `threepl.job_template.write`. `NUMBER` (JB prefix). `AUDIT`.
- [ ] **8.3** On a draft quote, apply the job template. Confirm the template lines expand into quote lines (component to item, service to vas, priced step to a free-text line) and the quote `job_type_id` is set. `MONEY`.
- [ ] **8.4** Convert that quote to a project. Confirm the project carries `source_job_template_id` and a frozen `job_template_snapshot`. Confirm editing the template afterward does not change the project snapshot.
- [ ] **8.5** `/3pl-operations/supply-plans/new` Create a supply plan against the project with lines. Cap `threepl.supply_plan.write`. `NUMBER` (SUP prefix).
- [ ] **8.6** Release the supply plan (`release_supply_plan`). Confirm `stock_levels.quantity_reserved` increases by `min(required, available)` per reserve-resolution line, the shortage is recorded, and reserve movements are written. `MONEY` of quantities. `AUDIT`.
- [ ] **8.7** Cancel the supply plan (`cancel_supply_plan`). Confirm `quantity_reserved` is released back. `AUDIT`.
- [ ] **8.8** Create and release a fresh supply plan, then `/3pl-operations/job-runs/new` create a job run linked to it. Start it (`start_job_run`). Cap `threepl.job_run.write`. `NUMBER` (JR prefix).
- [ ] **8.9** Add a daily log. Add consumed and produced lines. Post the daily log (`post_job_run_daily_log`). Confirm it locks. `IDEMPOTENCY`: re-post must 409.
- [ ] **8.10** Complete then close the job run (`complete_job_run`, `close_job_run`). Confirm `fulfill_supply_plan` released the remaining reserves so `quantity_reserved` is not left stale. `AUDIT`.
- [ ] **8.11** `/3pl-operations/billing-reviews/new` Create a billing review for the account. Approve it (`approve_billing_review`). Confirm a DRAFT invoice is created from the account service rates with the correct lines. `MONEY` `AUDIT`. `IDEMPOTENCY`: re-approve must not create a second invoice.
- [ ] **8.12** `/3pl-operations/profitability` Confirm the job profitability view shows estimate versus job-run actuals (labor plus consumed material) versus billed revenue, one row per job run. Read only. `MONEY`.

## Phase 9. WMS add-on (plugins.wms)

- [ ] **9.1** `/wms/locations/new` Create bin, shelf, rack, dock, and staging locations. Cap `wms.location.create`. `AUDIT`.
- [ ] **9.2** Create a receiving order and receive it to a dock (`dock_location_id` on the header). Confirm the dock is validated to be in the same warehouse; a cross-warehouse dock must 404.
- [ ] **9.3** `/wms/putaway/new` Create a putaway task from a received line. Start it. Set the destination bin. Complete it (`complete_putaway_task`). Confirm two stock movements: a `transfer_out` at the dock and a `transfer_in` at the destination bin. Cap `wms.putaway.*`. `AUDIT`.
- [ ] **9.4** `/wms/bin-stock` Confirm the bin stock rollup. CONSTITUTIONAL INVARIANT: the sum of all bin quantities for an item in a warehouse must equal that warehouse's `quantity_on_hand` for the item. Verify with Appendix B. This is the WMS sum-reconcile contract.
- [ ] **9.5** `/wms/lots/new` Create a lot with an expiration date. Quarantine it. Cap `wms.lot.*`. `AUDIT`.
- [ ] **9.6** Plugin gate: with `plugins.wms` off, confirm `/wms/*` API returns 404 while spine inventory still works.

## Phase 10. Manufacturing add-on (plugins.manufacturing)

- [ ] **10.1** `/manufacturing/runs/new` Create a production run with a warehouse. Add consumed and produced lines. Cap `manufacturing.run.create`. `NUMBER` (MFG prefix).
- [ ] **10.2** Start the run (`manufacturing.run.start`). `AUDIT`.
- [ ] **10.3** Complete the run (`manufacturing.run.complete`). Confirm consumed lines emit negative stock movements and produced lines emit positive, and `stock_levels` updates. `AUDIT`.
- [ ] **10.4** Create a second run and cancel it. Confirm no stock movement. `manufacturing.run.cancel`.
- [ ] **10.5** `/manufacturing/runs/from-bom` Create a run seeded from a BOM. Confirm the consumed lines populate from the BOM components.

## Phase 11. Co-Pack add-on (plugins.copack_ecom)

- [ ] **11.1** `/copack/channels` Create a sales channel. Cap `copack.channel.write`. `AUDIT`.
- [ ] **11.2** `/copack/orders/new` Create a sales order with lines. Confirm it. Cap `copack.order.confirm`. `NUMBER` `AUDIT`.
- [ ] **11.3** `/copack/kitting/new` Create a kitting job with consumed and produced lines. Start then complete it. Cap `copack.kitting_job.*`. Confirm stock movements if wired. `AUDIT`.
- [ ] **11.4** `/copack/fulfillments/new` Create a fulfillment for the order. Pick, pack, ship. Cap `copack.fulfillment.pick`, `pack`, `ship`. Confirm the ship cascades the parent sales order to shipped via the trigger. `AUDIT`.
- [ ] **11.5** Create a second order and cancel it before fulfillment. Confirm the cancel. `copack.order.cancel`.

## Phase 12. KitForce add-on (plugins.kitforce)

- [ ] **12.1** `/kitforce/members/new` Create a member with `default_hourly_rate_cents`. Cap `kitforce.member.create`. `MONEY` `NUMBER` (EMP prefix).
- [ ] **12.2** Read the member rate. Confirm the rate is only visible to org_owner and accounting (cap `kitforce.member.read_rate`). As ops, confirm the rate is stripped server side, not just hidden in the UI.
- [ ] **12.3** Deactivate then reactivate the member. `AUDIT`.
- [ ] **12.4** `/kitforce/teams` Create a team. Add the member. Cap `kitforce.team.write`.
- [ ] **12.5** `/kitforce/shifts` Create a shift. Start then complete it. Cap `kitforce.shift.*`. `NUMBER` (SHF prefix). `AUDIT`.
- [ ] **12.6** `/kitforce/assignments` Create an assignment. Assign the member. Start then complete it. Cap `kitforce.assignment.*`. `NUMBER` (WA prefix).
- [ ] **12.7** `/kitforce/time-entries` Clock in. Clock out. Confirm `minutes_worked` and `labor_cost_cents` derive correctly from `hourly_rate_cents` and the interval. Cap `kitforce.time_entry.write`. `MONEY`. `IDEMPOTENCY`: re-clock-out must 409.
- [ ] **12.8** Patch a time entry to correct the times. Confirm the cost re-derives. `AUDIT`.

## Phase 13. KitCost add-on (plugins.kitcost)

- [ ] **13.1** `/kitcost/dashboard` Confirm the KPI cards render with real figures (inventory value, project cost, labor cost, profitability). Cap `kitcost.dashboard.view`. `MONEY`.
- [ ] **13.2** Confirm the charts render with the brand palette (Recharts lazy chunk) and the top customers list populates.
- [ ] **13.3** Plugin gate: with `plugins.kitcost` off, confirm `/kitcost/dashboard` API returns 404.

## Phase 14. Collaboration and tooling

- [ ] **14.1** Upload an attachment to a quote and to a project. Delete one. Cap `attachments.attachment.*`. `AUDIT`.
- [ ] **14.2** Post a comment on an entity. Edit it. Delete it. Cap `comments.comment.*`.
- [ ] **14.3** Confirm the notifications bell surfaces a notification. Mark it read. Cap `notifications.notification.update`.
- [ ] **14.4** `/search` Global search for a customer, a quote, and a vendor. Confirm results route to the correct neutral root (not a stale `/3pl-operations/*` href; this is follow-up SEARCH-API-REROUTE-HREF-01, verify the landing path).
- [ ] **14.5** `/imports` Validate then commit a CSV import. Cap `imports.job.validate`, `imports.job.commit`. Confirm only allowlisted columns are mapped (regression of the Wave 13 CSV mass-assignment fix). `/imports/history` shows the run.
- [ ] **14.6** `/exports` Create an export. Cap `exports.job.create`. Confirm the file.

## Phase 15. Customer and vendor portal

- [ ] **15.1** From `/crm/customers/:id`, invite the customer to the portal. Cap `crm.customers.invite_to_portal`.
- [ ] **15.2** Sign in at `/portal/signin` as the customer_user.
- [ ] **15.3** `/portal/invoices`, `/portal/quotes`, `/portal/projects` Confirm the customer sees only their own records. `RLS` Pattern B (parent-join scope). A non-customer_user or anonymous caller must 404 the portal API.
- [ ] **15.4** Confirm the customer cannot reach any admin or internal route.

## Phase 16. Constitutional invariants (cross-cutting)

- [ ] **16.1** `MONEY` Sweep: query for any non-integer or any column holding money outside a `_cents` suffix. Confirm wire values are integers or strings, never floats. Confirm currency is snapshotted on each line item.
- [ ] **16.2** `AUDIT` Hash chain: run `verify_audit_chain` (Appendix B). Confirm it returns valid for the org. Confirm both entity creates and state transitions wrote rows (regression of SMOKE-05).
- [ ] **16.3** `RLS` Cross-tenant matrix: from a second org, attempt list reads (expect 200 and empty), detail reads (empty), workflow POSTs (404), and a feature-flag-off route (403 FEATURE_DISABLED with the flag in details). This mirrors the nightly rls-probe; spot-check a few per pillar.
- [ ] **16.4** `IDEMPOTENCY` Replay: pick three non-GET routes. Replay with the same Idempotency-Key and identical body; expect a replay. Replay with the same key and a changed body; expect 409 IDEMPOTENCY_CONFLICT.
- [ ] **16.5** Plugin gates: for each add-on, with its flag off, confirm the bundle returns 404 and the SPA routes to `/feature-unavailable`. Confirm no half-gated surface where the shell renders but the query 404s (regression of SMOKE-06).
- [ ] **16.6** `NUMBER` Confirm each document type used above produced a number matching `/admin/numbering`. No gaps that imply a lost sequence, no collisions.
- [ ] **16.7** SECURITY DEFINER exposure: confirm the only authenticated-executable SECURITY DEFINER functions are `current_org_id` and `current_user_role` (regression of the Wave 13 0117 revoke; advisor count should be 2).

## Phase 17. Capability and role matrix

Re-run a representative slice as each non-owner role. The server is the authority; the SPA only hides buttons.

- [ ] **17.1** org_admin: can manage members, settings, most writes. Confirm.
- [ ] **17.2** sales: can write CRM, quotes, projects. Cannot post journal entries or close periods. Confirm a denied action returns 403 FORBIDDEN, not a silent allow.
- [ ] **17.3** ops: can run receiving, shipments, production, WMS. Cannot read KitForce member rates. Confirm the rate strip.
- [ ] **17.4** accounting: can post journal entries, close periods, read member rates. Cannot transition a job run.
- [ ] **17.5** viewer: read only everywhere. Confirm every write surface is denied at the server.
- [ ] **17.6** customer_user: portal only (Phase 15).
- [ ] **17.7** vendor_user: vendor-scoped surfaces only. Confirm no access to other tenants or internal routes.

## Phase 18. Regression of the 2026-05-26 findings (SMOKE-01..09)

- [ ] **18.1** SMOKE-01 (P3, numbering count): informational only. Confirm the seeded counts reflect current pillars; not a defect.
- [ ] **18.2** SMOKE-02 (P1, auth metadata not stamped): expected FIXED by migration 0069. Confirm P0.4 passed.
- [ ] **18.3** SMOKE-03 (P2, silent empty dashboard on NO_ACTIVE_ORG): confirm 1.2. Is there now a visible state or redirect?
- [ ] **18.4** SMOKE-04 (P3, plan and route drift): this plan is the corrected contract. Confirm the routes here resolve.
- [ ] **18.5** SMOKE-05 (P1, entity creates not in audit_log): confirm 5.1 and 16.2. Do `customer.created`, `item.created`, `quote.created`, `invoice.created` write audit rows now?
- [ ] **18.6** SMOKE-06 (P1, partial plugin gating): confirm 7.5, 9.6, 13.3, 16.5. Is the full `/3pl-operations/*` surface now gated when `plugins.three_pl` is off?
- [ ] **18.7** SMOKE-07 (P2, invoice send skips pending but stepper shows it): confirm 5.12.
- [ ] **18.8** SMOKE-08 (P3, members Name shows org name): expected FIXED by migration 0072. Confirm P0.5 and 2.5.
- [ ] **18.9** SMOKE-09 (P3, dashboard pillars hardcoded to 3): confirm 1.4. Do all enabled add-ons appear?

---

## Appendix A. Provisioning a fresh org (service role)

Run against the target project. This creates an owner auth user and provisions the org with seeds and the JWT claim stamp.

```sql
with nu as (
  insert into auth.users
    (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  values
    (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'smoke-owner@smoke.example.com', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb)
  returning id
)
select public.provision_organization('smoke-owner-01', 'Smoke Test Co', (select id from nu), 'smoke-owner@smoke.example.com') as org_id,
       (select id from nu) as owner_id;
```

To drive the authenticated edge API (caps, idempotency, plugin gates, validation), you also need the anon key and a user JWT. Set the user password via the GoTrue admin API, then sign in at `${SUPABASE_URL}/auth/v1/token?grant_type=password` to mint the access token. Call edge functions at `${SUPABASE_URL}/functions/v1/<bundle>/<route>` with `Authorization: Bearer <jwt>`, `apikey: <anon>`, `idempotency-key: <uuid v4>`, `content-type: application/json`.

Enable add-on flags:

```sql
update org_feature_flags set is_enabled = true
where org_id = '<org_id>'
  and flag_key in ('plugins.three_pl','plugins.wms','plugins.manufacturing','plugins.copack_ecom','plugins.kitforce','plugins.kitcost');
```

## Appendix B. Verification SQL

WMS sum-reconcile invariant (Phase 9.4):

```sql
-- For each item in a warehouse, the sum of bin quantities must equal the warehouse on-hand.
select w.warehouse_id, w.item_id, w.warehouse_on_hand, b.bin_sum,
       (w.warehouse_on_hand = coalesce(b.bin_sum,0)) as reconciles
from (
  select warehouse_id, item_id, quantity_on_hand as warehouse_on_hand
  from stock_levels where org_id = '<org_id>'
) w
left join (
  select warehouse_id, item_id, sum(quantity_on_hand) as bin_sum
  from bin_stock_levels where org_id = '<org_id>'
  group by warehouse_id, item_id
) b using (warehouse_id, item_id);
```

Audit chain verify (Phase 16.2):

```sql
select * from verify_audit_chain();  -- confirm valid; inspect any break
select entity_type, action, count(*)
from audit_log where org_id = '<org_id>'
group by entity_type, action order by entity_type, action;
```

Cross-tenant read probe (Phase 16.3): authenticate as org B and select org A rows; expect zero rows, never an error.

SECURITY DEFINER exposure (Phase 16.7):

```sql
select p.proname
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prosecdef
  and has_function_privilege('authenticated', p.oid, 'EXECUTE')
order by 1;  -- expect only current_org_id and current_user_role
```

## Appendix C. Findings template

Log each failure here. One row per finding.

| ID | Severity | Phase step | Title | Expected | Actual | Suspected root cause |
|----|----------|-----------|-------|----------|--------|----------------------|
| SMOKE-YYYYMMDD-01 | P1/P2/P3 | e.g. 5.15 | | | | |

## Teardown

On staging the org is disposable; leave it or delete by org id. Do not delete `audit_log` rows on prod (append-only hash chain). If you ran on prod, leave the test org labeled and sweep with care, or prefer staging for any repeat.
