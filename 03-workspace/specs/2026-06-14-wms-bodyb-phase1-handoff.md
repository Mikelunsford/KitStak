# Handoff: WMS Body B (Phase 1 deepening core, B0 through B4)

Date: 2026-06-14. Wave 12.

Parent plan: `03-workspace/specs/2026-06-04-3pl-commercial-pivot-and-wms-pillar-plan.md` (sections 6.1, 6.2, 7; operator-confirmed 2026-06-04). Architecture decision: `docs/adr/0002-spine-plus-addons-and-wms-sixth-addon.md`. Phase recipe template: `03-workspace/specs/2026-06-13-3pl-a6-job-runs-handoff.md` plus the shipped A6 migrations 0098 through 0100. Billing sibling for handoff shape: `03-workspace/specs/2026-06-14-3pl-a7-billing-profitability-handoff.md`.

## 0. Start-state assumption

Body B starts AFTER A7 (Billing Review and Profitability) ships. Body B is the only remaining planned work after A7. Do not begin B0 until A7 is merged to prod and main is green.

Current max migration on disk as of this writing is `0101` (`0101_supply_plan_fulfillment.sql`). A7 will consume the next contiguous ids (its billing-review and profitability migrations land at 0102 and above). Before you cut your first WMS migration, run `ls supabase/migrations/ | tail` and take the real next free id. Every migration number in this doc is written relative to a placeholder base; renumber contiguously from the actual post-A7 max. The numbers below are illustrative and assume A7 consumed 0102 through 0104, so WMS starts at 0105. Confirm and adjust.

The A6/A7 phase recipe is the template for every WMS phase. Read it once before B0 and clone it per phase. This doc grounds the WMS-specific mechanics on the real chassis so a fresh-session agent can build B0 without re-deriving the gating, ledger, or rollup patterns.

## 1. What Body B is

WMS is add-on number six. It DEEPENS the spine. It does not replace or own warehouses or stock. The spine owns warehouse-level truth: `stock_levels.quantity_on_hand` is a full recompute off the append-only `stock_movements` ledger (`supabase/migrations/0030_inventory_warehouses_stock.sql`). WMS adds a NULLABLE `location_id` dimension (and optional `lot_id`) to that SAME ledger and derives a bin-level rollup (`bin_stock_levels`) the identical way the spine derives the warehouse rollup: sum of signed quantity, grouped by the bin keys instead of just `(warehouse, item)`.

The sum-reconcile invariant, stated precisely: for any `(warehouse_id, item_id)`, the sum of `bin_stock_levels.quantity_on_hand` over all `location_id` partitions (including the NULL "no-bin" partition that holds every legacy and WMS-off movement) EQUALS `stock_levels.quantity_on_hand` for that same `(warehouse_id, item_id)`, by construction. This holds because the warehouse total is a pure `sum(signed quantity)` with no GROUP BY and no other-dimension filter (0030 lines 211 to 224), and summing the same movement set partitioned by a new nullable dimension yields subtotals whose sum equals the unpartitioned total identically, provided the bin recompute uses the byte-identical signed-CASE expression. A contract test asserts this equality.

WMS off means handlers stop setting `location_id` (it stays NULL, like every pre-WMS row), bin rollups stay empty, warehouse totals are untouched. The flag is `plugins.wms`, DEFAULTS OFF (paid add-on, unlike `three_pl` which defaults on). The pillar root is the neutral `/wms/*`, gated to a 404 (NotFoundPage), never 403.

## 2. Phase-by-phase plan

Five phases. B0 is chassis only (no domain tables). B1 through B4 each clone the A6 phase recipe: DB layer (one or more forward migrations, idempotent, header block, RLS Pattern A, audit triggers, regression test per migration) then app layer (byte-mirror types, byte-mirror caps, edge routes in the `wms-api` bundle, SPA service/hook/keys/pages/routes, sidebar entry plus test). B2 is the constitutional stop-point (see section 5).

Suggested contiguous migration numbering (renumber from the real post-A7 max; placeholder base 0105):
- B0: `0105_seed_plugins_wms_flag.sql` (seed only; no domain table).
- B1: `0106_warehouse_locations.sql`.
- B2: `0107_stock_movements_bin_dimension.sql` (the spine change plus `bin_stock_levels` plus recompute plus the reconcile test, ALL in one PR).
- B3: `0108_putaway_tasks.sql` (plus `0109_putaway_tasks_numbering.sql` only if you give putaway tasks a doc number; see decision (b)).
- B4: `0110_lots.sql`.

### B0. WMS chassis

Scope: stand up the gated add-on with no domain tables. Mirror the `manufacturing-api` plus `plugins.manufacturing` sibling throughout. After B0, `/wms/*` routes resolve to NotFoundPage for every org (flag defaults off, no org reachable until flipped on via `/admin/flags`).

Complete chassis checklist (exact files, constants, helpers from the gating map):

1. `supabase/functions/_shared/constants.ts` (the `FEATURE_FLAGS` object, Pillar plugins block, lines 36 to 41). Add, byte-identical to file 2:
   ```ts
   PLUGINS_WMS: 'plugins.wms',
   ```
   The `FeatureFlagKey` union (line 54 to 55) auto-derives; no manual edit.

2. `apps/web/src/lib/constants.ts` (the same `FEATURE_FLAGS` block, lines 36 to 41). Add the SAME line, byte-identical. `pnpm test:contract` (`test/contract/parity.test.ts`) asserts the two files are identical; a drift is a release blocker.

3. `supabase/functions/wms-api/index.ts` (new bundle file). Mirror `supabase/functions/manufacturing-api/index.ts`. Imports: `Route` from `../_shared/route.ts`; `ApiError, ok, internalError` from `../_shared/responses.ts`; `admin, parseBody, parseUuidParam, respondWithIdempotency, created, requireCap` from `../_shared/handler-helpers.ts`; `requireCaller, type Caller` from `../_shared/tenant.ts`; `assertRefInOrg` from `../_shared/crud.ts`; `nextDocNumber` from `../_shared/numbering.ts`; `serveBundleWithGate` from `../_shared/bundleGate.ts`; `FEATURE_FLAGS` from `../_shared/constants.ts`. At B0 the route table is empty; the file tail is the gate:
   ```ts
   const BUNDLE = 'wms-api';
   const TABLE: Route[] = [];
   serveBundleWithGate({
     flagKey: FEATURE_FLAGS.PLUGINS_WMS,
     routes: TABLE,
     bundle: BUNDLE,
   });
   ```
   WMS is a single add-on, so use `flagKey` (one flag), not `flagKeys`. `serveBundleWithGate` (`bundleGate.ts` line 136) is read-only; do not edit it. Exactly one of `flagKey`/`flagKeys` is required or it fails closed to 404.

