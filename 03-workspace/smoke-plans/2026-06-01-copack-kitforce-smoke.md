# Co-Pack and KitForce marquee smoke test — Kitstak

**Target executor**: Claude Cowork (or any LLM agent with browser automation + Supabase MCP + Bash)
**Target env**: prod (`https://www.kitstak.com` against Supabase `zmnvwhqjahwidprnjxrq`)
**Scope**: Pillar 3 (Co-Pack and Ecom) and Pillar 4 (KitForce) only. Excludes 3PL, Manufacturing, KitCost, customer portal, billing.
**Why now**: PR #180 (R-W10-AUDIT-01) restored the `audit_log` entity_type CHECK that 0078-0081 had subset, which had frozen fulfillment at `pending` and kitting at `draft` with HTTP 500s. Both marquee MAKE features were untestable until 2026-06-01. This run proves them end to end and regresses every P1/P2 fix from #180.
**Duration estimate**: 60 minutes if green; 90+ with findings.
**Tester role**: `org_owner` of a freshly-provisioned test org (NOT the operator's live Kitstak org).

---

## Mission

Walk every Co-Pack and KitForce surface end to end and confirm:

1. The two marquee paths work: **fulfillment ship advances the parent sales order to shipped**, and **kitting completion emits stock movements**.
2. Every Co-Pack/KitForce write that emits an audit row succeeds (no `audit_log_entity_type_check` 500). This is the P0 that #180 fixed; it is the single most important regression check.
3. The labor-cost path is correct: a clock-in with no rate override snapshots the member's real rate, not $0.
4. The P1/P2 polish from #180 holds: no silent failures, no raw enum/ISO/UUID leaks, delete confirms present.

Report findings as `F-Wave10-CKSMOKE-<NN>`. Severities:
- **P0**: cross-tenant RLS bleed, data loss, security violation, constitutional gate broken, or any 500 on a normal write.
- **P1**: functional regression that blocks a normal operator flow.
- **P2**: UX gap, copy violation, missing feedback.
- **P3**: polish suggestion.

---

## Constitutional invariants to verify continuously

1. **Money in cents**: BIGINT cents stored, never float. Sales-order line "unit price (whole cents, 250 = $2.50)" expects raw cents. Time-entry rate override is a dollars input.
2. **RLS Pattern A** (`org_id = current_org_id()`): cross-tenant READ returns 200 + empty array; cross-tenant WRITE returns 404 (not 403).
3. **Idempotency-Key** required on every non-GET handler; body-hash mismatch returns 409.
4. **Audit log append-only**: every state transition writes an `audit_log` row with a valid hash-chain link. No write that emits an audit row may 500.
5. **Capability gates**: a role without the cap gets 403 FORBIDDEN.
6. **Plugin bundle gates**: with the pillar plugin flag OFF, the pillar surface must 404 (not 403). With it ON, the surface works.
7. **Brand discipline**: no em-dashes, double hyphens, or emojis in UI copy; no raw enum / ISO timestamp / UUID leaks to the operator.

---

## Pre-flight

### F1. Provision a fresh test org
Do NOT use the operator's live org. Mint a fresh `auth.users` row via service role (`auth.admin.createUser`), then provision:

```sql
-- provision_organization(p_slug, p_display_name, p_owner_user_id, p_owner_email)
-- See migrations 0064 + 0069. No plan_code param. 0069 stamps kitstak_org_id +
-- kitstak_org_role on the owner's auth.users.raw_app_meta_data.
select provision_organization(
  'ck_smoke_YYYYMMDD_HHmm',
  'Co-Pack KitForce Smoke Co.',
  '<fresh-test-user-uuid>',
  'cksmoke+YYYYMMDD@kitstak.test'
);
```

### F2. Enable the two pillar plugins (these are gated OFF by default)
Both pillars are bundle-gated. Without the flags ON, every `/copack/*` and `/kitforce/*` route must 404 (verify that first as the plugin-gate check), then enable:

```sql
-- Flip plugins.copack_ecom and plugins.kitforce ON for the test org.
-- Confirm the exact flag storage shape against org_feature_flags / feature_flags
-- for this org before updating (key path is plugins.copack_ecom / plugins.kitforce).
-- After enabling, /copack/orders and /kitforce/members must load.
```

Record: with the flags OFF, did `/copack/orders` and `/kitforce/members` return 404 (correct) or render (P0 SMOKE-06-class gate leak)?

### F3. Confirm the P0 fix is live on this DB (the whole point of this run)
```sql
select
  (pg_get_constraintdef(oid) like '%''fulfillment''%')                       as has_fulfillment,
  (pg_get_constraintdef(oid) like '%''kitting_job''%')                       as has_kitting_job,
  (pg_get_constraintdef(oid) like '%''kitting_job_consumed_line_item''%')    as has_kjc,
  (pg_get_constraintdef(oid) like '%''kitting_job_produced_line_item''%')    as has_kjp
from pg_constraint
where conrelid = 'public.audit_log'::regclass
  and conname = 'audit_log_entity_type_check';
```
All four must be `true`. If any is `false`, STOP and file P0 — 0083 did not reach this DB.

### F4. Dashboards to keep open
| Purpose | URL |
|---|---|
| Supabase prod SQL editor | https://supabase.com/dashboard/project/zmnvwhqjahwidprnjxrq/sql/new |
| Supabase prod Edge logs | https://supabase.com/dashboard/project/zmnvwhqjahwidprnjxrq/logs/edge-functions |
| Vercel runtime logs | https://vercel.com/mikes-projects-5e3ecc74/kitstak/logs |
| Sentry issues | https://kitstak.sentry.io/issues/?project=4511423235751936 |

Keep the browser console open the whole walk. Any uncaught error or red on-screen text is a finding.

---

## Phase A: KitForce (Pillar 4)

### A1. Members (`/kitforce/members`)
1. Create a member via `/kitforce/members/new` with a non-zero hourly rate (e.g. $24.50/hr). Expect `EMP-2026-NNNNN`, status ACTIVE.
2. Open the member detail. Confirm rate displays as **$24.50/hr** (dollars, not cents) for the org_owner.
3. Deactivate, then reactivate. Confirm HISTORY shows both transitions and the status filter (All/Active/Inactive) works.
4. **Known deferred** (`F-Wave10-SMOKE-MEMBER-EDIT-01`): no edit control; `/members/{id}/edit` 404s. Note only, do not file new.

### A2. Teams (`/kitforce/teams`)
1. Create a team. Confirm it lists, Active: Yes, and the create-audit HISTORY row reads **"Created"** (not raw `insert`).
2. Add a member, then remove one. Confirm both **persist AND the table re-renders without a manual reload** (the #180 stale-UI check). Remove fires a confirm with clear copy.

### A3. Shifts (`/kitforce/shifts`)
1. Create a shift for the member, scheduled 09:00 to 17:00 local.
2. Confirm Scheduled start/end and all event timestamps display in **local time** (e.g. 9:00 AM, not a raw ISO string or a +5h UTC shift). This is the #180 timezone fix.
3. Walk scheduled to started to completed. Confirm the status badge reads humanized copy (e.g. "Started", never `IN_PROGRESS`-style raw enums) and HISTORY advances each step with humanized action + state labels.
4. Cancel a separate scheduled shift; confirm terminal, confirm dialog fires.
5. **Known deferred**: no shift `SHF-` number shown, no edit affordance. Note only.

### A4. Work assignments (`/kitforce/assignments`)
1. Create an assignment **Unassigned** (no member at creation). Expect `WA-2026-NNNNN`, status open.
2. On the detail page, confirm a **member picker appears next to the Assign button** (the #180 fix). Select the member and Assign. Confirm it advances to assigned and the audit row writes. (Before #180 this was impossible from the detail page.)
3. Walk assigned to in_progress to done. Confirm the in-progress badge is humanized ("In progress"), not `IN_PROGRESS`.
4. Create a second assignment, click Assign with no member selected (if reachable): confirm the error reads **"Select a member to assign this work assignment."** (no raw `member_id`/`work_assignment`).
5. Cancel path on a non-terminal assignment; confirm dialog + terminal.

### A5. Time entries (`/kitforce/time-entries`) — MARQUEE: labor cost
1. Clock a member in with the rate-override field **left blank**. After it saves, confirm the **Rate column shows the member's real rate (e.g. $24.50/hr), NOT $0.00**. This is the #180 cost fix; a $0 here is a P1 regression.
2. Clock the same entry out after ~30 seconds. Confirm Minutes renders a **rounded one-decimal value** (e.g. 0.5), not a raw 4-decimal float (0.5667).
3. **Negative test**: clock another member in, then clock out with an out-time BEFORE the in-time (use the API or a crafted request). Confirm the backend returns 409 STATE_CONFLICT AND **the UI shows the error inline** (not a silent no-op). This is the #180 silent-failure fix.
4. DB check: confirm the clocked-in row carries a non-zero `hourly_rate_cents` snapshot equal to the member default.

```sql
select te.id, te.minutes, te.hourly_rate_cents, m.default_hourly_rate_cents
from time_entries te join workforce_members m on m.id = te.member_id
where te.org_id = '<test-org-id>' order by te.created_at desc limit 5;
-- hourly_rate_cents must equal default_hourly_rate_cents when no override was given (e.g. 2450), never 0.
```

---

## Phase B: Co-Pack and Ecom (Pillar 3)

### B1. Channels (`/copack/channels`)
1. Create a channel of kind Shopify. Confirm the Kind column renders **"Shopify"** (label), not raw uppercase `SHOPIFY`. Create one of each kind (Manual, Amazon, Other) to confirm the label map.
2. Toggle a channel inactive then active. Confirm it persists.

### B2. Sales orders (`/copack/orders`)
1. Create an order tied to a channel + customer. Expect `SO-2026-00001`.
2. Add two lines. Confirm cents-in/dollars-out: entering 250 renders **$2.50**, 500 renders $5.00.
3. **Line delete now confirms**: click Remove on a line and confirm a destructive-confirm dialog fires before the delete (the #180 consistency fix). Confirm the table re-renders without reload.
4. Confirm the draft (dialog: lines lock), POST 200, badge humanized to "Confirmed", HISTORY row "Draft to Confirmed".
5. Confirm post-confirm editing is blocked (Add-line form and Remove gone; only Cancel remains).
6. Keep this confirmed order for the fulfillment phase.

### B3. Fulfillments (`/copack/fulfillments`) — MARQUEE 1: ship advances the order
1. Create a fulfillment against the confirmed order from B2. Expect `FUL-2026-00001`; only confirmed orders are selectable; pick a warehouse.
2. Confirm the **Sales order reference shows `SO-2026-00001`, not a UUID fragment** (the #180 EntityLabel fix).
3. **Pick** (pending to picking): must return 200, NOT a 500. HISTORY writes a humanized "Status change" row. This is the exact write that 500'd before #180.
4. **Pack** (picking to packed): 200.
5. **Ship** (packed to shipped): 200, confirm dialog fires first. Then verify the **parent sales order auto-advanced to `shipped`** (the marquee trigger):

```sql
select f.fulfillment_number, f.status as ful_status, so.order_number, so.status as order_status, so.shipped_at
from fulfillments f join sales_orders so on so.id = f.sales_order_id
where f.org_id = '<test-org-id>' order by f.created_at desc limit 3;
-- After ship: ful_status = shipped, order_status = shipped, shipped_at stamped.
```

6. Audit chain: confirm `audit_log` has `fulfillment` rows for each transition and the parent `sales_order` shipped row, all chained.

```sql
select entity_type, from_state, to_state, action, triggered_at
from audit_log where org_id = '<test-org-id>' and entity_type in ('fulfillment','sales_order')
order by triggered_at desc limit 10;
```

7. Cancel path: on a separate confirmed order, create a fulfillment and Cancel it from `pending`. Must return 200 (this also 500'd before #180), confirm dialog fires.

### B4. Kitting jobs (`/copack/kitting`) — MARQUEE 2: completion emits stock movements
1. Create a kitting job. Expect `KIT-2026-00001`, draft, warehouse MAIN. Confirm the Sales order reference (if linked) renders the SO number.
2. **Add a consumed component** (item + qty + unit cost cents). Must return 200, NOT a 500 (this 500'd before #180). Confirm the line table refreshes; Remove now fires a confirm.
3. Add a produced kit line.
4. **Start** (draft to started): must return 200, NOT a 500. This is the exact write that froze kitting at draft before #180.
5. **Complete** (started to completed): 200, confirm dialog. Then verify **stock movements were emitted** for the consumed and produced lines:

```sql
select sm.movement_type, sm.quantity, sm.item_id, sm.created_at
from stock_movements sm
where sm.org_id = '<test-org-id>'
  and sm.created_at > now() - interval '15 minutes'
order by sm.created_at desc;
-- Expect consume movements for consumed components and produce movements for produced kits.
```

6. Audit chain: confirm `kitting_job`, `kitting_job_consumed_line_item`, and `kitting_job_produced_line_item` rows exist in `audit_log` and chain correctly.
7. Cancel path on a separate draft/started job; 200 + confirm dialog.

---

## Phase C: Audit + brand regression sweep

Across every HISTORY timeline touched above, confirm:
- Action labels are humanized: **"Status change"** not `status_change`, **"Created"** not `insert`, **"Invited"** not `invited`.
- State labels are humanized through the from/to copy.
- No raw ISO timestamps render anywhere on detail pages (event times read as local date + time).
- No UUID fragment renders where an entity number should (orders, fulfillments).
- No raw DB error text ever surfaces to the operator (if any 500 occurs, the message is friendly, and you file the 500 itself as P0/P1).

---

## Phase D: Cross-tenant probe (Pattern B)

With a second test org's `org_id`, attempt:
1. `GET` a fulfillment / kitting job / sales order belonging to org A while authenticated as org B. Expect 404 NOT_FOUND (or 200 + empty on a list), never a 200 with the other org's row, never a 403.
2. `POST` a transition (e.g. pick) against org A's fulfillment id while authed as org B. Expect 404. A 403 where 404 is expected is a P0 release blocker per the constitution.

---

## DB verification summary (run at the end)
```sql
-- 1. No audit row in this org violates the restored constraint (sanity on the P0 fix).
select count(*) as bad_rows from audit_log
where org_id = '<test-org-id>' and entity_type not in (
  select trim(both '''' from unnest(string_to_array(
    substring(pg_get_constraintdef(oid) from '\((.*)\)'), ',')))
  from pg_constraint where conrelid='public.audit_log'::regclass and conname='audit_log_entity_type_check'
);
-- expect 0

-- 2. Fulfillment ship advanced the order (Marquee 1). See B3 query.
-- 3. Kitting completion emitted movements (Marquee 2). See B4 query.
-- 4. Time-entry rate snapshot is non-zero (cost fix). See A5 query.
```

---

## Findings template

For each finding:

```
### F-Wave10-CKSMOKE-<NN>
- Severity: P0 | P1 | P2 | P3
- Surface: <route or API path>
- Expected: <what should happen>
- Actual: <what happened, with exact on-screen / console / HTTP text>
- Repro: <numbered steps>
- Suspected area: <SPA page | edge handler | migration/trigger | RLS>
```

### TL;DR block (fill at the end)
- Marquee 1 (fulfillment ship -> order shipped): PASS / FAIL
- Marquee 2 (kitting complete -> stock movements): PASS / FAIL
- Cost fix (clock-in rate non-zero): PASS / FAIL
- P0 audit constraint (no 500 on any Co-Pack/kitting write): PASS / FAIL
- Brand sweep (no raw enums/ISO/UUID leaks): PASS / FAIL

---

## Teardown
Cascade-delete the test org(s) after the walk:
```sql
delete from organizations where id = '<test-org-id>';  -- cascades to all child rows
```
Leave the org in place ONLY if a finding needs inspection; record the org_id + user_id in the findings doc if so.
