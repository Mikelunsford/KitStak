# Co-Pack and KitForce Marquee Smoke Closeout. 2026-06-01

**Plan**: `03-workspace/smoke-plans/2026-06-01-copack-kitforce-smoke.md`
**Executor**: Claude (Cowork mode), browser automation plus Supabase MCP, autonomous
**Target env**: prod `https://www.kitstak.com` against Supabase `zmnvwhqjahwidprnjxrq`
**Test user**: `cksmoke20260531@kitstak.test` (org_owner)
**Test org**: Co-Pack KitForce Smoke Co. `d15ea6b4-154f-4c41-8412-e6fdeab5546d`
**Plugins**: `plugins.copack_ecom` ON, `plugins.kitforce` ON. Inventory and 3PL OFF.
**Browser timezone during run**: America/Chicago (UTC-5).

## TL;DR

| Check | Result |
|---|---|
| Marquee 1. fulfillment ship advances order to shipped | PASS |
| Marquee 2. kitting complete emits stock movements | FAIL (conditional). Trigger logic verified correct with a warehouse. Completion silently emits nothing without one, and a Co-Pack-only org cannot assign a warehouse. See F-04. |
| Cost fix. clock-in rate non-zero | PASS |
| P0 audit constraint. no 500 on any Co-Pack or kitting write | PASS. Every write returned 200 or 201. Final violation sweep returned 0. |
| Brand sweep. no raw enum, ISO, or UUID leaks | FAIL on list surfaces. Detail views are clean and humanized. See F-02, F-03. |

Headline: the #180 P0 fix holds. Pick, pack, ship, cancel on fulfillments and add-consumed, add-produced, start, complete, cancel on kitting all succeed with no 500. The one material gap is inventory. a Co-Pack-only org cannot reach a warehouse, so kitting completion records no stock movements and does so silently.

## Pre-flight

F3 constraint check. all four restored entity types present in `audit_log_entity_type_check`. `has_fulfillment`, `has_kitting_job`, `has_kjc`, `has_kjp` all true. The #180 P0 fix is live.

Setup deviations made by the executor (test scaffolding, not product behavior):
- Seeded two catalog items via SQL because the items surface is 3PL-gated and 404s with the 3PL plugin off. `SMOKE-COMP-1 Component One` and `SMOKE-KIT-1 Finished Kit One`.
- Injected `warehouse_id` on `KIT-2026-00002` via SQL to prove the stock-movement trigger, because the warehouse picker cannot be populated through the UI (see F-04).

## Constitutional invariants verified

- Money in cents. Order line 250 renders $2.50, 500 renders $5.00, 100 renders $1.00. Member rate $24.50 stored as 2450 cents. Time entry `hourly_rate_cents` 2450 equals `default_hourly_rate_cents` 2450.
- RLS Pattern B. cross-tenant single GET returns 404, cross-tenant POST returns 404. Never 403, never the other tenant row. See Phase D.
- Audit log append-only and chained. fulfillment, sales_order, kitting_job, kitting_job_consumed_line_item, kitting_job_produced_line_item rows all carry prev_hash and payload_hash. Final constraint violation sweep returned 0.
- Plugin bundle gates. inventory-api and the 3PL items surface return 404 with the plugin off. Correct gating, but it strands Co-Pack. See F-04.

## Phase results