4. `.github/workflows/deploy-functions.yml`. Append `wms-api` to the workflow-level `env.BUNDLES` block scalar (after the `manufacturing-api` entry, line 53; 4-space indent under the `|` block):
   ```
       wms-api
   ```
   Omitting this means the bundle never deploys (the CORS / ERR_FAILED symptom from the deploy-functions memory note). Both `deploy` and `deploy_staging` jobs read this one list.

5. `apps/web/src/routes.ts`. Two edits plus page rows:
   - In `inferPluginForPath` (lines 1484 to 1503), add the clause AFTER the kitforce clause (line 1501) and BEFORE `return undefined`:
     ```ts
     if (inPillar(spec.path, '/wms')) {
       return FEATURE_FLAGS.PLUGINS_WMS;
     }
     ```
     `inPillar(path, root)` (line 1480) matches `path === root || path.startsWith(root + '/')`.
   - Add the `/wms` home route now (the section routes land per phase). Lazy import at top, KitForce/Manufacturing precedent (lines 1345 to 1349 / 669 to 693). Pages live under `apps/web/src/pages/wms/`:
     ```ts
     const WmsHomePage = lazy(() =>
       import('./pages/wms/WmsHomePage').then((m) => ({ default: m.WmsHomePage })),
     );
     ```
     ```ts
     { path: '/wms', element: WmsHomePage, guard: 'protected', layout: 'shell' },
     ```
   A gated pillar route declares ONLY `path/element/guard/layout`; `requiresPlugin` is auto-injected by `withPluginGate` (lines 1516 to 1520), exported as `ROUTES = RAW_ROUTES.map(withPluginGate)` (line 1522). `auth/RequirePlugin.tsx` (lines 35 to 47) renders `<NotFoundPage />` (404, not 403) when `flags.data[flag] !== true`.

6. `apps/web/src/components/shell/sidebarModes.ts`. Add a NEW `wms` mode section gated by `requiresFlag: FEATURE_FLAGS.PLUGINS_WMS`, with the four Phase 1 routes seeded now as placeholders or added per phase (recommend: add the section now, fill route entries as each phase ships its list page): Locations, Putaway, Bin stock, Lots. Icons from lucide-react (`MapPin` for Locations, `PackagePlus` for Putaway, `Boxes` for Bin stock, `Tags` for Lots; pick final icons during build). Match the `three_pl` mode shape.

7. `apps/web/src/components/shell/sidebarModes.test.ts`. Add a `toEqual([...])` exact-paths assertion for the new `wms` mode plus `requiresFlag` and label checks, mirroring the `three_pl` mode test.

8. `supabase/migrations/0105_seed_plugins_wms_flag.sql` (new forward migration; renumber from real max). Two operations:
   - `create or replace function public.seed_org_settings(p_org_id uuid)` re-stating the WHOLE body from the current canon (`0064_provision_organization_completeness.sql` lines 87 to 132; confirm 0064 is still the latest redefinition before you copy, no migration after 0064 redefines it as of this writing) with `'plugins.wms'` appended to the `v_flags` array (lines 96 to 107). Preserve the `revoke`/`grant to service_role` and the `comment`. The loop inserts each flag `is_enabled = false ... on conflict (org_id, flag_key) do nothing`, so WMS seeds OFF.
   - An idempotent backfill loop so existing orgs get the `plugins.wms = false` row:
     ```sql
     do $$
     declare v_org_id uuid;
     begin
       for v_org_id in select id from public.organizations loop
         perform public.seed_org_settings(v_org_id);
       end loop;
     end$$;
     ```
   `provision_organization` (latest definition `0072_provision_organization_profile_display_name_fix.sql` line 147) delegates to `seed_org_settings` and needs no change. The migration touches `org_feature_flags` rows only (Pattern A, inherited). It does NOT touch RLS/money/idempotency/audit_log DDL. Header must declare Wave 12, Phase B0, Closes (cite this handoff), Date, DOWN MIGRATION (operator-only: restore the prior `seed_org_settings` body, `delete from org_feature_flags where flag_key = 'plugins.wms'`), Constitutional alignment.

9. `apps/web/test/regression/db-0105-seed-plugins-wms-flag.test.ts`. Static SQL content check: assert the migration redefines `seed_org_settings`, appends `'plugins.wms'` to `v_flags`, seeds `is_enabled = false`, and includes the backfill loop.

No-edit dependencies (mirror only, do not modify): `supabase/functions/_shared/bundleGate.ts`, `supabase/functions/_shared/route.ts`, `apps/web/src/auth/RequirePlugin.tsx`, `supabase/functions/_shared/feature-flags.ts` (`getFlag`, memoized 5 min per org/flag).

Verification gate set (B0): `pnpm test:contract` (constants parity), `pnpm typecheck`, `pnpm lint` (max-warnings 0), `pnpm test` (full vitest including the new db-0105 test and the updated sidebarModes test), `deno check` across all bundles INCLUDING the new `wms-api`, `pnpm build`, `size-limit` (index under 40 kB gz; `/wms/*` pages are lazy). Apply 0105 to staging via MCP `apply_migration` (staging only; the post-merge workflow ships to prod via file-based push). Confirm a fresh provisioned org gets `plugins.wms = false` and that `/wms` resolves to NotFoundPage with the flag off.

### B1. Locations and bins

Scope: the `warehouse_locations` parent table (bins, shelves, racks, docks, staging), its RLS and caps and edge routes, and the SPA `/wms/locations` list/detail/create. No state machine (config table, like `three_pl_accounts`).

