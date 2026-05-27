# Cowork E2E Smoke Closeout — 2026-05-26

**Plan**: `03-workspace/smoke-plans/2026-05-27-org-owner-e2e-cowork.md`
**Executor**: Claude (Cowork mode), autonomous
**Target env**: prod `https://www.kitstak.com` against Supabase `zmnvwhqjahwidprnjxrq`
**Test user**: `cowork+smoke20260526@team-01.com` (org_owner, fresh)
**Test org**: `Cowork Smoke Test Co.` slug `cowork_smoke_20260526_e2e` id `05cb1eac-dd7e-4393-b4a4-d4a0dd2aba8c`

## Pre-flight

Test user minted via direct insert into `auth.users` (service-role SQL through MCP). `provision_organization()` called with the fresh uuid.

Seeded counts:

| Resource | Expected | Actual | Status |
|---|---|---|---|
| members | 1 | 1 | green |
| warehouses | 1 | 1 | green |
| chart_of_accounts | 13 | 13 | green |
| numbering_sequences | 10 | 11 | P3 finding |
| org_feature_flags | 10 | 10 | green |

## Findings

### F-Wave9-COWORK-SMOKE-01

**Severity**: P3
**Phase**: Pre-flight (F2)
**Surface**: `provision_organization` RPC, table `numbering_sequences`
**Steps to reproduce**:
1. `select provision_organization('cowork_smoke_...', '...', '<uuid>', '<email>')`
2. `select count(*) from numbering_sequences where org_id = '<new-org>'`

**Expected**: 10 numbering sequences seeded (per plan F2).
**Actual**: 11 sequences seeded.
**Constitutional concern**: None. Plan documentation drift, not chassis regression. Either a new sequence was added since the plan was written and the plan needs an update, or one is duplicated. Recommend a follow-up to grep the seed source and reconcile.
**Evidence**: SQL result `{"numbering":11}` on org `05cb1eac-dd7e-4393-b4a4-d4a0dd2aba8c`.

---

### F-Wave9-COWORK-SMOKE-02

**Severity**: P1
**Phase**: Pre-flight (F1)
**Surface**: `provision_organization` SQL function, `auth.users.raw_app_meta_data`
**Steps to reproduce**:
1. Insert a fresh row directly into `auth.users` (or call `supabase.auth.admin.createUser`).
2. Call `select provision_organization(slug, name, user_id, email)`.
3. Verify row created: org, membership(role=org_owner), warehouse, COA, numbering, flags all seed OK.
4. Sign that user into `https://www.kitstak.com/signin` with their password.
5. SPA lands on `/dashboard`. Hit any tenant-scoped endpoint (e.g. `dashboard-api/dashboard/summary`).

**Expected**: 200 with dashboard summary payload.
**Actual**: 401 `{"error":{"code":"NO_ACTIVE_ORG","message":"No active organization claim."}}`. SPA dashboard renders KPI placeholders empty and PILLARS only renders the 3 with hard-coded fallbacks; the brand+flags fetches that drive the SetupChecklist and the rest of the pillars also 401-out, so the page degrades to a half-empty shell.

**Root cause** (confirmed via grep + DB inspection):
- `_shared/tenant.ts::requireCaller()` reads `app_metadata.kitstak_org_id` + `app_metadata.kitstak_org_role` from the JWT.
- `provision_organization()` creates the org, the membership, and the profile row, **but does not update** `auth.users.raw_app_meta_data` with `kitstak_org_id` / `kitstak_org_role` for the owner.
- Existing live users (e.g. `mike@kitstak.com`) have these claims set; the new test user did not. Manually `UPDATE auth.users SET raw_app_meta_data = raw_app_meta_data || '{"kitstak_org_id":"...","kitstak_org_role":"org_owner"}'::jsonb` + re-login unblocks the entire app.

**Constitutional concern**: Provisioning chassis regression. The "Best path" documented in the smoke plan F1 is broken end-to-end: a freshly-minted user + freshly-provisioned org cannot use the SPA until someone hand-edits auth metadata. Either `provision_organization` must take a service-role admin client and call `auth.admin.updateUserById` to attach the claims, or the SPA's initial sign-in must call a `tenants-api/switch-org` (or equivalent) handler that pushes the claims onto the user before issuing the redirect.