**Phase A. KitForce**
- A1 Members. PASS. `EMP-2026-00001`, rate shows $24.50/hr in dollars, deactivate and reactivate both write humanized HISTORY rows, status filter All, Active, Inactive works, `/members/{id}/edit` 404s as the known deferral.
- A2 Teams. PASS. create-audit HISTORY reads Created not insert, add and remove member persist and re-render without reload, remove fires a confirm with clean copy.
- A3 Shifts. PASS on lifecycle. scheduled to started to completed, all detail timestamps correct local time, cancel fires a confirm and reaches terminal. Finding F-02 on the list view.
- A4 Work assignments. PASS. `WA-2026-00001`, member picker sits next to Assign (the #180 fix), assigned to in_progress to done all humanized, empty-assign is prevented by a disabled button, cancel fires a confirm.
- A5 Time entries. PASS (marquee labor cost). blank rate override snapshots $24.50/hr not $0.00, minutes render as 1.3 not a raw float (DB stores 1.2688), out-before-in returns backend 409 and shows an inline error. Finding F-03 on the error copy.

**Phase B. Co-Pack and Ecom**
- B1 Channels. PASS. Shopify, Amazon, Manual, Other all render as labels not raw enums, inactive then active toggle persists across reload.
- B2 Sales orders. PASS. `SO-2026-00001`, cents-in dollars-out on two lines, line delete fires a destructive confirm and re-renders, confirm dialog warns lines lock, post-confirm editing is blocked.
- B3 Fulfillments. PASS (marquee 1). `FUL-2026-00001`, SO reference renders `SO-2026-00001` not a UUID, pick and pack and ship all succeed with no 500, ship fires a confirm, the parent order auto-advanced to shipped (`order_status=shipped`, `shipped_at` stamped), audit chain complete, cancel-from-pending succeeds with no 500.
- B4 Kitting jobs. Mixed (marquee 2). `KIT-2026-00001`, SO reference renders `SO-2026-00002`, add-consumed and add-produced both POST 201 not 500, start and complete succeed with no 500, cancel-from-draft fires a confirm. Stock movements did NOT emit on the first job because it had no warehouse. With a warehouse injected on a second job, completion emitted `production_consumed` qty 2 and `production_produced` qty 1 correctly. See F-04.

**Phase C. Audit and brand sweep**
HISTORY timelines across every surface use humanized action and state labels. Status change not status_change, Created not insert, In Progress not IN_PROGRESS, X to Y transitions. Detail pages show humanized local timestamps. No 500 surfaced anywhere. Raw leaks were found only on list surfaces and one error string. See F-02 and F-03.

**Phase D. Cross-tenant probe (Pattern B)**
- GET another org sales order while authed as the smoke org. 404. UI shows Sales order not found. Lines endpoint also 404.
- POST a line to another org sales order with the smoke org session token, valid Idempotency-Key. 404 with `{"error":{"code":"NOT_FOUND"}}`.
- Throughout the run, no other-tenant data ever appeared in any list. Pattern B holds on read and write. No 403 where 404 is required.

## DB verification

- Marquee 1. `FUL-2026-00001` shipped, `SO-2026-00001` order_status shipped, shipped_at stamped. The fulfillment packed-to-shipped row and the sales_order confirmed-to-shipped row share the exact same timestamp, confirming a single-transaction cascade.
- Marquee 2. with a warehouse, `stock_movements` contains production_consumed qty 2.0 for Component One and production_produced qty 1.0 for Finished Kit One, source_entity_type kitting_job. Without a warehouse, zero rows.
- Cost. `time_entries.hourly_rate_cents` 2450 equals `default_hourly_rate_cents` 2450.
- Audit constraint. corrected violation sweep returned 0 bad rows. The plan TL;DR query returns a false 47. See F-06.

## Findings

### F-Wave10-CKSMOKE-01
- Severity: P3
- Surface: KitForce team membership writes, Co-Pack order line add. SPA list re-render after a mutation.
- Expected: the affected table re-renders promptly after a write.
- Actual: the write succeeds (201) but the list takes roughly 3 to 4 seconds to re-render, with no loading indicator during the gap. It does re-render without a manual reload, so it passes the #180 check, but the silent gap can read as a failed action.
- Repro: add a member to a team, or add a line to a draft order. Screenshot at 1 second still shows the old state. Screenshot at 4 seconds shows the new row.
- Suspected area: SPA refetch-then-render path with no pending state on the affected table.

### F-Wave10-CKSMOKE-02
- Severity: P2
- Surface: Schedule list `/kitforce/shifts`, Time entries list `/kitforce/time-entries`.
- Expected: start, end, and clock times display in local humanized time, matching the detail view.
- Actual: list rows show raw UTC in a raw ISO-like format. A 9:00 AM to 5:00 PM shift entered in local time shows 14:00 to 22:00. A clock-in at 8:20 PM local shows 2026-06-01 01:20. The detail pages for the same records render correct local humanized time (Jun 1, 2026, 9:00 AM). The #180 timezone fix reached detail views but not list views.
- Repro: create a shift 09:00 to 17:00 local. open the schedule list. compare to the shift detail page.
- Suspected area: list cell formatter prints the stored UTC timestamp directly instead of routing through the same Intl local formatter the detail view uses.

### F-Wave10-CKSMOKE-03
- Severity: P2
- Surface: Time entries clock-out validation `/kitforce/time-entries`.
- Expected: a clock-out before clock-in is rejected with operator-friendly copy and no raw field names.
- Actual: functional path is correct. backend returns 409 and the UI shows an inline error, not a silent failure, which satisfies the #180 silent-failure fix. The copy is `clock_out_at is before clock_in_at`, which leaks raw snake_case column names to the operator. Invariant 7 forbids raw field leaks.
- Repro: clock a member in with a future clock-in, then clock out. observe the red inline error text.
- Suspected area: the handler validation message is surfaced verbatim instead of mapped to a friendly string.

### F-Wave10-CKSMOKE-04
- Severity: P1
- Surface: Co-Pack fulfillment and kitting warehouse picker, kitting completion stock movements. `inventory-api/warehouses`.
- Expected: marquee 2. completing a kitting job emits stock movements. operators can assign a warehouse.
- Actual: the warehouse picker is empty on both the fulfillment and kitting forms. The form calls `GET inventory-api/warehouses` which returns 404 because the inventory and 3PL plugin is off for this org. An active default warehouse exists in the database but is unreachable through the UI. Because `stock_movements.warehouse_id` is NOT NULL, a kitting job completed with no warehouse records zero stock movements, and the UI allows completion with no warning. The marquee silently no-ops its inventory effect. The trigger itself is correct. after injecting `warehouse_id` via SQL on a second job, completion emitted the expected consume and produce movements.
- Repro: create a kitting job, observe warehouse picker shows only No warehouse, add consumed and produced lines, start, complete, then query stock_movements. zero rows. inject a warehouse_id and repeat. movements appear.
- Suspected area: Co-Pack forms depend on the 3PL-gated `inventory-api/warehouses` endpoint. either expose a Co-Pack-scoped warehouse read that is not 3PL-gated, or block kitting and fulfillment completion when warehouse is unset and surface a clear message. A minor downstream symptom: the warehouse reference renders as a UUID fragment `633a35c6…` because the name cannot be resolved through the gated endpoint.

### F-Wave10-CKSMOKE-05
- Severity: P3
- Surface: the smoke plan document, end-of-run DB verification query.
- Expected: the bad_rows query returns 0 when there are no constraint violations.
- Actual: it returns 47. The query parses the constraint with a regex that does not handle the `entity_type = ANY (ARRAY[...]::text)` form, so it builds a malformed allowed-list and counts every real row as bad. A corrected check using the literal array returns 0 violations and (none) for distinct violating types. Fix the plan query so future runs are not misled into filing a false P0.
- Repro: run the plan TL;DR bad_rows query, then run a check that compares entity_type against the actual array literal.
- Suspected area: plan documentation only. not a product defect.

## Teardown. not executed by the executor

Permanent deletes are out of scope for autonomous execution. The test org and user remain in place along with the seeded items and the SQL-injected warehouse on `KIT-2026-00002`. Operator can run the plan teardown when ready:

```sql
delete from public.organizations where id = 'd15ea6b4-154f-4c41-8412-e6fdeab5546d';
delete from auth.users where id = '3df7902a-faeb-427e-8c78-db59fa3e8f6b';
```

## Recommendation

Ship-blocker to resolve before the first external Co-Pack customer: F-04. A Co-Pack operator who runs kitting will see jobs complete with no inventory effect and no warning. Either expose a non-3PL-gated warehouse read for Co-Pack, or refuse completion without a warehouse and say why. F-02 and F-03 are fast follows on list formatting and error copy. F-01 and F-05 are polish.