DB layer, `0106_warehouse_locations.sql`:
- Header block, DOWN block, Constitutional alignment.
- `audit_log_entity_type_check` extended as a STRICT SUPERSET: copy the full current list verbatim from the latest carrier (`0099_job_run_daily_logs.sql` lines 102 to 127; confirm A7 did not add entity_types that you must also carry, copy from whatever the post-A7 max carrier is) and append `'warehouse_location'`. Guarded drop-then-add plus a `comment on constraint` declaring the authoritative list as of this migration.
- Table `public.warehouse_locations`: `id uuid primary key default gen_random_uuid()`, `org_id uuid not null references public.organizations(id) on delete cascade` (denormalized for Pattern A), `warehouse_id uuid not null references public.warehouses(id)`, `code text not null`, `location_type text not null check (location_type in ('bin','shelf','rack','dock','staging'))`, `parent_location_id uuid references public.warehouse_locations(id) on delete set null` (self-ref nullable; precedent `0021_finance_coa.sql:24` and `0012_sales_items.sql:63`, use `set null` not cascade), `attributes jsonb not null default '{}'::jsonb` (pickable, putaway eligible, capacity), `active boolean not null default true`, `notes text`, `created_at/created_by/updated_at/updated_by`, `deleted_at timestamptz`.
- Indexes: partial-unique `(org_id, warehouse_id, code) where deleted_at is null`; `(org_id) where deleted_at is null`; `(org_id, warehouse_id) where deleted_at is null`; `(org_id, parent_location_id) where deleted_at is null`.
- RLS Pattern A: `_select` `using (org_id = public.current_org_id())`; `_write` `for all` gated `org_id = public.current_org_id() and public.current_user_role() in ('org_owner','org_admin','ops')`. Use the INVENTORY 3-role set (`org_owner, org_admin, ops`, matching `warehouses` in 0030), NOT the 3PL commercial 4-role set. WMS is warehouse execution, not commercial.
- `trg_warehouse_locations_set_updated_at()` BEFORE UPDATE (template `0089:272-301`).
- Audit trigger `trg_audit_warehouse_locations()`: non-FSM config-table shape (`p_from = null`, `p_to = 'created'|'updated'|'deleted'`, `p_action = 'insert'|'update'|'delete'`), calling `public.audit_append_state_change(...)`; template `0089_threepl_accounts.sql:308-492`. AFTER INSERT OR UPDATE OR DELETE.
- `comment on table`.

Caps (both mirrors, byte-identical; `supabase/functions/_shared/capabilities.ts` AND `apps/web/src/lib/capabilities.ts`): add to the `Capability` union and grant into the role arrays. New caps: `wms.location.read | wms.location.create | wms.location.update | wms.location.deactivate`. Grant to the WMS role set `org_owner, org_admin, ops` (OWNER_CAPS, ADMIN_CAPS, OPS_CAPS). Do NOT grant to SALES_CAPS (WMS is not commercial). Not granted to accounting/viewer/customer/vendor.

Types (both mirrors, byte-identical): create `supabase/functions/_shared/types/wms.ts` AND `apps/web/src/lib/types/wms.ts` (new files, sibling shape to `types/threepl.ts`). Per entity append `WarehouseLocationSchema` (full read shape), `WarehouseLocationCreateSchema` (client-settable, `.optional().nullable()`), `WarehouseLocationPatchSchema = ...CreateSchema.partial()`, plus exported types. `attributes` typed `z.record(z.unknown())`. Wire to the contract parity test.

Edge (`wms-api/index.ts`): import the new schemas. Loader/guard helpers `loadWarehouseLocation(caller, id)` (admin select `.eq('org_id', caller.orgId).eq('id', id).is('deleted_at', null)`, returns parsed schema or `NOT_FOUND 404`) and `assertWarehouseLocationParent` for the self-ref. Routes: `GET /locations` (list, filters via query), `POST /locations` (create), `GET/PATCH/DELETE /locations/:id`, `POST /locations/:id/deactivate` (sets `active = false`). Per write: `requireCaller` then `requireCap(caller, 'wms.location.<action>')` then `parseBody` then `respondWithIdempotency(req, caller, BUNDLE, '<route-template>', body, fn)` with a distinct template per action (suffix `-delete`, `-deactivate`). Validate `warehouse_id` and `parent_location_id` via `assertRefInOrg('warehouses', caller, body.warehouse_id)` and `assertRefInOrg('warehouse_locations', caller, body.parent_location_id)` before insert/in PATCH (404 not 403).

SPA: `apps/web/src/lib/services/wmsLocationsService.ts` (`const BASE = '/wms-api/locations'`, one async fn per route, `Schema.parse`), `apps/web/src/lib/hooks/useWmsLocations.ts` (`C = { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 as const }`; list/detail queries; create/update/soft-delete/deactivate mutations invalidating `wmsLocationsKeys.all` plus `auditLogKeys.byEntity('warehouse_location', id)`), `apps/web/src/lib/queryKeys/wms.ts` (new file; `wmsLocationsKeys = { all: ['wms','warehouse_locations'], list: (f) => [...all,'list',f], detail: (id) => [...all,'detail',id] }`), pages `apps/web/src/pages/wms/WmsLocationsListPage.tsx` / `WmsLocationDetailPage.tsx` / `WmsLocationCreatePage.tsx`. List and create set `eyebrow="WMS"`; detail is a HUB (config table, not an FSM), so it SETS the eyebrow (hub details set the eyebrow; only FSM details omit it). Routes added to `routes.ts` (`/new` before `/:id`); sidebar `wms` mode gets the Locations entry; update `sidebarModes.test.ts`.

Regression: `apps/web/test/regression/db-0106-warehouse-locations.test.ts` (static checks: table with the `location_type` CHECK and self-ref FK with `set null`; Pattern A RLS gated to the 3-role inventory set; audit_log CHECK superset containing `'warehouse_location'` and all prior values; config-table audit-trigger shape; partial-unique on `(org_id, warehouse_id, code)`).

Verification gate set (B1): contract parity (types and caps), typecheck, lint max-warnings 0, full vitest plus db-0106, deno check all bundles, build, size-limit. Apply 0106 to staging via MCP; live-probe locations CRUD plus the deactivate route in an aborting transaction.

### B2. Stock-movement bin dimension (THE SPINE STOP-POINT)