**Evidence**: `raw_app_meta_data` SELECT before/after; `dashboard-api/dashboard/summary` 401 then 200 across the patch boundary.

---

### F-Wave9-COWORK-SMOKE-03

**Severity**: P2
**Phase**: Phase 1.5
**Surface**: `/dashboard` render when `NO_ACTIVE_ORG` is returned by support fetches
**Steps to reproduce**: Trigger `F-Wave9-COWORK-SMOKE-02` state (test user without `kitstak_org_id` claim).
**Expected**: SPA either redirects to a friendly "pick an org" screen, or surfaces a top-level error banner saying "Your account is missing an active organization. Contact support."
**Actual**: Dashboard renders silently with 4 KPI cards as empty rectangles, PILLARS section shows only 3 pillars, no error banner. Console clean. User has no indication anything is wrong.
**Constitutional concern**: Failure mode is invisible. Per the constitutional rule that "RLS filters, never throws" — but `NO_ACTIVE_ORG` is a 401 envelope, not a silent empty filter. The SPA should treat it as a hard error and surface it.
**Evidence**: Screenshots before vs. after the metadata patch.

---

### F-Wave9-COWORK-SMOKE-04

**Severity**: P3
**Phase**: Plan F1, F2, Phase 4
**Surface**: Smoke plan documentation vs. shipped chassis
**Steps to reproduce**: Walk the plan top to bottom comparing URLs and state names against the running SPA.

**Plan-vs-chassis drifts (compile, not regressions):**
- Plan F1 uses `provision_organization(slug, display_name, plan_code, user_uuid)` with a `plan_code` argument. Actual signature: `provision_organization(p_slug text, p_display_name text, p_owner_user_id uuid, p_owner_email text)`. No `plan_code` parameter; an `owner_email` parameter exists instead.
- Plan Phase 3.1 says items live at `/sales/items`. Actual: `/3pl-operations/items`.
- Plan Phase 4.1 says quotes live at `/sales/quotes`. Actual: `/3pl-operations/quotes`.
- Plan Phase 4.2 lists quote states as `draft → submitted → approved → sent → converted`. Actual stepper labels: `DRAFT → SENT FOR APPROVAL → APPROVED → PROJECT PENDING` (4 states; the DB stores them as `draft → submitted → approved → project_pending`, so the UI label "Sent for approval" maps to DB state `submitted`).
- Plan Phase 4.7 lists project states as `planning → started → completed`. Actual: `PENDING → READY TO BUILD → IN PRODUCTION → READY TO SHIP → COMPLETED` (5 states).
- Plan Phase 4.8 says invoice numbering format is `INV-YYYY-NNNNN`. Confirmed in chassis: `INV-2026-00001`.
- Plan Phase 4.5 says project numbering format is `PRJ-YYYY-...`. Actual: `PRJ-20260527-94E22A22` (date-stamped + quote-id suffix; not zero-padded counter).
- Plan Phase 4.11 says payment method dropdown lists `check / ach / wire / credit_card`. Actual options: `Unspecified, ACH, Wire, Check, Card, Cash, Other`.

**Recommendation**: Update plan `2026-05-27-org-owner-e2e-cowork.md` with the actual routes/states/signatures, since the plan is the contract for future smoke runs and drift here costs an agent ~30 minutes to discover.

---

### F-Wave9-COWORK-SMOKE-05

**Severity**: P1
**Phase**: Phase 2.1, 3.1, 4.8 (entity creates)
**Surface**: `audit_log` writes vs. constitutional rule "Auto-state-transition triggers on every entity with a state machine"
**Steps to reproduce**:
1. Walk the canonical quote-to-cash chain: create customer → create item → create quote → add quote line → approve quote → convert → walk project → create invoice → send → receive payment.
2. `select entity_type, action, from_state, to_state, triggered_at from audit_log where org_id = '<test-org>' order by triggered_at`.

**Expected** (per constitution): an `audit_log` row for every create AND every state transition. Customers have a `status` column with value `new` after create, so they're a state machine; item creates should emit `item.created` per the project_line_item precedent below.

**Actual** rows observed for the full walk (12 total):
- 2 provisioning rows (org status_change + membership invited)
- 4 quote state_change rows (draft → submitted → approved → project_pending)
- 1 project_line_item insert row (good — this proves the pattern exists)
- 4 project state_change rows (pending → ready_to_build → in_production → ready_to_ship → completed)
- 2 invoice status_change rows (draft → sent, sent → paid)

