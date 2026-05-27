# Org owner E2E smoke test — Kitstak

**Target executor**: Claude Cowork (or any LLM agent with browser automation + Supabase MCP + Bash)
**Target env**: prod (`https://www.kitstak.com` against Supabase `zmnvwhqjahwidprnjxrq`)
**Excludes**: customer portal (smoke-validated 2026-05-27, see `2026-05-27-customer-portal-smoke.md`)
**Duration estimate**: 90 minutes if green throughout; 2-3 hours with findings to triage
**Tester role**: `org_owner` of a freshly-provisioned test org (NOT the operator's live Kitstak org)

---

## Mission

Exhaustively walk every org_owner-accessible surface in Kitstak end-to-end and report every functional regression, UX gap, copy violation, and constitutional drift. The previous smoke walks (2026-05-21 pillar walks, 2026-05-22 smoke-fix wave, 2026-05-23 audit v3, 2026-05-26 onboarding chassis, 2026-05-27 portal) have shipped a lot of new surface; this run confirms nothing has silently broken AND validates every state machine, capability gate, and audit trigger.

Report findings as `F-Wave9-COWORK-SMOKE-<NN>` items in the findings template at the end of this file. Severities:
- **P0**: cross-tenant RLS bleed, data loss, security violation, constitutional gate broken
- **P1**: functional regression that blocks a normal operator flow
- **P2**: UX gap, copy violation, missing feedback
- **P3**: polish suggestion

---

## Constitutional invariants Cowork must verify continuously

Every action the agent takes against the API should preserve these. If any are violated, file P0 immediately:

1. **Money in cents**: BIGINT cents stored, never float. UI inputs that say "cents" expect raw cents (250 = $2.50). UI inputs that say "dollars" or carry the new `DollarInput` primitive expect dollars.
2. **RLS Pattern A** (`org_id = current_org_id()`): cross-tenant READ returns 200 + empty array. Cross-tenant WRITE returns 404 (not 403).
3. **Idempotency-Key** required on every non-GET handler. Body hash mismatch returns 409.
4. **Audit log append-only**: every state machine transition writes an audit_log row with proper hash chain link.
5. **Capability gates**: roles other than the cap holder get 403 FORBIDDEN.
6. **Forward-only migrations**: never edit a numbered migration file. New work = new numbered file.
7. **Brand discipline on disk**: no em-dashes, no double hyphens, no emojis in any UI copy.
8. **8 roles, ~220 capabilities**: org_owner has full grant. Verify caps haven't drifted.

---

## Pre-flight

### F1. Provision a fresh test org

DO NOT use the operator's live Kitstak org for testing — it has real production data. Provision a sandbox org instead.

Run via Supabase MCP `execute_sql` against `zmnvwhqjahwidprnjxrq`:

```sql
-- Provision a fresh org with org_owner = a test user.
-- Signature: provision_organization(p_slug text, p_display_name text, p_owner_user_id uuid, p_owner_email text)
-- See supabase/migrations/0064_provision_organization_completeness.sql and 0069_provision_organization_claim_stamp.sql.
select provision_organization(
  'cowork_smoke_YYYYMMDD_HHmm',  -- p_slug (replace with actual timestamp)
  'Cowork Smoke Test Co.',       -- p_display_name
  '<test-user-uuid>',            -- p_owner_user_id (a fresh auth.users.id that you create first)
  'cowork+smoke@kitstak.test'    -- p_owner_email
);
```

NOTE: there is no `plan_code` parameter. Plans are surfaced via `org_feature_flags` + `plugins.*` flags, not as a column on `organizations`. Per migration 0069, `provision_organization` now also stamps `kitstak_org_id` + `kitstak_org_role` on the owner's `auth.users.raw_app_meta_data` so the first JWT carries org context.

To create the test user first:
```sql
-- Create a fresh auth.users row via service role (cannot do via SQL directly; use Supabase MCP or supabase admin client)
-- Alternative: invite via existing /admin/members from operator's session, then accept the invite
```

**Easier path**: have the operator's `mike@kitstak.com` account invite a new test user (e.g. `cowork+smoke@kitstak.com`) via `/admin/members` invite flow. The invitee accepts the magic link, sets a password, lands on the dashboard. Then use that user for the rest of the walk — but recognize the test data will live in the operator's Kitstak org, NOT a fresh org.

**Best path** (if Cowork has Supabase service-role access): use `auth.admin.createUser` to mint a fresh user, then provision_organization() with that user as org_owner. Org gets cascade-deleted at teardown.

### F2. Verify pre-flight green

Before starting the walk:

```sql
-- Verify the test org was created and seeded
select o.id, o.display_name,
       (select count(*) from org_memberships m where m.org_id = o.id) as members,
       (select count(*) from warehouses w where w.org_id = o.id) as warehouses,
       (select count(*) from chart_of_accounts c where c.org_id = o.id) as coa,
       (select count(*) from numbering_sequences n where n.org_id = o.id) as numbering,
       (select count(*) from feature_flags f where f.org_id = o.id) as flags
from organizations o
where o.slug = 'cowork_smoke_YYYYMMDD_HHmm';
```

Expected from migration 0064: 1 member, 1 warehouse, 13 COA, 10 numbering, 10 flags.

If any count is off, that's `F-Wave9-COWORK-SMOKE-PROVISION` — the provisioning chassis has regressed.

### F3. Dashboard tabs to keep open

| Purpose | URL |
|---|---|
| Supabase prod SQL editor | https://supabase.com/dashboard/project/zmnvwhqjahwidprnjxrq/sql/new |
| Supabase prod Edge logs (any function) | https://supabase.com/dashboard/project/zmnvwhqjahwidprnjxrq/logs/edge-functions |
| Vercel runtime logs | https://vercel.com/mikes-projects-5e3ecc74/kitstak/logs |
| Sentry issues | https://kitstak.sentry.io/issues/?project=4511423235751936 |
| The test user's email | (whatever provider the test user's email is) |