Scope: the additive nullable `location_id` (and optional `lot_id`, pallet/license-plate id) on `stock_movements`, the `bin_stock_levels` rollup, a bin recompute function plus trigger wiring, and the sum-reconcile contract test. This is the constitutional stop-point (section 5). The column does not land until the operator confirms, and the reconcile test ships in the SAME PR.

DB layer, `0107_stock_movements_bin_dimension.sql` (ONE migration, ONE PR):

1. Additive nullable columns on `stock_movements` (created 0030; forward-only, idempotent):
   ```sql
   alter table public.stock_movements add column if not exists location_id uuid references public.warehouse_locations(id) on delete set null;
   alter table public.stock_movements add column if not exists lot_id uuid;        -- FK added in B4 once lots exists
   alter table public.stock_movements add column if not exists license_plate_id uuid;
   ```
   `location_id` FKs to `warehouse_locations` (exists after B1). `lot_id` stays a bare uuid here; B4 adds its FK once `lots` exists (matches the chassis convention of bare-uuid forward refs). Existing rows keep NULL location (the WMS-off / pre-WMS default). New index for bin queries: `create index if not exists stock_movements_warehouse_item_location_idx on public.stock_movements (warehouse_id, item_id, location_id)`. The existing `stock_movements_warehouse_item_idx` is unchanged.

2. `bin_stock_levels` rollup table (model on `stock_levels`, 0030 lines 69 to 101):
   ```sql
   create table if not exists public.bin_stock_levels (
     id uuid primary key default gen_random_uuid(),
     org_id uuid not null references public.organizations(id) on delete cascade,
     warehouse_id uuid not null references public.warehouses(id) on delete cascade,
     location_id uuid not null references public.warehouse_locations(id) on delete cascade,
     item_id uuid not null,
     lot_id uuid,                                   -- nullable; see decision (d)
     quantity_on_hand numeric(18,4) not null default 0,
     last_movement_at timestamptz,
     updated_at timestamptz not null default now(),
     unique (warehouse_id, location_id, item_id, lot_id)   -- group-by key; see decision (d)
   );
   ```
   RLS Pattern A SELECT-only for authenticated (`org_id = public.current_org_id()`), NO write policy (writes only via the SECURITY DEFINER recompute, exactly like `stock_levels`). NOT audited (the spine `stock_levels` rollup is not audited; `bin_stock_levels` follows it, so no `'bin_stock_level'` entity_type is added to the audit CHECK). One read cap only: `wms.bin_stock.read`. Indexes: `(org_id)`, `(warehouse_id, item_id)`, `(location_id)`.

3. Bin recompute function (a NEW function; the existing `recompute_stock_level` hard-codes its grain in the WHERE and the `on conflict`, so it cannot be reused). CRITICAL: the signed-CASE must be BYTE-IDENTICAL to `recompute_stock_level`'s CASE (0030 lines 212 to 218), or the sum-reconcile invariant breaks:
   ```sql
   create or replace function public.recompute_bin_stock_level(
     p_warehouse_id uuid, p_item_id uuid, p_location_id uuid, p_lot_id uuid
   ) returns void language plpgsql security definer set search_path = public as $$
   declare v_org_id uuid; v_on_hand numeric(18,4); v_last timestamptz;
   begin
     if p_location_id is null then return; end if;     -- no-bin partition is not rolled up; it lives only in the warehouse total
     select org_id into v_org_id from public.warehouses where id = p_warehouse_id;
     if v_org_id is null then return; end if;
     select coalesce(sum(case
         when movement_type in ('receipt','production_produced','transfer_in','adjustment') then quantity
         when movement_type in ('shipment','production_consumed','transfer_out') then -quantity
         else 0 end), 0), max(occurred_at)
       into v_on_hand, v_last
       from public.stock_movements
       where warehouse_id = p_warehouse_id and item_id = p_item_id
         and location_id = p_location_id
         and lot_id is not distinct from p_lot_id;      -- null-safe lot match
     insert into public.bin_stock_levels (org_id, warehouse_id, location_id, item_id, lot_id, quantity_on_hand, last_movement_at, updated_at)
       values (v_org_id, p_warehouse_id, p_location_id, p_item_id, p_lot_id, v_on_hand, v_last, now())
     on conflict (warehouse_id, location_id, item_id, lot_id) do update
       set quantity_on_hand = excluded.quantity_on_hand,
           last_movement_at = excluded.last_movement_at, updated_at = now();
   end; $$;
   revoke execute on function public.recompute_bin_stock_level(uuid,uuid,uuid,uuid) from public, anon;
   grant execute on function public.recompute_bin_stock_level(uuid,uuid,uuid,uuid) to service_role;
   ```

4. Extend the AFTER INSERT trigger function to fire BOTH rollups off the same row. Redefine `trg_stock_movements_recompute()` (0030 lines 245 to 255) so it still recomputes the warehouse grain unchanged AND, when `new.location_id is not null`, recomputes the bin grain:
   ```sql
   create or replace function public.trg_stock_movements_recompute()
   returns trigger language plpgsql security definer set search_path = public as $$
   begin
     perform public.recompute_stock_level(new.warehouse_id, new.item_id);          -- warehouse grain, unchanged
     if new.location_id is not null then
       perform public.recompute_bin_stock_level(new.warehouse_id, new.item_id, new.location_id, new.lot_id);
     end if;
     return new;
   end; $$;
   revoke execute on function public.trg_stock_movements_recompute() from public, anon;
   ```
   The trigger `stock_movements_recompute_ai` (AFTER INSERT, FOR EACH ROW) already points at this function; no re-wire needed, but re-declare the `drop trigger if exists ... ; create trigger ...` idempotently if the function signature is touched. WMS-off rows have NULL `location_id`, so the bin branch is skipped and the warehouse total stays the sole rollup. Off equals totals intact.

5. The sum-reconcile contract test, in the SAME PR. Two layers:
   - Static regression: `apps/web/test/regression/db-0107-stock-movements-bin-dimension.test.ts` asserts the additive nullable `location_id`/`lot_id` columns, the new index, the `bin_stock_levels` table with the four-key unique and SELECT-only RLS, the bin recompute's signed-CASE being identical to `recompute_stock_level`'s, and the trigger firing both rollups with the `location_id is not null` guard.
   - Live reconcile proof on staging in an ABORTING transaction (`begin; ... rollback;`): provision a fixture warehouse + item + two locations, insert movements split across the two locations plus one NULL-location movement, then assert `sum(bin_stock_levels.quantity_on_hand) over (warehouse,item) = stock_levels.quantity_on_hand` for that pair, AND that the NULL-location movement is in the warehouse total but in no bin row. Capture the proof in the PR body. This is the single load-bearing test of Body B.

