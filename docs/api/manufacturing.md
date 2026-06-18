# Manufacturing API

One edge function bundle covers the Manufacturing add-on.

## manufacturing-api

The Manufacturing add-on HTTP surface. Every non-GET requires `Idempotency-Key` (UUID v4) and an active org claim.

### Plugin gate

The whole bundle is gated by `plugins.manufacturing`. When the flag is off the bundle returns `404 NOT_FOUND` on every path, including unknown paths, so a disabled add-on leaks no surface. Manufacturing is a paid add-on; lighting the flag requires an active subscription.

### manufacturing_runs

A manufacturing run is the unit of work. It carries an optional warehouse, an optional source project, planned start and complete timestamps, and two child line tables (consumed and produced).

#### CRUD

- `GET /manufacturing-api/manufacturing-runs` lists runs. RLS-only, filterable by `status`, `warehouse_id`, and `project_id`.
- `POST /manufacturing-api/manufacturing-runs` creates a run in `draft`. `requireCap("manufacturing.run.create")`.
- `GET /manufacturing-api/manufacturing-runs/:id` reads one run. RLS-only.
- `PATCH /manufacturing-api/manufacturing-runs/:id` updates header fields. Allowed only while the run is `draft`. `requireCap("manufacturing.run.update")`.
- `DELETE /manufacturing-api/manufacturing-runs/:id` soft-deletes. A `completed` run refuses deletion with `409 STATE_CONFLICT`. `requireCap("manufacturing.run.delete")`.

#### State transitions

The run FSM is declared in `_shared/workflow.ts` and mirrored in the SPA. States: `draft`, `started`, `completed`, `cancelled`. `completed` is terminal. Illegal transitions return `409 STATE_CONFLICT` before the DB call.

- `POST /manufacturing-api/manufacturing-runs/:id/start` moves `draft` to `started`. `requireCap("manufacturing.run.start")`.
- `POST /manufacturing-api/manufacturing-runs/:id/complete` moves `started` to `completed`. `requireCap("manufacturing.run.complete")`. When the run has a `warehouse_id`, the DB trigger `tg_manufacturing_runs_emit_movements` writes the consumed and produced `stock_movements` on completion. A run with a null `warehouse_id` is an admin-only run and the trigger early-returns, so no stock moves.
- `POST /manufacturing-api/manufacturing-runs/:id/cancel` moves `draft` or `started` to `cancelled`. `requireCap("manufacturing.run.cancel")`.

#### Consumed lines

Inputs the run draws down. `item_id` is required.

- `GET /manufacturing-api/manufacturing-runs/:id/consumed` lists consumed lines ordered by position. RLS-only.
- `POST /manufacturing-api/manufacturing-runs/:id/consumed` adds a line. Server auto-assigns position when omitted. `requireCap("manufacturing.run.line_item.create")`.
- `PATCH /manufacturing-api/manufacturing-runs/:id/consumed/:lineId` updates a line. `requireCap("manufacturing.run.line_item.update")`.
- `DELETE /manufacturing-api/manufacturing-runs/:id/consumed/:lineId` removes a line. `requireCap("manufacturing.run.line_item.delete")`.

#### Produced lines

Outputs the run yields. `item_id` is nullable so a run can record an output that is not yet a catalog item.

- `GET /manufacturing-api/manufacturing-runs/:id/produced` lists produced lines ordered by position. RLS-only.
- `POST /manufacturing-api/manufacturing-runs/:id/produced` adds a line. `requireCap("manufacturing.run.line_item.create")`.
- `PATCH /manufacturing-api/manufacturing-runs/:id/produced/:lineId` updates a line. `requireCap("manufacturing.run.line_item.update")`.
- `DELETE /manufacturing-api/manufacturing-runs/:id/produced/:lineId` removes a line. `requireCap("manufacturing.run.line_item.delete")`.

Line money is BIGINT cents (`unit_cost_cents`).

## Error envelope

Every error response is `{ "error": { "code", "message", "details" } }` with an `x-request-id` header. Codes the bundle emits:

- `UNAUTHORIZED` (401) Authorization missing.
- `NO_ACTIVE_ORG` (401) Token has no org claim.
- `FORBIDDEN` (403) Capability denied.
- `NOT_FOUND` (404) Row not in caller's org, or the add-on is gated off.
- `STATE_CONFLICT` (409) Illegal transition, or a write against a non-draft run.
- `IDEMPOTENCY_CONFLICT` (409) Same key, different body.
- `VALIDATION_ERROR` (422) Body failed Zod.