---

## Phase 1: Auth + onboarding chassis

### 1.1 Sign-in flow

1. Navigate to `https://www.kitstak.com/signin`
2. Sign in as the test user (email + password)
3. Verify landing on `/dashboard`
4. Verify Topbar shows test user's email + org display name
5. Verify Sidebar shows job-mode sections (SELL / MAKE / SHIP / GET PAID / LIBRARY) per Q1 decision

### 1.2 Sign-out + sign-back-in

1. Profile dropdown → Sign out
2. Verify landing on `/signin`
3. Sign in again with same credentials
4. Verify no recovery banner or password prompt appears (test user has set password)

### 1.3 Forgot password flow

1. From `/signin`, click "Forgot password"
2. Enter test user email, submit
3. Verify success message (no enumeration)
4. Open email inbox, find recovery email from `Kitstak <notifications@kitstak.com>`
5. Click recovery link
6. Verify landing on `/auth/recovery`
7. Set a new password
8. Sign in with new password
9. Verify `/account/security` reachable via Topbar profile dropdown
10. Change password again from `/account/security`, verify

### 1.4 First-signin welcome banner

If this is the first sign-in for the test user:
1. Land on `/account/security?welcome=1`
2. See `FirstSigninWelcomeBanner` ("WELCOME TO KITSTAK" + "Built to Ship.")
3. Set initial password
4. Navigate to dashboard

### 1.5 Setup checklist

On the dashboard, see the 8-step `SetupChecklist`:
1. Warehouse (auto-checked from provisioning)
2. Customer
3. Item
4. Quote
5. Receiving
6. Invoice
7. Payment
8. Team invited

Note initial state: step 1 should be green; steps 2-8 should be pending. Walk each step in Phase 2-7 below; the checklist should auto-update.

Expected counter: `1 of 8 complete` initially.

### 1.6 Findings to capture in this phase

