# three-pl-api

Bundle for the 3PL commercial and operational planning layer (Wave 12): Accounts, Job Builders, and Supply Plans. Plugin-gated on `plugins.three_pl`; a gate miss returns `404 NOT_FOUND` on every route. Every non-GET handler enforces the `Idempotency-Key` header and `requireCap` before any DB write; the server is authority. Cross-tenant or soft-deleted parents resolve to `404 NOT_FOUND`. Document numbers come from the org-scoped numbering chassis (`nextDocNumber`).

## Accounts (Phase A1)

`three_pl_accounts` is the service-relationship layer over a CRM customer (status active / inactive flag, not a rich FSM); `account_service_definitions` is the per-account Rate Card overlay. `account_number` prefix ACC-.

- `GET /three-pl-api/accounts?status=` cap `threepl.account.create` is not required for read (RLS-scoped)
- `POST /three-pl-api/accounts` cap `threepl.account.create`
- `GET /three-pl-api/accounts/:id`
- `PATCH /three-pl-api/accounts/:id` cap `threepl.account.update`
- `DELETE /three-pl-api/accounts/:id` cap `threepl.account.update` (soft-delete)
- `POST /three-pl-api/accounts/:id/deactivate` and `/reactivate` cap `threepl.account.deactivate`
- `GET /three-pl-api/accounts/:id/services`
- `POST /three-pl-api/accounts/:id/services` cap `threepl.account.service_definition.create`
- `PATCH /three-pl-api/accounts/:id/services/:sid` cap `threepl.account.service_definition.update`
- `DELETE /three-pl-api/accounts/:id/services/:sid` cap `threepl.account.service_definition.delete`

## Job Builders (Phase A2)

`job_templates` is the reusable job engine (variant kit / sidekick / repack / labeling / inspection / custom; status active / inactive flag). `job_template_lines` are the builder definition: component (`item_id`), service (`vas_id`), and step lines. `default_bom_item_id` references `items(id)` (BOMs are item-keyed, no standalone table). `rate_cents` is BIGINT cents. `template_number` prefix JB-.

- `GET /three-pl-api/job-templates?status=&variant=`
- `POST /three-pl-api/job-templates` cap `threepl.job_template.create`
- `GET /three-pl-api/job-templates/:id`
- `PATCH /three-pl-api/job-templates/:id` cap `threepl.job_template.update`
- `DELETE /three-pl-api/job-templates/:id` cap `threepl.job_template.update` (soft-delete)
- `POST /three-pl-api/job-templates/:id/deactivate` and `/reactivate` cap `threepl.job_template.deactivate`
- `GET /three-pl-api/job-templates/:id/lines`
- `POST /three-pl-api/job-templates/:id/lines` cap `threepl.job_template.line.create`
- `PATCH /three-pl-api/job-templates/:id/lines/:lid` cap `threepl.job_template.line.update`
- `DELETE /three-pl-api/job-templates/:id/lines/:lid` cap `threepl.job_template.line.delete`

A Job Builder template can be applied to a draft quote (SPA-thin expansion over the quote-line CRUD), and `convert_quote_to_project` records the template on the resulting project and freezes a snapshot. See `docs/api/sales.md`.

## Supply Plans (Phase A5)

`supply_plans` resolve a project's material demand against on-hand stock; `supply_plan_lines` carry per-item required / available / reserved / shortage quantities and a `resolution` in (reserve, inbound, purchase, replenish). FSM: draft / released / fulfilled / cancelled. `warehouse_id` is where reservations draw from (defaults to the org default at release); `project_id` is the demand source. `plan_number` prefix SUP-.

- `GET /three-pl-api/supply-plans?status=&project_id=`
- `POST /three-pl-api/supply-plans` cap `threepl.supply_plan.create`
- `GET /three-pl-api/supply-plans/:id`
- `PATCH /three-pl-api/supply-plans/:id` cap `threepl.supply_plan.create` (header edits reuse the create cap; status moves via release / cancel)
- `DELETE /three-pl-api/supply-plans/:id` cap `threepl.supply_plan.create` (soft-delete)
- `POST /three-pl-api/supply-plans/:id/release` cap `threepl.supply_plan.release`
- `POST /three-pl-api/supply-plans/:id/cancel` cap `threepl.supply_plan.cancel`
- `GET /three-pl-api/supply-plans/:id/lines`
- `POST /three-pl-api/supply-plans/:id/lines` cap `threepl.supply_plan.line.create`
- `PATCH /three-pl-api/supply-plans/:id/lines/:lid` cap `threepl.supply_plan.line.update`
- `DELETE /three-pl-api/supply-plans/:id/lines/:lid` cap `threepl.supply_plan.line.delete`

`release` calls the SECURITY DEFINER RPC `release_supply_plan`: for each reserve-resolution line it reserves `min(required, available)` by writing a `reserve` stock movement (so the spine `quantity_reserved` reflects the hold) and records the shortage. `cancel` calls `cancel_supply_plan`, which writes `reserve_release` movements to restore the spine reserved. Both surface a missing or cross-tenant plan as `404 NOT_FOUND`, a non-draft release as `409 STATE_CONFLICT`, and a release with no resolvable warehouse as `422 VALIDATION_ERROR`. See `docs/api/inventory.md` for the reserve mechanism.

## Capabilities

All `threepl.*` capabilities are granted to the 3PL commercial roles: `org_owner`, `org_admin`, `ops`, `sales`. The SPA mirrors the role policy to hide buttons only; the edge `requireCap` is the authority.
