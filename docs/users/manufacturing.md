# Manufacturing

Kitstak's second add-on. Manufacturing tracks a production run from draft to completion and records what it consumes and what it produces.

Manufacturing is a paid add-on gated by the `plugins.manufacturing` feature flag, which defaults off. Until an org admin enables it from `/admin/flags`, the manufacturing surface renders empty and the manufacturing-api returns 404 on every route.

## Manufacturing runs

A manufacturing run is one batch of work. Create a run, list the inputs it draws down, list the outputs it yields, then walk it through its lifecycle.

The run lifecycle has four states: draft, started, completed, cancelled. Completed is the end of the line; a completed run cannot move again or be deleted.

1. Click New Run, then set an optional warehouse, an optional source project, and the planned start and complete times.
2. While the run is in draft, add consumed lines for the items it will use and produced lines for the items it will make. Each consumed line points at a catalog item. A produced line can point at a catalog item or simply name an output you do not yet stock.
3. Start moves the run into production.
4. Complete closes the run. If the run has a warehouse, completing it posts the stock movements automatically: the consumed items come off hand and the produced items go on hand, all in one step. A run with no warehouse is an admin-only run; completing it records the work without touching stock.
5. Cancel is reachable from draft or started. A cancelled run posts no stock.

You can only edit a run's header or its lines while it is in draft. Once it has started, the run is locked so the stock math stays honest.

## Consumed and produced lines

Consumed lines are what the run uses up. Produced lines are what it makes. Both are ordered, and Kitstak assigns the next position automatically when you add a line. Line costs are stored as integer cents, so there is no floating-point drift.

## Money handling

Every monetary value is stored as integer cents (BIGINT in Postgres). Line costs never use floating point.

## Audit

Every run state transition writes a row to `audit_log`. When a completed run with a warehouse posts its stock movements, those movements land on the append-only stock ledger that the rest of Kitstak reads from, so your warehouse on-hand stays consistent across the spine.