Caps (both mirrors): add `wms.bin_stock.read` to the `Capability` union; grant read to `org_owner, org_admin, ops` (and viewer may read bin stock if you want parity with `stock_levels` read posture; recommend matching whatever reads `stock_levels` today, confirm during build). Types (both mirrors): `BinStockLevelSchema` read-only shape in `types/wms.ts`. Edge: `GET /bin-stock` list (filters `warehouse_id`, `item_id`, `location_id`) plus `GET /bin-stock/:id`; read-only, `requireCap(caller, 'wms.bin_stock.read')`, no writes (rollup is trigger-maintained). SPA: `wmsBinStockService.ts`, `useWmsBinStock.ts`, keys in `queryKeys/wms.ts`, a `WmsBinStockListPage.tsx` (read-only `DataTable`, `eyebrow="WMS"`), route, sidebar Bin stock entry plus test.

Verification gate set (B2): the reconcile proof above is mandatory and gating. Plus contract parity (types and caps), typecheck, lint max-warnings 0, full vitest plus db-0107, deno check all bundles, build, size-limit. Operator confirm BEFORE the column lands (section 5).

### B3. Directed putaway

Scope: the `putaway_tasks` parent table with a state machine, FSM transition RPCs, and a "done" path that writes a bin-dimensioned `stock_movement` (location_id set), so completing a putaway flows straight into the B2 bin rollup.

DB layer, `0108_putaway_tasks.sql` (plus `0109_putaway_tasks_numbering.sql` only if decision (b) gives putaway tasks a doc number):
- Header, DOWN, Constitutional alignment. `audit_log_entity_type_check` superset adds `'putaway_task'`.
- Table `public.putaway_tasks`: `id`, `org_id` (denormalized), `warehouse_id uuid not null references warehouses(id)`, a source ref (`source_entity_type text`, `source_entity_id uuid`; free-form per decision (b) unless receiving/returns are linkable), `item_id uuid not null references items(id)`, `quantity numeric(18,4) not null`, `suggested_location_id uuid references warehouse_locations(id) on delete set null`, `actual_location_id uuid references warehouse_locations(id) on delete set null`, `lot_id uuid` (nullable; bare uuid until B4 FKs it, or FK now if B4 ships first; build order keeps lots last so leave bare), `license_plate_id uuid`, `status text not null default 'suggested' check (status in ('suggested','in_progress','done','cancelled'))`, paired `started_at/completed_at/cancelled_at timestamptz`, optional `putaway_number text` (decision (b)), `notes text`, `payload jsonb not null default '{}'::jsonb`, `created_at/created_by/updated_at/updated_by`, `deleted_at`.
- Indexes: `(org_id) where deleted_at is null`, `(org_id, status) where deleted_at is null`, `(org_id, warehouse_id) where deleted_at is null`, one per location FK `where ... is not null`, partial-unique on the doc number if present.
- RLS Pattern A, write gate `org_owner, org_admin, ops`. updated_at trigger. Audit trigger FSM shape (`v_from := old.status; v_to := new.status` on UPDATE, `v_to := new.status; v_action := 'insert'` on INSERT, `'deleted'` on DELETE).
- FSM transition RPCs, the 3-arg cross-tenant pattern `(p_putaway_task_id uuid, p_actor uuid, p_caller_org_id uuid) returns uuid security definer`. Transitions: `start` (suggested -> in_progress, stamps `started_at`), `complete` (in_progress -> done, stamps `completed_at`, AND writes the movement, see below), `cancel` (from any not-done state -> cancelled). Each: read `org_id, status into v_org_id, v_status`; NOT_FOUND guard `if v_org_id is null or v_org_id <> p_caller_org_id then raise 'NOT_FOUND: ...' using errcode = 'P0001'`; idempotent return if already at target; STATE_CONFLICT if not in the required source state; update. NOT_FOUND never 403.
- The complete RPC writes the bin-dimensioned movement. Inside `complete_putaway_task`, after the state update, when WMS is on and an `actual_location_id` is present (decision (e)):
  ```sql
  insert into public.stock_movements (org_id, warehouse_id, item_id, location_id, lot_id, movement_type, quantity, unit_cost_cents, source_entity_type, source_entity_id, occurred_at, created_by)
  values (v_org_id, v_warehouse_id, v_item_id, v_actual_location_id, v_lot_id, 'adjustment', v_quantity, 0, 'putaway_task', p_putaway_task_id, now(), p_actor);
  ```
  Use an EXISTING 0030 movement type (`'adjustment'` for a directed putaway into a bin; do NOT invent a ledger type). `source_entity_type = 'putaway_task'`. The AFTER INSERT trigger then fires both rollups (warehouse grain unchanged, bin grain populated because `location_id` is set). If `actual_location_id` is NULL or WMS is off, complete writes NO movement (decision (e) no-op guarantee). Confirm the movement-type choice with the operator: a putaway that physically relocates already-received stock is an internal move, so `adjustment` keeps the warehouse total flat while populating the bin. If putaway represents the FIRST entry of received stock into the building, `receipt` is the right type. This depends on decision (b)/(c) and is a build-time call.
- `comment on table`.

Numbering (only if decision (b) assigns a putaway doc number): `0109_putaway_tasks_numbering.sql` extends `numbering_sequences_doc_type_check` (superset), seeds existing orgs (`cross join values ('putaway_task','PUT-')`), and redefines the latest `seed_org_numbering` (latest carrier is `0100_job_runs_numbering.sql` as of this writing; confirm post-A7) appending positionally to `v_doc_types[]` and `v_prefixes[]`. Watch prefix collisions; `PUT-` is free (the chassis uses `RUN-` for production_run, `JR-` for job_run).