- Any console errors during sign-in
- Any 401/403/404 against any Edge endpoint
- Magic link or recovery email not arriving within 5 minutes
- Recovery flow landing at wrong page
- Setup checklist counter not updating

---

## Phase 2: CRM pillar

### 2.1 Customer

1. Sidebar → CRM → Customers → `/crm/customers`
2. Verify empty-state with "Add customer" CTA
3. Click "Add customer" → `/crm/customers/new`
4. Fill: display_name `Test Customer Co.`, primary_email `customer+test@example.com`, default_payment_terms_days `30`
5. Submit
6. Verify redirect to `/crm/customers/:id` detail page
7. Verify dashboard checklist step 2 (Customer) is now green
8. Edit the customer (rename to `Test Customer Co. v2`); verify save success
9. List `/crm/customers` shows the customer with v2 name

### 2.2 Contact

1. From customer detail page, "Add contact" section
2. Create contact with first_name, last_name, email, phone
3. Verify contact appears under the customer
4. Sidebar → CRM → Contacts → verify the contact appears in the global list

### 2.3 Lead

1. Sidebar → CRM → Leads → `/crm/leads`
2. Create lead: display_name `Test Lead`, source `inbound`, status `new`
3. Verify state transitions: new → qualified → converted (use `convert_lead` RPC)
4. Convert lead to customer + opportunity via the action
5. Verify a new customer row was created from the lead
6. Verify a new opportunity row was created
7. Check audit log: lead state transitions + convert action all recorded with hash chain intact

### 2.4 Opportunity

1. Sidebar → CRM → Opportunities → `/crm/opportunities`
2. Find the opportunity from 2.3 convert; verify shape
3. Walk state: open → won (or lost), verify audit log

### 2.5 Activity

1. Sidebar → CRM → Activities
2. Log an activity against the test customer (type `call`, note `Smoke test activity`)
3. Verify it appears on the customer detail page activity feed
4. Edit + delete the activity; verify destructive confirm modal fires

### 2.6 Spot-check RLS on CRM

```sql
-- Confirm the test org's customers are scoped
select id, display_name, org_id from customers where org_id = '<test-org-id>';
-- Confirm no leaks from other orgs
select count(*) from customers where org_id != '<test-org-id>';
```

### 2.7 Findings

- Empty states without "Add X" CTA
- Forms with raw `(cents)` labels instead of `DollarInput`-style humane inputs
- State transitions not appearing in audit log
- `convert_lead` failing or not creating the downstream rows
- Any 500 on the create/edit/delete handlers

---

## Phase 3: Sales config + Items

### 3.1 Items (sales catalog)

1. Sidebar → Library → Items → `/3pl-operations/items`
2. Create item: sku `SKU-COWORK-01`, display_name `Cowork Test Widget`, unit_price_cents `2500` (will read as $25.00 via DollarInput), category `general`
3. Verify dashboard checklist step 3 (Item) goes green
4. Create a second item for use in later quotes/POs
5. Edit + delete one of them

### 3.2 Currencies + Taxes (read)