**Missing**: no row for `customer.created`, no row for `item.created`, no row for `quote.created`, no row for `project.created`, no row for `invoice.created`. The "create" side of every state machine entity is uninstrumented; only transitions and one line-item insert fire.

**Constitutional concern**: Direct violation of "Audit log… auto-state-transition triggers on every entity with a state machine". `customers.status = 'new'` after create IS a transition (null → new). Same for quote draft, project pending, invoice draft. A motivated auditor reconstructing the org's history from `audit_log` would have no record of who created the customer, when, or with what data.

**Evidence**: Raw SQL output of `audit_log` for org `05cb1eac-dd7e-4393-b4a4-d4a0dd2aba8c` saved in the SQL session above.

---

### F-Wave9-COWORK-SMOKE-06

**Severity**: P1
**Phase**: Phase 10.3 (feature flags) + ad-hoc plugin gate probe
**Surface**: Plugin bundle gates on SPA routes
**Steps to reproduce**:
1. Provision a fresh org. `plugins.three_pl = false`, `plugins.manufacturing = false`, `plugins.kitcost = false` (all default-off per migration 0064 seed).
2. As that org's `org_owner`, navigate directly to `/3pl-operations/quotes/new`, `/3pl-operations/items`, `/3pl-operations/projects/<id>`, `/invoicing/invoices/<id>`.
3. Walk the entire quote-to-cash chain.

**Expected** (per constitution: "Plugin bundle gates return 404"):
- SPA hides routes under `/3pl-operations/*` and 404s on direct navigation.
- API endpoints under `crm-api`, `invoicing-api`, etc. return 404 for tenant-scoped reads when the gate is off.

**Actual**:
- All `/3pl-operations/*` routes load and function fully with `plugins.three_pl=false`. I created a customer, item, quote, project, invoice, and received payment — every CTA worked, no 404 anywhere.
- `/manufacturing/runs` is a partial gate: the page shell renders, but the list query returns `NOT_FOUND` inline (and the `ADD MANUFACTURING RUN` button still renders below the inline error). Half-gated.
- `/kitcost/dashboard` correctly gated: enabling `plugins.kitcost` makes the route work; before enabling, the route does not surface in the sidebar (toggle observed live in this walk).

**Constitutional concern**: Plugin bundle gating is the chassis's main "tenant didn't pay for this plugin" enforcement. Today it appears partially wired (kitcost honoured, manufacturing half-honoured, three_pl ignored). A tenant on a sub-plan can use the entire 3PL pillar without entitlement.

**Evidence**: `select flag_key, is_enabled from org_feature_flags where org_id = '05cb1eac-...'` showed all five plugin flags off after provisioning; the entire quote-to-cash chain (12 audit rows) executed under that state.

---

### F-Wave9-COWORK-SMOKE-07

**Severity**: P2
**Phase**: Phase 4.9
**Surface**: Invoice send button + state-machine stepper render
**Steps to reproduce**:
1. From a `draft` invoice, click "Send".
2. Observe the stepper.

**Expected**: state moves draft → pending (one step), and "PENDING" lights up. Send action is gated behind a confirmation that captures recipient email or surfaces "no email set on customer".
**Actual**: One click moves the invoice DB state from `draft` directly to `sent` (skipping `pending`), and the stepper renders BOTH `PENDING` and `SENT` filled. Send does not prompt for recipient email; appears to no-op the recipient and just transition the state. If the customer has no email, the user has no opportunity to discover that on the action.
**Constitutional concern**: UX/DB drift. The stepper is presenting a state (PENDING visited) that never occurred in the audit_log. Auditors reading the stepper will assume the invoice transitioned through PENDING; audit_log will disagree.
**Evidence**: Audit_log rows show only `draft → sent` for the test invoice; UI shows PENDING filled in the same render.

---

### F-Wave9-COWORK-SMOKE-08

**Severity**: P3
**Phase**: Phase 10.1
**Surface**: `/admin/members` Team list "Name" column
**Steps to reproduce**: Land on `/admin/members`. Observe the "Name" column for the current user row.
**Expected**: User's display_name (e.g. their first+last name) or email.
**Actual**: User row's "Name" cell shows the ORG's display name (`Cowork Smoke Test Co.`), not the user's name. This is because `provision_organization()` writes the user's `profiles.display_name = <org display_name>` instead of leaving it null or using the email local-part.
**Constitutional concern**: None directly, but degrades the members admin once an org has multiple humans (every owner would show the org name).
**Evidence**: Screenshot of `/admin/members`.