Caps (both mirrors): `wms.putaway.create | wms.putaway.start | wms.putaway.complete | wms.putaway.cancel`. Grant to `org_owner, org_admin, ops`. Types (both mirrors): `PutawayTaskStatusSchema`, `PutawayTaskSchema`, `PutawayTaskCreateSchema`, `PutawayTaskPatchSchema` in `types/wms.ts`. Edge: `loadPutawayTask`/`assertPutawayTaskParent`; routes `GET /putaway`, `POST /putaway`, `GET/PATCH/DELETE /putaway/:id`, FSM `POST /putaway/:id/{start,complete,cancel}`. Transition handlers call `admin().rpc('start_putaway_task'|'complete_putaway_task'|'cancel_putaway_task', { p_putaway_task_id, p_actor: caller.userId, p_caller_org_id: caller.orgId })` then map `/NOT_FOUND/ -> 404`, `/STATE_CONFLICT/ -> 409`, else `internalError`. `assertRefInOrg` on `warehouse_id`, `suggested_location_id`, `actual_location_id`, `item_id`, `lot_id`. SPA: service/hook/keys, `WmsPutawayListPage`/`WmsPutawayDetailPage`/`WmsPutawayCreatePage`. FSM detail OMITS the eyebrow (status renders as `StatusBadge`, FSM not in the SPA StateStepper); list and create set `eyebrow="WMS"`. Route table (`/new` before `/:id`), sidebar Putaway entry plus test.

Regression: `db-0108-putaway-tasks.test.ts` (FSM CHECK, spine FKs, Pattern A RLS 3-role, audit superset `'putaway_task'`, audit FSM trigger shape, each transition RPC = 3-arg guard + NOT_FOUND + not FORBIDDEN + STATE_CONFLICT + idempotent + paired `*_at` stamping, complete writes a bin-dimensioned movement with an existing movement_type and `source_entity_type = 'putaway_task'`); plus `db-0109-...test.ts` if the numbering migration exists.

Verification gate set (B3): contract parity, typecheck, lint 0, full vitest plus db-0108 (and db-0109), deno check all bundles, build, size-limit. Apply to staging; live-probe each transition plus the complete-writes-movement-then-bin-rollup chain in an aborting transaction, asserting the bin row appears and the warehouse total stays reconciled.

### B4. Lot and expiration capture

Scope: the `lots` parent table, capture of lot and expiration at receiving and putaway, and first-expired-first-out (FEFO) groundwork. Phase 1 is capture only; FEFO selection and a full holds/quarantine table are later. The `quarantined` status is the minimal hold for now.

DB layer, `0110_lots.sql`:
- Header, DOWN, Constitutional alignment. `audit_log_entity_type_check` superset adds `'lot'`.
- Table `public.lots`: `id`, `org_id` (denormalized), `item_id uuid not null references items(id)`, `lot_code text not null`, `expiration_date date`, `received_at timestamptz`, `status text not null default 'active' check (status in ('active','quarantined','expired','consumed'))`, `notes text`, `payload jsonb not null default '{}'::jsonb`, `created_at/created_by/updated_at/updated_by`, `deleted_at`.
- Indexes: partial-unique `(org_id, item_id, lot_code) where deleted_at is null`; `(org_id) where deleted_at is null`; `(org_id, status) where deleted_at is null`; `(org_id, item_id, expiration_date) where deleted_at is null` (FEFO groundwork: cheap ordered scan by soonest expiry per item).
- RLS Pattern A, write gate `org_owner, org_admin, ops`. updated_at trigger. Audit trigger FSM shape (`status` is the state).
- FSM transition RPC `quarantine_lot` (active -> quarantined) as the minimal hold, 3-arg cross-tenant pattern. `expired` and `consumed` transitions can be added now or deferred; recommend shipping `quarantine` plus a generic status-set guarded by caps, and leaving expiry-driven auto-transition to a later phase.
- Now that `lots` exists, FK the forward refs: `alter table public.stock_movements add constraint stock_movements_lot_id_fkey foreign key (lot_id) references public.lots(id) on delete set null` (guarded, idempotent) and the same on `putaway_tasks.lot_id` and `bin_stock_levels.lot_id`. These were bare uuids in B2/B3; B4 closes them. Forward-only and additive.
- `comment on table`.

Capture wiring: receiving and putaway capture lot and expiration. At putaway, the complete RPC already threads `lot_id` into the movement (B3). For receiving, the spine receiving path sets `lot_id` on its emitted movement when WMS is on and a lot is provided (decision (c)); the bin recompute already null-safe-matches `lot_id`, so a lot-keyed bin row appears. Phase 1 captures the lot; FEFO consumption that picks the soonest-expiry lot is named not promised.

Caps (both mirrors): `wms.lot.read | wms.lot.create | wms.lot.update | wms.lot.quarantine`. Grant to `org_owner, org_admin, ops`. Types (both mirrors): `LotStatusSchema`, `LotSchema`, `LotCreateSchema`, `LotPatchSchema`. Edge: `loadLot`/`assertLotParent`; routes `GET /lots`, `POST /lots`, `GET/PATCH/DELETE /lots/:id`, `POST /lots/:id/quarantine`; `assertRefInOrg('items', caller, body.item_id)`. SPA: service/hook/keys, `WmsLotsListPage`/`WmsLotDetailPage`/`WmsLotCreatePage`. Lots is a near-config table with one minimal hold transition; treat the detail as a HUB (set the eyebrow) unless you register `quarantined` in the StateStepper, in which case omit it. Recommend HUB (set eyebrow), since the hold is minimal. List and create set `eyebrow="WMS"`. Route table, sidebar Lots entry plus test.

Regression: `db-0110-lots.test.ts` (status CHECK, item FK, Pattern A RLS 3-role, audit superset `'lot'`, audit trigger shape, the FEFO `expiration_date` index, the `quarantine_lot` RPC 3-arg guard, and the three additive lot_id FK constraints on stock_movements/putaway_tasks/bin_stock_levels).

Verification gate set (B4): contract parity, typecheck, lint 0, full vitest plus db-0110, deno check all bundles, build, size-limit. Apply to staging; live-probe lot CRUD, quarantine, and a receiving-then-putaway flow that produces a lot-keyed bin row reconciling to the warehouse total.

## 3. Decisions to settle FIRST (operator)