1. Sidebar → Library → Currencies
2. Verify USD is seeded
3. Sidebar → Library → Taxes
4. Verify empty (operator decision in PR #143 was to skip tax seeding)
5. Try creating a tax row (NJ Sales Tax, 6.625%) — verify create works without errors

### 3.3 VAS + Job types

1. Sidebar → Library → VAS (`/3pl-operations/vas`)
2. Verify the page renders (intentional orphan per F-Wave7-SIDEBAR-IA-01 allowlist)
3. Sidebar → Library → Job types
4. Create a job type, edit it, delete it

### 3.4 Findings

- Any item field that requires "cents" but doesn't use DollarInput
- Tax form behavior with the empty initial state
- VAS / Job type create flows failing

---

## Phase 4: Quote → Project → Invoice → Payment chain

This is the canonical Kitstak quote-to-cash flow. It exercises the most surface in one walk.

### 4.1 Quote create

1. Sidebar → Sell → Quotes → New quote (`/3pl-operations/quotes`)
2. Pick the test customer from CustomerPicker (verify typeahead works)
3. Add 2 line items using ItemPicker (verify pickers populate name + sku + price synchronously per PR-F)
4. Verify quote auto-numbers as `Q-YYYY-NNNNN`
5. Submit form; verify redirect to quote detail
6. Verify dashboard checklist step 4 (Quote) goes green
7. Verify breadcrumbs + display-only stepper render

### 4.2 Quote state machine

Walk the 6-state FSM happy path: `draft → submitted → approved → project_pending` (UI labels: DRAFT → SENT FOR APPROVAL → APPROVED → PROJECT PENDING). The other two states are `revise_requested` (off the happy path) and `cancelled` (terminal). Source: `supabase/migrations/0014_sales_quotes.sql`. `sent` and `converted` are not states; `sent` is a side-effect that stamps `quotes.sent_at`, and converting writes `converted_to_project_id` plus transitions state to `project_pending`.

For each transition:
1. Click the next-step CTA
2. Confirm modal if destructive
3. Verify state badge updates
4. Verify audit_log row written (check via SQL)
5. Verify the AuditTimeline section on the detail page shows the new row immediately (no cache lag per F-Wave6-AUDIT-02 fix)

### 4.3 Quote send (email)

1. From an approved quote, click "Send" with override email = `mike+cowork@team-01.com` (or whatever Cowork can read)
2. Verify Send button shows pending → success feedback (per PR #145)
3. Verify only ONE click is needed (no 7-click regression from May 21)
4. Wait for notifications-drain cron (5 min) OR manually fire it via `gh workflow run notifications-drain.yml`
5. Verify email arrives from `Kitstak <notifications@kitstak.com>`
6. Verify email subject: should be humane (`"Quote <number>"` or similar; should NOT contain raw template strings)

### 4.4 Quote PDF download

1. From quote detail, click "Download PDF"
2. Verify a data:application/pdf base64 download fires
3. Open the PDF, verify it renders cleanly with brand fonts (Bebas Neue + Inter Tight)
4. Verify navy header band + customer name + line items + totals + "Built to Ship." footer

### 4.5 Convert quote to project

1. From an approved quote, click "Convert to project"
2. Verify a new project is created at `/3pl-operations/projects/:id`
3. Verify the project carries the customer FK
4. Verify dashboard project count incremented

### 4.6 Project + line items

1. On the project detail page, verify the original quote lines were copied as project_line_items
2. Add a Material via the "Add Material" form (per PR-F LineForm fix from PR #33)
3. Verify the form rejects malformed values inline (e.g. `2.5` in a `cents` field should explain "enter whole cents")
4. Verify the line appears under PROJECT LINE ITEMS
5. Verify audit_log row for project_line_item.create
6. Edit the line, delete it

### 4.7 Project state machine

Walk: planning → started → completed

Verify each transition fires audit_log + budget recompute (per migration 0059).

### 4.8 Convert project to invoice

1. From the completed project, click "Create invoice"
2. Verify an invoice is created at `/invoicing/invoices/:id`
3. Verify the invoice has lines mirroring the project's line items
4. Verify the invoice auto-numbers as `INV-YYYY-NNNNN` (per migration 0060)
5. Verify invoice issue_date = today; due_date auto-derives from customer's default_payment_terms_days
6. Verify dashboard checklist step 6 (Invoice) goes green

### 4.9 Invoice send

1. From the invoice, click "Send" with email override
2. Verify Send feedback (per PR #145)
3. Verify email arrives
4. Verify invoice `sent_at` and `sent_to` columns stamp

### 4.10 Invoice PDF download

Same as 4.4 but for invoice. Verify the PDF renders the invoice template.

### 4.11 Payment received

1. From the invoice, click "Receive payment"
2. Verify `ReceivePaymentModal` opens (per BNEW-12 + SMOKE-01 fixes)
3. Verify payment method dropdown lists the full enum: Unspecified / ACH / Wire / Check / Card / Cash / Other
4. Submit payment for full balance
5. Verify invoice transitions to `paid` (per migration 0058)
6. Verify dashboard checklist step 7 (Payment) goes green
7. Verify auto-JE row created in finance per migration 0024

### 4.12 Findings to capture

- Any state CTA that doesn't appear when it should
- AuditTimeline cache lag (the F-Wave6-AUDIT-02 bug class)
- Email template containing raw enum strings or null-stringified periods
- PDF render failing or showing minified default fonts
- Numbering chassis assigning sequential numbers correctly

---

## Phase 5: 3PL Ops (Receiving + Shipments)

### 5.1 Warehouse

Already seeded by provisioning. Verify it exists at `/3pl-operations/warehouses`.

Create a second warehouse (rename + reorganize for muscle memory).

### 5.2 Receiving order

1. Sidebar → Ship → Receiving → `/3pl-operations/receiving`
2. Create receiving order against warehouse, vendor (create vendor first if blank — see Phase 6), and project from Phase 4
3. Add receiving line items using the new normalized line items API (per migration 0050 + LINES-01)
4. Submit → state = draft
5. Walk state: draft → received
6. Verify dashboard checklist step 5 (Receiving) goes green
7. Verify `stock_movements` rows fire on `received` transition (per emit_movements trigger redirected in migration 0051)

### 5.3 Shipment

1. Sidebar → Ship → Shipments → `/3pl-operations/shipments`
2. Create shipment with project_id prefilled from project (per PR #134 deep-link)
3. Add shipment line items
4. Walk state: draft → picking → shipped
5. Verify stock_movements rows on `shipped`

### 5.4 Stock levels + movements

1. Sidebar → Ship → Stock levels → verify the items from Phase 3 now show on-hand counts reflecting Receiving + Shipment activity
2. Sidebar → Ship → Stock movements → verify the trail of movement rows is correct (signed quantity, project FK, source entity, etc per audit v3 fixes)

### 5.5 Findings

- emit_movements trigger NOT firing on terminal state transition
- stock_levels NOT updating after movements
- shipment numbering drift
- project deep-link not prefilling the project_id in form

---

## Phase 6: Vendors

### 6.1 Vendor

1. Sidebar → Get Paid → Vendors → `/vendors`
2. Create vendor with display_name, primary_email, default_payment_terms_days
3. Edit, delete one if duplicate

### 6.2 Purchase order

1. From vendor detail page, "Create PO"
2. Add PO lines using items from Phase 3
3. Walk state: draft → sent → received

### 6.3 Vendor bill

1. From the received PO, create vendor bill
2. Verify auto-JE row creates per migration 0029
3. Pay the bill (POST to vendor_bills payment); verify bill state → paid

### 6.4 Expense

1. Sidebar → Get Paid → Expenses
2. Create expense (amount, category, paid_at)
3. Verify auto-JE row created

### 6.5 Findings

- Vendor / PO / bill numbering chassis
- Auto-JE rows missing for any of the create actions

---

## Phase 7: Manufacturing (if `plugins.manufacturing` flag is on for the test org)

### 7.1 Manufacturing run

1. Sidebar → Make → Production runs → `/manufacturing/runs`
2. Create run with warehouse from Phase 5, output item from Phase 3
3. Add Consumed materials (item_id REQUIRED)
4. Add Produced materials (item_id nullable)
5. Verify run auto-numbers as `MFG-YYYY-NNNNN` (per migration 0054)
6. Walk state: draft → started → completed
7. Verify the `window.confirm` gate fires on completion
8. Verify stock_movements rows: negative for consumed, positive for produced
9. Verify AuditTimeline shows `run.draft → run.start → run.complete`
10. Verify the negative-stock inline warning fires when consuming more than on-hand (per PR-A polish)

### 7.2 Findings

- Run not auto-numbering
- emit_movements not firing on completion
- AuditTimeline missing rows

---

## Phase 8: Inventory (BOM)

### 8.1 Bill of materials

1. Sidebar → Make → BOM → `/inventory/bom`
2. Create a BOM linking a finished good (item from 3.1) to component items
3. Verify each BOM line has unit + quantity_e3 + component item ref
4. Edit, delete, save

### 8.2 Findings

- BOM line save failing
- quantity_e3 not converting correctly between UI and DB

---

## Phase 9: KitCost dashboard (if `plugins.kitcost` flag on)

### 9.1 Walk the KPI dashboard

1. Sidebar → Get Paid → KitCost dashboard → `/kitcost/dashboard`
2. Verify 4 KPI cards render: YTD Revenue, Invoiced This Month, etc
3. Verify 3 charts render with brand palette (recharts)
4. Verify "Top customers" shows the test customer (or empty state)
5. Verify the charts don't 500 on empty data

### 9.2 Findings

- Chart render errors
- KPI math off (compare against direct SQL)

---

## Phase 10: Admin surfaces

### 10.1 Members admin

1. Sidebar → profile dropdown → `/admin/members`
2. Verify the test user appears as `(you)` row
3. Invite a second user via the invite form
4. Wait for the invite to arrive, accept, set password
5. Back on `/admin/members`, verify the new user shows up in the list (per PR #155)
6. Open the new user's row actions; change their role from `viewer` to `ops`
7. Try to set their role to `org_owner` (per PR #157, this should succeed because caller is org_owner)
8. Deactivate the user; verify `is_active=false` and row visually marked
9. Reactivate
10. Resend invite to a user that hasn't claimed yet (will need to invite a third user for this test); verify resend fires per PR #157

### 10.2 Branding

1. Sidebar → Admin → Branding (intentional orphan per F-Wave7-SIDEBAR-IA-01; visit `/admin/branding` directly)
2. Upload a logo, change the brand color, save
3. Refresh, verify the brand bar shows the new color
4. Verify the change reflects on a quote PDF render

### 10.3 Feature flags

1. `/admin/flags`
2. Toggle a flag (e.g. `plugins.kitcost`); verify the Sidebar entry appears/disappears within one refetch
3. Toggle back

### 10.4 Org settings

1. `/admin/settings`
2. Change a setting (e.g. default currency); verify persistence

### 10.5 Findings

- PATCH on members row failing
- Privilege escalation guard misfire (org_admin minting org_owner)
- Branding upload not persisting
- Flag toggle not propagating

---

## Phase 11: Collaboration

### 11.1 Attachments

1. From any detail page (e.g. quote, invoice, project), upload an attachment
2. Verify it appears in the attachments list
3. Download it, delete it

### 11.2 Comments

1. From any detail page, post a comment
2. Edit + delete the comment
3. Verify @mention notification fires (if implemented)

### 11.3 Notifications

1. Topbar → Notifications bell (if present)
2. Verify notifications list renders
3. Mark as read, dismiss

### 11.4 Search

1. Topbar → search input
2. Search for the test customer; verify hit
3. Search for a quote number; verify hit
4. Search for a vendor; verify hit

### 11.5 Imports + Exports

1. Sidebar → Imports → `/imports/history` (intentional orphan)
2. Try importing a CSV (if the chassis is wired)
3. Sidebar → Exports → trigger an export, download the result

### 11.6 Findings

- Attachments upload to storage failing
- Comments not persisting
- Search returning empty when it should hit

---

## Phase 12: Cross-cutting constitutional checks

### 12.1 Audit chain integrity

```sql
-- Verify hash chain is intact for the test org
select count(*) as total,
       count(*) filter (where entry_hash is not null) as hashed,
       count(*) filter (where prev_hash is not null) as chained
from audit_log
where org_id = '<test-org-id>';
```

Expected: `total = hashed`, `chained = total - 1` (first row has no prev_hash).

### 12.2 Audit chain verify nightly check

Trigger the audit-chain-verify workflow manually:
```sh
gh workflow run audit-chain-verify.yml
```
Verify it goes green.

### 12.3 Idempotency

For any non-GET endpoint:
1. POST with `Idempotency-Key: <uuid>`, body A → success
2. POST with same key, same body → returns cached response
3. POST with same key, DIFFERENT body → 409 IDEMPOTENCY_CONFLICT
4. After 7 days, the key gets GC'd (test by querying idempotency_keys)

### 12.4 Cross-tenant RLS spot check

Create a second test user in a different test org. From that user's session, try to fetch the first org's customer:
```
GET /crm-api/customers/<first-org-customer-id>
```
Expected: 404 NOT_FOUND, NOT 403 FORBIDDEN.

### 12.5 Capability gate check

Demote the test user to `viewer` role temporarily. Try a write action on any surface. Verify 403 FORBIDDEN with `{code: "FORBIDDEN"}` envelope. Restore to org_owner.

### 12.6 Findings

- Hash chain breaks
- Idempotency conflicts not detected
- Cross-tenant returns 200 or 403 (instead of 404)
- Cap-gated handler permitting unauthorized action

---

## Phase 13: Brand discipline scan (UI copy)

Across every page walked, capture instances of:
- Em-dash (`—`) in any UI copy, label, button, modal, error message
- Double hyphen (`--`)
- Emoji in customer-facing or operator-facing copy
- Stock photography
- Default gradients

Report each as `F-Wave9-COWORK-SMOKE-BRAND-NN` with the exact text + URL.

---

## Teardown

### T1. Save findings

Compile all findings into a single closeout journal:
`03-workspace/journal/2026-05-XX-cowork-e2e-smoke-closeout.md`

Use the findings template at the bottom of this file.

### T2. Cascade-delete the test org

```sql
-- Verify nothing critical depends on this test org
select count(*) from audit_log where org_id = '<test-org-id>';

-- Cascade delete the org and everything it owns
delete from organizations where id = '<test-org-id>';
```

If any FK refuses to cascade, that's `F-Wave9-COWORK-SMOKE-CASCADE` — a cleanup gap to fix.

### T3. Sign-out + close all dashboard tabs

---

## Findings template

```markdown
### F-Wave9-COWORK-SMOKE-NN

**Severity**: P0 | P1 | P2 | P3
**Phase**: <phase number from this plan>
**Surface**: <SPA route OR API endpoint OR SQL query>
**Steps to reproduce**:
1. ...
2. ...
3. ...

**Expected**: ...
**Actual**: ...
**Constitutional concern (if any)**: ...
**Evidence**: <screenshot path, log snippet, SQL result, etc>
```

---

## Stretch goal (only if every phase above is green)

### S1. Concurrent operator simulation

Have two browser sessions signed in as different org_owners of different orgs. Walk parallel quote-to-cash flows. Verify no cross-tenant bleed in either direction. Verify both `audit_log` chains remain intact (no `prev_hash` corruption from concurrent inserts).

### S2. Notifications drain load test

Queue 50 notifications back-to-back (50 sends across 50 different quotes). Watch the drain cron handle the batch. Verify Resend's rate limits are respected and no notifications are lost.

### S3. Sentry error capture verification

Force a synthetic error (e.g. throw from a button onClick handler in dev tools). Verify the error lands in Sentry within 30 seconds with NO PII (no email, no IP, no cookies).

---

## Done criteria

The smoke is complete when:

- [ ] Every phase 1-12 walked to completion
- [ ] Every finding logged with severity + reproduction
- [ ] Closeout journal written
- [ ] Test org cascade-deleted
- [ ] Findings count by severity tallied (e.g. "0 P0, 2 P1, 7 P2, 14 P3")

If P0 surfaces at any point, STOP the walk immediately, file the finding, and dispatch a fix agent. Do not continue testing on a constitutional gate break.