---

### F-Wave9-COWORK-SMOKE-09

**Severity**: P3
**Phase**: Phase 1.1 (dashboard)
**Surface**: `/dashboard` PILLARS card row
**Steps to reproduce**: Land on dashboard as a fresh org_owner with default-off plugin flags.
**Expected**: PILLARS row reflects which pillars are entitled, or shows all 5 pillars per the constitution.
**Actual**: PILLARS row hard-renders 3 cards (3PL Operations, Manufacturing, KitCost) regardless of which flags are on. KitForce and Co-Pack and Ecom pillars never appear, even though they're in the constitution's declared five pillars and have plugin flags defined (`plugins.kitforce`, `plugins.copack_ecom`). And the cards render even when their plugin flag is OFF.
**Constitutional concern**: Constitutional pillar list (`3PL Operations, Manufacturing, Co-Pack and Ecom, KitForce, KitCost`) is the canonical product narrative. Dashboard contradicts it in two ways: (1) shows only 3, (2) shows them irrespective of entitlement.
**Evidence**: Screenshot.

---

## Constitutional checks summary

| Check | Result |
|---|---|
| Audit chain integrity (12 rows: 12 hashed, 11 chained) | GREEN |
| Cross-tenant RLS: GET another org's customer with our token | GREEN (404 NOT_FOUND) |
| Numbering chassis on quote (`Q-YYYY-NNNNN`), invoice (`INV-YYYY-NNNNN`) | GREEN |
| Money inputs use DollarInput (entered `25.00`, displayed `$25.00`, stored as cents) | GREEN |
| State machine transitions write audit_log (10 of 10 transitions captured) | GREEN |
| Entity creates write audit_log | RED — see F-05 |
| Plugin bundle gates return 404 when off | PARTIAL — see F-06 |
| Setup checklist auto-updates as steps complete | GREEN (1→6 of 8) |
| Provisioning chassis (`provision_organization`) works end-to-end | RED — see F-02 |

## Phase coverage

| Phase | Status |
|---|---|
| Pre-flight | done |
| 1 Auth + onboarding | done |
| 2 CRM (customer) | done (lead/opportunity deferred) |
| 3 Sales config (items) | done (currencies/taxes/VAS deferred) |
| 4 Quote-to-cash | done end-to-end |
| 5 3PL Ops | partial — exercised via project workflow only |
| 6 Vendors | not exercised |
| 7 Manufacturing | not exercised (gated route probe only) |
| 8 BOM | not exercised |
| 9 KitCost dashboard | done (flag toggle + KPI math verified) |
| 10 Admin | done (members read + flags toggle; branding/settings not exercised) |
| 11 Collaboration | not exercised |
| 12 Constitutional checks | audit chain + RLS done; idempotency + cap-gate not exercised |
| 13 Brand discipline scan | not run (no em-dash / double-hyphen / emoji surfaced incidentally on the walked surfaces) |

## Severity tally

`2 P1, 4 P2 (counting SMOKE-03 + SMOKE-07 + the half of SMOKE-04 that's substantive + SMOKE-08), 4 P3`
Effective punch list count: `2 P1, 3 P2, 4 P3`.

P1 items to escalate first:
1. `F-Wave9-COWORK-SMOKE-02` — `provision_organization` does not set auth metadata
2. `F-Wave9-COWORK-SMOKE-05` — entity creates not audited
3. `F-Wave9-COWORK-SMOKE-06` — plugin bundle gates partially wired

## Teardown notes

Test org `05cb1eac-dd7e-4393-b4a4-d4a0dd2aba8c` and test user `82b8bed8-6b2d-4f59-a9ae-2c43bd773066` left in place for inspection. Run the SQL block at the end of this journal to cascade-delete when ready.

```sql
-- Cleanup (manual)
delete from organizations where id = '05cb1eac-dd7e-4393-b4a4-d4a0dd2aba8c';
delete from auth.users where id = '82b8bed8-6b2d-4f59-a9ae-2c43bd773066';
```