Recommend each, then lock before B1. These are the B-analogues of the A6/A7 pre-build decisions.

(a) Location code scheme and hierarchy depth. Recommend: free-form `code` unique per `(org, warehouse)`, with a nullable self-ref `parent_location_id` allowing arbitrary depth but NO enforced depth limit in Phase 1 (the operator's bins are AISLE-RACK-SHELF-BIN in practice, but encoding the hierarchy as a string code plus an optional parent pointer keeps Phase 1 flat and unblocked). Do not build a structured aisle/rack/shelf/bin column set now; `attributes jsonb` carries pickable/putaway-eligible/capacity. LOCK: free-form code, optional single parent pointer, no depth enforcement.

(b) Putaway source linkage. Recommend: free-form source ref for Phase 1 (`source_entity_type text` + `source_entity_id uuid`, nullable, NO FK, validated in-org by the handler when present), NOT a hard FK to receiving or returns. Receiving exists in the 3PL add-on but returns disposition is a later WMS phase; hard-linking now would couple B3 to surfaces that are not all built. And NO putaway doc number in Phase 1 (skip `0109`); putaway tasks are operational, not documents. LOCK: free-form nullable source ref, no doc number, no hard FK.

(c) Lot capture point and mandatory-vs-opt-in. Recommend: capture at BOTH receiving and putaway (whichever first touches the stock), opt-in per item (a future `items.lot_tracked` flag gates whether lot is required; Phase 1 treats lot as always optional, never mandatory). Forcing lot capture before the item-level flag exists would block non-lot-tracked operators. LOCK: capture at receiving and putaway, lot optional everywhere in Phase 1, per-item mandatory deferred.

(d) `bin_stock_levels` grain. Recommend: INCLUDE `lot_id` in the rollup key from the start: `unique (warehouse_id, location_id, item_id, lot_id)`, with `lot_id` nullable (null-safe match via `is not distinct from`). Including lot now means B4 adds no schema change to the rollup, and the no-lot case is just the `lot_id IS NULL` partition. The sum-reconcile invariant holds either way (partitioning finer still sums to the same total). LOCK: four-key grain `(warehouse, location, item, lot)`, lot nullable.

(e) Putaway "done" movement and the WMS-off no-op. Recommend: `complete_putaway_task` writes a bin-dimensioned `stock_movement` ONLY when WMS is on AND an `actual_location_id` is chosen. If WMS is off or no location is chosen, complete transitions the task state but writes NO movement (so warehouse totals are untouched and no orphan bin rows appear). The guarantee: with `plugins.wms` off, no WMS handler is reachable (the bundle gate 404s), so putaway tasks cannot be created or completed at all; the column-level NULL `location_id` default is the belt-and-suspenders second layer for any movement written by a non-WMS path. LOCK: movement on complete only when WMS-on and location chosen; off equals no-op equals totals intact.

## 4. The B2 operator stop-point (the single most important gate in Body B)

`stock_movements` is the load-bearing ledger. It is adjacent to the four constitutional non-negotiables: RLS (the append-only posture is enforced by absence of write policies plus SECURITY DEFINER trigger writes), money (movements carry `unit_cost_cents`), idempotency (movement-emitting handlers are idempotent), and audit (the ledger is the source of truth for `stock_levels`). Per CLAUDE.md "When to stop and ask": a schema change that touches RLS, money helpers, idempotency, or audit_log requires operator confirmation. The `location_id` column is adjacent to all four.

The stop-point is risk `R-W12-CO-02`. Before the `location_id` column lands:
- Confirm with the operator that the additive nullable `location_id` (plus `lot_id`, `license_plate_id`) on `stock_movements` is approved.
- Confirm the columns are nullable and additive only (no NOT NULL, no backfill of existing rows, no change to the existing append-only posture or the existing warehouse recompute).
- Confirm the sum-reconcile contract test ships in the SAME PR as the column (the static regression plus the live aborting-transaction proof on staging). The column does not merge without the proof.

What the operator is confirming, in one line: the spine ledger gains an optional bin dimension that legacy and WMS-off rows leave NULL, the warehouse total recompute is unchanged, and a test proves the bins always sum back to the warehouse total. Nothing is lost when WMS is off.

Do not write the B2 migration, do not apply it to staging, and do not open the PR until the operator confirms. This is the only place in Body B where you stop and ask before touching schema.

## 5. Verification (the A5/A6/A7 gate set, per phase)

Every phase PR must pass, before the operator reviews:
- `pnpm test:contract` (byte-mirror parity: `_shared/types/wms.ts == lib/types/wms.ts`, `_shared/capabilities.ts == lib/capabilities.ts`, `_shared/constants.ts == lib/constants.ts`). A drift is a release blocker.
- `pnpm typecheck` (TypeScript strict, zero errors).
- `pnpm lint` (max-warnings 0).
- `pnpm test` (full vitest, including the new `db-NNNN-*` static regression test for each migration in the phase, and the updated `sidebarModes.test.ts`).
- `deno check` across ALL edge bundles INCLUDING the new `wms-api`.
- `pnpm build`.
- `size-limit`: the SPA index chunk stays under 40 kB gz; all `/wms/*` pages are `lazy()` so WMS code lands in its own chunks, not the index.
- For B2 specifically: the sum-reconcile proof is mandatory and gating. Static regression PLUS a live aborting-transaction proof on staging that `sum(bin_stock_levels.quantity_on_hand)` per `(warehouse, item)` equals `stock_levels.quantity_on_hand`, and that NULL-location movements sit in the warehouse total but in no bin row. Paste the proof into the PR body.
- Update the audit-superset regression pin: every migration that extends `audit_log_entity_type_check` must keep the corresponding pin test (the `db-0083`-style audit-superset assertion, or whatever the current authoritative pin is) green; add the new entity_types (`warehouse_location`, `putaway_task`, `lot`) to that pin as they land. Confirm the pin's location during build; it asserts the full authoritative list.

Migrations are applied to STAGING ONLY via Supabase MCP `apply_migration` during the build (the MCP stamps timestamp-style version ids; let the post-merge file-based push ship to prod, do not push to prod via MCP). RPCs are validated live on staging in an aborting transaction; the committed db-NNNN tests are static SQL-content checks.

## 6. Reference files to read first

Read these before B0, in this order:
- `supabase/migrations/0030_inventory_warehouses_stock.sql` (the ledger: `stock_movements`, `stock_levels`, `recompute_stock_level`, `trg_stock_movements_recompute`, the AFTER INSERT trigger, the signed-CASE sign convention, the SELECT-only RLS on both tables). This is the heart of B2.
- `supabase/migrations/0053_*` (manufacturing run consume/produce: how a trigger emits movements with `source_entity_type`, positive `quantity`, direction applied at recompute). The model for B3's complete-writes-movement.
- `03-workspace/specs/2026-06-13-3pl-a6-job-runs-handoff.md` plus migrations `0098_job_runs.sql`, `0099_job_run_daily_logs.sql`, `0100_job_runs_numbering.sql` (the phase recipe: table + RLS + audit trigger + FSM RPCs + numbering + the app-layer slice + db-NNNN tests). Clone this per WMS phase.
- `supabase/functions/manufacturing-api/index.ts` (the bundle sibling for `wms-api`: imports, route table shape, `serveBundleWithGate` tail).
- `supabase/functions/_shared/bundleGate.ts` (`serveBundleWithGate`, `bundleGateDispatch`, the 404-on-flag-miss path; read-only).
- `supabase/functions/_shared/constants.ts` and `apps/web/src/lib/constants.ts` (the byte-mirror `FEATURE_FLAGS` pair to edit in B0).
- `.github/workflows/deploy-functions.yml` (the `env.BUNDLES` block to append `wms-api`).
- `supabase/migrations/0064_provision_organization_completeness.sql` (the `seed_org_settings` body to copy-and-extend in B0; confirm it is still the latest redefinition) and `0072_provision_organization_profile_display_name_fix.sql` (`provision_organization`, delegates to `seed_org_settings`, no change needed).
- `supabase/migrations/0089_threepl_accounts.sql` (the config-table audit-trigger template and the Pattern A RLS block, for B1 `warehouse_locations` and B4 `lots`).
- `supabase/migrations/0021_finance_coa.sql` (the nullable self-ref parent FK precedent for `warehouse_locations.parent_location_id`).
- `apps/web/src/routes.ts` (`inferPluginForPath`, `withPluginGate`, `RAW_ROUTES`, the manufacturing/kitforce route blocks; the `/wms` clause and page rows).
- `apps/web/src/auth/RequirePlugin.tsx` (the 404 SPA mirror of the bundle gate).
- `apps/web/src/components/shell/sidebarModes.ts` and `sidebarModes.test.ts` (the new `wms` mode section plus its exact-paths test).
- `03-workspace/specs/2026-06-04-3pl-commercial-pivot-and-wms-pillar-plan.md` (sections 6.1, 6.2, 7) and `docs/adr/0002-spine-plus-addons-and-wms-sixth-addon.md` (the approved direction; do not re-open).

## 7. Follow-ups to carry

- `R-W12-CO-02`: the `stock_movements.location_id` column touches the load-bearing ledger. Carried as the B2 stop-point. Closed when B2 ships with operator confirm plus the sum-reconcile proof.
- `F-Wave12-WMS-B0-01`: WMS chassis (flag, gate, bundle, deploy, sidebar, provisioning seed). Closed by B0.
- `F-Wave12-WMS-B1-01`: locations and bins. Closed by B1.
- `F-Wave12-WMS-B2-01`: stock-movement bin dimension plus `bin_stock_levels` plus reconcile test. Closed by B2 (operator-gated).
- `F-Wave12-WMS-B3-01`: directed putaway. Closed by B3.
- `F-Wave12-WMS-B4-01`: lot and expiration capture plus FEFO groundwork. Closed by B4.

Named not promised (later WMS phases, several need KitLink connectors plus a dependency review; do not build in Phase 1): holds and quarantine (a full holds table beyond the minimal `quarantined` status), cycle counts, wave and pick-path, pack verification, multi-carrier plus manifest plus end-of-day close, yard and dock, returns disposition, serials, slotting. FEFO selection (picking the soonest-expiry lot at consumption) is groundwork-only in B4 (the `expiration_date` index); full FEFO is a later phase. No new top-level dependency in Phase 1; any later phase that needs one triggers the constitution-review checklist.

## 8. House rules (unchanged)

- Brand voice on disk: no em dashes, no double hyphens, no emojis, no stock-photo or generic-gradient talk. Periods, commas, or the middot. Disciplined and declarative. Everything written to disk (migrations, code, journals, PR bodies, this doc) is under the "Built to Ship." voice. Constitution wins for everything written down.
- Byte-mirror pairs are release blockers: `_shared/types/wms.ts == lib/types/wms.ts`, `_shared/capabilities.ts == lib/capabilities.ts`, `_shared/constants.ts == lib/constants.ts`. `pnpm test:contract` asserts.
- Money is BIGINT cents (`_cents` suffix), `roundHalfEven`, never floats. `stock_movements.unit_cost_cents` already follows this; bin rollups carry no new money.
- `requireCap(caller, cap)` on every state-changing handler. 403 FORBIDDEN if denied. The SPA mirrors the role policy for button hiding only; the server is authority.
- Migrations forward-only, four-digit zero-padded, idempotent (`if exists`/`if not exists`, guarded constraint drop-then-add). Never edit a numbered file after apply. Every header declares Wave, Phase, Closes, DOWN MIGRATION (operator-only), date, Constitutional alignment.
- NOT_FOUND, not 403, for cross-tenant: the 3-arg RPC guard raises `NOT_FOUND` when `v_org_id <> p_caller_org_id`; the edge maps `/NOT_FOUND/ -> 404`, `/STATE_CONFLICT/ -> 409`, else `internalError`. The bundle gate and `RequirePlugin` both 404 on a flag miss, never 403.
- `audit_log_entity_type_check` extensions are STRICT SUPERSETS: re-list the full prior enum verbatim plus the new value(s), via guarded drop-then-add, with a `comment on constraint` declaring the authoritative list. `audit_append_state_change` is the only audit write path.
- Stack each phase onto one branch; push when all gates are green; the operator reviews the PR. Every PR cites the risk closed, the follow-up spawned, and the constitutional invariants verified. Wave 12.