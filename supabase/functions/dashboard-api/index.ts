// dashboard-api: GET /dashboard/summary, GET /kitcost/summary
//
// Returns aggregate KPIs. All queries are scoped to caller.orgId.
//
// /dashboard/summary is the existing org-wide tile bag.
// /kitcost/summary is the Path C / C1 KitCost pillar report. Both live in
// this bundle because they are summary-style aggregate reads with no shared
// mutation surface; one bundle keeps deploy-functions short.

import { route, type Route } from '../_shared/route.ts';
import { admin, requireCap } from '../_shared/handler-helpers.ts';
import { ok } from '../_shared/responses.ts';
import { requireCaller } from '../_shared/tenant.ts';
import { roundHalfEven } from '../_shared/money.ts';
import type {
  DashboardSummary,
  KitCostSummary,
} from '../_shared/types/cross_cutting.ts';

const BUNDLE = 'dashboard-api';

async function countTable(
  client: ReturnType<typeof admin>,
  table: string,
  orgId: string,
  filters: Array<[string, string]>,
): Promise<number> {
  let q = client.from(table).select('id', { count: 'exact', head: true }).eq('org_id', orgId);
  for (const [col, val] of filters) {
    q = q.eq(col, val);
  }
  const { count, error } = await q;
  if (error) return 0;
  return count ?? 0;
}

// UX-Q5 helper. Counts rows whose status column matches any of the provided
// states, ignoring soft-deleted rows. Matches the work-card predicates
// declared in the UX revision spec. Falls back to 0 on any error (e.g. an
// upstream table missing) so the dashboard never 500s on a fresh org.
async function countByStates(
  client: ReturnType<typeof admin>,
  table: string,
  statusColumn: string,
  orgId: string,
  states: ReadonlyArray<string>,
): Promise<number> {
  let q = client
    .from(table)
    .select('id', { count: 'exact', head: true })
    .eq('org_id', orgId)
    .in(statusColumn, states)
    .is('deleted_at', null);
  const { count, error } = await q;
  if (error) return 0;
  return count ?? 0;
}

// Setup checklist helper. Returns true if at least one row exists for the
// org matching the optional filters. `head: true` keeps the round-trip
// payload at zero bytes. Soft-delete aware via the deleted_at NULL guard.
// Falls back to false on any error so the dashboard never 500s on a fresh
// org missing an upstream table.
// The filter-builder type that flows through applyFilters. `from(table)`
// returns a PostgrestQueryBuilder, but `.select(...).eq(...)` narrows it to a
// PostgrestFilterBuilder, which is what every callsite chains (.is/.in/.eq/
// .not). The previous param type was the query-builder (the `from` return),
// which is why every callsite tripped TS2339 on the filter methods. Widen the
// param to the filter-builder type produced by the org-scoped select chain so
// the helper matches the runtime value. OrgScopedQuery captures the exact
// local builder so the reassignment round-trips without a row-shape mismatch.
type OrgScopedQuery = ReturnType<typeof buildOrgScopedQuery>;
type OrgScopedFilter = (q: OrgScopedQuery) => OrgScopedQuery;

function buildOrgScopedQuery(
  client: ReturnType<typeof admin>,
  table: string,
  orgId: string,
) {
  return client
    .from(table)
    .select('id', { count: 'exact', head: true })
    .eq('org_id', orgId);
}

async function existsRowForOrg(
  client: ReturnType<typeof admin>,
  table: string,
  orgId: string,
  applyFilters: OrgScopedFilter = (q) => q,
): Promise<boolean> {
  try {
    let q = buildOrgScopedQuery(client, table, orgId);
    q = applyFilters(q);
    const { count, error } = await q;
    if (error) return false;
    return (count ?? 0) > 0;
  } catch (err) {
    // E2: log the swallowed catch instead of dropping it. The false
    // fallback keeps the setup-checklist signal off (never 500s a fresh
    // org missing an upstream table), but the context is preserved.
    console.error('dashboard.exists_row.fallback', {
      org_id: orgId,
      table,
      detail: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

async function sumColumn(
  client: ReturnType<typeof admin>,
  table: string,
  column: string,
  orgId: string,
  filters: Array<[string, string]>,
): Promise<bigint> {
  let q = client.from(table).select(column).eq('org_id', orgId);
  for (const [col, val] of filters) {
    q = q.eq(col, val);
  }
  const { data, error } = await q;
  if (error || !data) return 0n;
  let total = 0n;
  for (const row of data as unknown as Array<Record<string, unknown>>) {
    const v = row[column];
    if (typeof v === 'string') total += BigInt(v);
    else if (typeof v === 'number') total += BigInt(Math.trunc(v));
  }
  return total;
}

// Staff role codes that count as "invited a teammate". org_owner is
// intentionally excluded because every org has exactly one org_owner
// auto-created by provision_organization (migration 0064); counting that
// row would make setup_team_invited true from day one, defeating the
// purpose of the checklist signal.
const STAFF_ROLE_CODES_EXCLUDING_OWNER: ReadonlyArray<string> = [
  'org_admin',
  'sales',
  'ops',
  'accounting',
  'viewer',
];

// Resolve the role ids matching STAFF_ROLE_CODES_EXCLUDING_OWNER. Cached per
// request, not per module: roles is a global table with stable ids, but the
// edge function is stateless across requests and the lookup is six rows. The
// cheap query keeps the dashboard handler readable.
async function resolveStaffRoleIdsExcludingOwner(
  client: ReturnType<typeof admin>,
): Promise<string[]> {
  const { data, error } = await client
    .from('roles')
    .select('id,code')
    .in('code', STAFF_ROLE_CODES_EXCLUDING_OWNER);
  if (error || !data) return [];
  return (data as Array<{ id: string }>).map((r) => r.id);
}

const summary: Route = {
  method: 'GET',
  path: '/dashboard/summary',
  async handler({ req }) {
    const caller = requireCaller(req);
    requireCap(caller, 'dashboard.summary.read');
    const client = admin();
    const orgId = caller.orgId;
    const staffRoleIdsExcludingOwner =
      await resolveStaffRoleIdsExcludingOwner(client);

    // Each helper tolerates a missing parent table by returning 0; that
    // keeps the bundle deployable even when an upstream agent's migration
    // has not yet been applied.
    //
    // UX-Q5: the four `*_work_card_count` fields back the dashboard work
    // cards. Predicates per the UX revision spec:
    //   - quotes_awaiting_approval_count: state IN ('submitted',
    //     'revise_requested') AND deleted_at IS NULL
    //   - runs_in_production_count: status = 'started' AND deleted_at IS NULL
    //     (manufacturing_runs has no 'in_progress'; 'started' covers the
    //     working state per ManufacturingRunStatusSchema)
    //   - shipments_ready_to_ship_count: status IN ('created','picking')
    //     AND deleted_at IS NULL
    //   - unpaid_invoices_count: status IN ('sent','partially_paid',
    //     'overdue') AND deleted_at IS NULL
    const [
      openInvoices,
      overdueInvoices,
      openQuotes,
      inFlightReceiving,
      inFlightShipments,
      activeProjects,
      arBalance,
      quotesAwaitingApproval,
      runsInProduction,
      shipmentsReadyToShip,
      unpaidInvoices,
      // Setup checklist signals. Each derived from EXISTS on the matching
      // table. setup_warehouse_added is true from day one for any org
      // provisioned after migration 0064 (seed_org_default_warehouse runs
      // at provision); the SetupChecklist UI explains the default warehouse
      // and points to Library to rename.
      setupWarehouseAdded,
      setupCustomerAdded,
      setupItemAdded,
      setupQuoteCreated,
      setupReceivingReceived,
      setupInvoiceSent,
      setupPaymentReceived,
      setupTeamInvited,
    ] = await Promise.all([
      countTable(client, 'invoices', orgId, [['status', 'open']]).catch(() => 0),
      countTable(client, 'invoices', orgId, [['status', 'overdue']]).catch(() => 0),
      // quotes and projects key their lifecycle off a `state` column, not
      // `status`. The old [['status','open'|'active']] predicates matched a
      // non-existent column value and silently returned 0 (open_quotes_count /
      // active_projects_count). Count the non-terminal states off `state`:
      // open quotes = everything except converted (project_pending) and
      // cancelled; active projects = everything except completed and cancelled.
      countByStates(client, 'quotes', 'state', orgId, [
        'draft',
        'submitted',
        'approved',
        'revise_requested',
      ]).catch(() => 0),
      countTable(client, 'receiving_orders', orgId, [['status', 'in_progress']]).catch(() => 0),
      countTable(client, 'shipments', orgId, [['status', 'in_transit']]).catch(() => 0),
      countByStates(client, 'projects', 'state', orgId, [
        'pending',
        'ready_to_build',
        'in_production',
        'ready_to_ship',
      ]).catch(() => 0),
      sumColumn(client, 'invoices', 'balance_cents', orgId, [['status', 'open']]).catch(() => 0n),
      countByStates(client, 'quotes', 'state', orgId, [
        'submitted',
        'revise_requested',
      ]).catch(() => 0),
      countByStates(client, 'manufacturing_runs', 'status', orgId, [
        'started',
      ]).catch(() => 0),
      countByStates(client, 'shipments', 'status', orgId, [
        'created',
        'picking',
      ]).catch(() => 0),
      countByStates(client, 'invoices', 'status', orgId, [
        'sent',
        'partially_paid',
        'overdue',
      ]).catch(() => 0),
      existsRowForOrg(client, 'warehouses', orgId, (q) =>
        q.is('deleted_at', null),
      ),
      existsRowForOrg(client, 'customers', orgId, (q) =>
        q.is('deleted_at', null),
      ),
      existsRowForOrg(client, 'items', orgId, (q) => q.is('deleted_at', null)),
      existsRowForOrg(client, 'quotes', orgId, (q) =>
        q.is('deleted_at', null),
      ),
      existsRowForOrg(client, 'receiving_orders', orgId, (q) =>
        q.in('status', ['received', 'completed']).is('deleted_at', null),
      ),
      existsRowForOrg(client, 'invoices', orgId, (q) =>
        q.not('sent_at', 'is', null).is('deleted_at', null),
      ),
      existsRowForOrg(client, 'payments', orgId, (q) =>
        q.is('deleted_at', null),
      ),
      // setup_team_invited: at least one active org_membership exists whose
      // role_id is NOT org_owner. Every org has exactly one org_owner created
      // at provisioning, so any membership with a non-owner role_id indicates
      // the operator has invited a teammate. When the role lookup returns an
      // empty list (test fixtures, transient failure), the call resolves
      // false rather than 500ing the dashboard.
      staffRoleIdsExcludingOwner.length === 0
        ? Promise.resolve(false)
        : existsRowForOrg(client, 'org_memberships', orgId, (q) =>
            q.eq('is_active', true).in('role_id', staffRoleIdsExcludingOwner),
          ),
    ]);

    // Resolve currency from org default.
    const { data: org } = await client
      .from('organizations')
      .select('default_currency_code')
      .eq('id', orgId)
      .maybeSingle();
    const currency = (org?.default_currency_code as string | undefined) ?? 'USD';

    const out: DashboardSummary = {
      open_invoices_count: openInvoices,
      overdue_invoices_count: overdueInvoices,
      open_quotes_count: openQuotes,
      in_flight_receiving_count: inFlightReceiving,
      in_flight_shipments_count: inFlightShipments,
      active_projects_count: activeProjects,
      ar_balance_cents: arBalance.toString(),
      currency_code: currency,
      // UX-Q5 work-card counts.
      quotes_awaiting_approval_count: quotesAwaitingApproval,
      runs_in_production_count: runsInProduction,
      shipments_ready_to_ship_count: shipmentsReadyToShip,
      unpaid_invoices_count: unpaidInvoices,
      // Setup checklist signals.
      setup_warehouse_added: setupWarehouseAdded,
      setup_customer_added: setupCustomerAdded,
      setup_item_added: setupItemAdded,
      setup_quote_created: setupQuoteCreated,
      setup_receiving_received: setupReceivingReceived,
      setup_invoice_sent: setupInvoiceSent,
      setup_payment_received: setupPaymentReceived,
      setup_team_invited: setupTeamInvited,
    };
    return ok(out);
  },
};

// ---------------------------------------------------------------------------
// KitCost pillar (Path C / C1)
//
// Read-only aggregate. Returns the four KitCost dashboard panels in a single
// payload so the SPA renders the page with one round-trip:
//   - kpis (4 scalar tiles)
//   - revenue_trend (last 12 months of paid invoice totals, oldest first)
//   - top_customers (top 5 by lifetime paid-invoice revenue)
//   - project_margins (top 10 projects by revenue; revenue from paid
//     invoices linked to the project, cost from project-linked items
//     consumed on stock_movements at unit_cost_cents)
//
// Cost note: expenses has no project_id column today, so per-project cost
// uses inventory-consumed cost only (stock_movements.qty * items.unit_cost).
// If/when expenses grow a project_id, fold expenses into cost here.
//
// All amounts cross the wire as BIGINT cents (string, to survive JS
// Number.MAX_SAFE_INTEGER). All queries are org-scoped (Pattern A).
// ---------------------------------------------------------------------------

function startOfYearUTC(now: Date = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), 0, 1)).toISOString();
}

function startOfMonthUTC(now: Date = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

function ymKey(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function twelveMonthBuckets(now: Date = new Date()): string[] {
  const out: string[] = [];
  // Walk back 11 months from the current month so the array length is 12
  // and the current month is the last entry (oldest first).
  for (let i = 11; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    out.push(ymKey(d));
  }
  return out;
}

function asBig(v: unknown): bigint {
  if (typeof v === 'string') {
    try {
      return BigInt(v);
    } catch {
      return 0n;
    }
  }
  if (typeof v === 'number') return BigInt(Math.trunc(v));
  return 0n;
}

function asNum(v: unknown): number {
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  return 0;
}

const kitcostSummary: Route = {
  method: 'GET',
  path: '/kitcost/summary',
  async handler({ req }) {
    const caller = requireCaller(req);
    requireCap(caller, 'kitcost.dashboard.view');
    const client = admin();
    const orgId = caller.orgId;

    const now = new Date();
    const yearStart = startOfYearUTC(now);
    const monthStart = startOfMonthUTC(now);
    // Twelve-month window starts at the first of the month, 11 months ago.
    const trendStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1),
    ).toISOString();

    // ---- Pull the slices we need, in parallel where independent. ----
    const [paidYtdRes, invoicedMonthRes, activeProjectsCount, trendInvoicesRes, allPaidRes] =
      await Promise.all([
        client
          .from('invoices')
          .select('total_cents')
          .eq('org_id', orgId)
          .eq('status', 'paid')
          .gte('issue_date', yearStart.slice(0, 10))
          .then((r) => r),
        client
          .from('invoices')
          .select('total_cents')
          .eq('org_id', orgId)
          .gte('issue_date', monthStart.slice(0, 10))
          .then((r) => r),
        client
          .from('projects')
          .select('id', { count: 'exact', head: true })
          .eq('org_id', orgId)
          .in('state', ['ready_to_build', 'in_production', 'ready_to_ship'])
          .then((r) => r),
        client
          .from('invoices')
          .select('issue_date,total_cents')
          .eq('org_id', orgId)
          .eq('status', 'paid')
          .gte('issue_date', trendStart.slice(0, 10))
          .then((r) => r),
        client
          .from('invoices')
          .select('customer_id,project_id,total_cents')
          .eq('org_id', orgId)
          .eq('status', 'paid')
          .then((r) => r),
      ]);

    // KPI 1: total revenue YTD (paid only)
    let totalRevenueYtd = 0n;
    for (const row of (paidYtdRes.data ?? []) as Array<Record<string, unknown>>) {
      totalRevenueYtd += asBig(row.total_cents);
    }

    // KPI 2: invoiced this month (all statuses)
    let invoicedThisMonth = 0n;
    for (const row of (invoicedMonthRes.data ?? []) as Array<Record<string, unknown>>) {
      invoicedThisMonth += asBig(row.total_cents);
    }

    // KPI 3: active projects (in any working state)
    const activeProjects = (activeProjectsCount.count as number | null) ?? 0;

    // KPI 4: inventory value = SUM(stock_levels.quantity_on_hand *
    //   cost_cents) over the org. Cost source is items.unit_cost_cents
    //   if non-null on the catalog, falling back to the most recent
    //   receiving_order_line_items.unit_cost_cents for that item if the
    //   catalog row has no cost set. The receiving fallback was added
    //   for BNEW-6 (2026-05-22 v2 smoke walk) because v1 operators set
    //   the unit cost on the receiving line, not on the catalog row,
    //   and the KPI would otherwise stay at $0.00 even with valued
    //   stock on hand. Two tables are joined client-side via an item id
    //   lookup; the dataset is small for v1 operators.
    let inventoryValue = 0n;
    try {
      const { data: levels } = await client
        .from('stock_levels')
        .select('item_id,quantity_on_hand')
        .eq('org_id', orgId);
      const levelRows = (levels ?? []) as Array<Record<string, unknown>>;
      const itemIds = Array.from(
        new Set(levelRows.map((r) => r.item_id as string).filter(Boolean)),
      );
      if (itemIds.length > 0) {
        const { data: items } = await client
          .from('items')
          .select('id,unit_cost_cents,supply_source')
          .eq('org_id', orgId)
          .in('id', itemIds);
        // Material the org neither owns nor pays for rolls up as zero org cost
        // (migration 0120). Map these items to 0 so they neither seed a catalog
        // cost nor fall through to the receiving fallback below.
        const zeroCostSources = new Set([
          'customer_supplied',
          'third_party_consigned',
        ]);
        const costByItem = new Map<string, bigint>();
        for (const it of (items ?? []) as Array<Record<string, unknown>>) {
          const id = it.id as string;
          if (zeroCostSources.has(it.supply_source as string)) {
            costByItem.set(id, 0n);
            continue;
          }
          // Only seed from catalog when unit_cost_cents is non-null; a
          // null catalog cost should fall through to the receiving
          // fallback below.
          if (it.unit_cost_cents !== null && it.unit_cost_cents !== undefined) {
            costByItem.set(id, asBig(it.unit_cost_cents));
          }
        }
        // BNEW-6: fall back to receiving_order_line_items.unit_cost_cents
        // for any item that still has no cost mapped. The receiving line
        // captures what the operator actually paid, which is the cost
        // they expect to see reflected in the inventory value KPI.
        const missingIds = itemIds.filter((id) => !costByItem.has(id));
        if (missingIds.length > 0) {
          const { data: rliRows } = await client
            .from('receiving_order_line_items')
            .select('item_id,unit_cost_cents,created_at')
            .eq('org_id', orgId)
            .in('item_id', missingIds);
          // Pick the most recent non-null cost per item.
          const latestByItem = new Map<
            string,
            { cost: bigint; createdAt: string }
          >();
          for (const row of (rliRows ?? []) as Array<Record<string, unknown>>) {
            const itemId = row.item_id as string | null;
            const cost = row.unit_cost_cents;
            if (!itemId) continue;
            if (cost === null || cost === undefined) continue;
            const createdAt = (row.created_at as string | null) ?? '';
            const prior = latestByItem.get(itemId);
            if (!prior || createdAt > prior.createdAt) {
              latestByItem.set(itemId, { cost: asBig(cost), createdAt });
            }
          }
          for (const [itemId, entry] of latestByItem) {
            costByItem.set(itemId, entry.cost);
          }
        }
        for (const lv of levelRows) {
          const qty = asNum(lv.quantity_on_hand);
          const cost = costByItem.get(lv.item_id as string) ?? 0n;
          // A3/A4: banker's rounding on the product to avoid drift on
          // fractional qty (Math.round is half-up and is not banker's).
          const product = qty * Number(cost);
          inventoryValue += BigInt(roundHalfEven(product));
        }
      }
    } catch (err) {
      console.error('dashboard.inventory_value.fallback', {
        org_id: orgId,
        detail: err instanceof Error ? err.message : String(err),
      });
      inventoryValue = 0n;
    }

    // Revenue trend: bucket paid invoices by YYYY-MM over the last 12 months.
    const buckets = twelveMonthBuckets(now);
    const trendMap = new Map<string, bigint>(buckets.map((b) => [b, 0n]));
    for (const row of (trendInvoicesRes.data ?? []) as Array<Record<string, unknown>>) {
      const issued = row.issue_date as string | null;
      if (!issued) continue;
      const key = issued.slice(0, 7); // YYYY-MM from a YYYY-MM-DD date column
      if (trendMap.has(key)) {
        trendMap.set(key, (trendMap.get(key) ?? 0n) + asBig(row.total_cents));
      }
    }
    const revenue_trend = buckets.map((b) => ({
      month: b,
      revenue_cents: (trendMap.get(b) ?? 0n).toString(),
    }));

    // Top customers: group all paid invoices by customer_id, sum total_cents,
    // sort desc, take 5, resolve display names.
    const paidRows = (allPaidRes.data ?? []) as Array<Record<string, unknown>>;
    const revByCustomer = new Map<string, bigint>();
    for (const row of paidRows) {
      const cid = row.customer_id as string | null;
      if (!cid) continue;
      revByCustomer.set(cid, (revByCustomer.get(cid) ?? 0n) + asBig(row.total_cents));
    }
    const topCustomerIds = Array.from(revByCustomer.entries())
      .sort((a, b) => (a[1] > b[1] ? -1 : a[1] < b[1] ? 1 : 0))
      .slice(0, 5);

    let nameByCustomer = new Map<string, string>();
    if (topCustomerIds.length > 0) {
      const { data: cust } = await client
        .from('customers')
        .select('id,display_name')
        .eq('org_id', orgId)
        .in('id', topCustomerIds.map(([id]) => id));
      nameByCustomer = new Map(
        ((cust ?? []) as Array<Record<string, unknown>>).map((c) => [
          c.id as string,
          (c.display_name as string | null) ?? '',
        ]),
      );
    }
    const top_customers = topCustomerIds.map(([id, cents]) => ({
      customer_id: id,
      customer_name: nameByCustomer.get(id) ?? '',
      revenue_cents: cents.toString(),
    }));

    // Project margins: per project (where project_id non-null), revenue
    // is SUM of paid invoice totals. Cost is SUM of stock_movements x
    // items.unit_cost_cents for the same project (movement direction =
    // 'out' / 'consume'). Top 10 by revenue.
    const revByProject = new Map<string, bigint>();
    for (const row of paidRows) {
      const pid = row.project_id as string | null;
      if (!pid) continue;
      revByProject.set(pid, (revByProject.get(pid) ?? 0n) + asBig(row.total_cents));
    }
    const topProjectIds = Array.from(revByProject.entries())
      .sort((a, b) => (a[1] > b[1] ? -1 : a[1] < b[1] ? 1 : 0))
      .slice(0, 10)
      .map(([id]) => id);

    let projectNames = new Map<string, string>();
    if (topProjectIds.length > 0) {
      const { data: proj } = await client
        .from('projects')
        .select('id,name,number')
        .eq('org_id', orgId)
        .in('id', topProjectIds);
      projectNames = new Map(
        ((proj ?? []) as Array<Record<string, unknown>>).map((p) => [
          p.id as string,
          ((p.name as string | null) ?? (p.number as string | null) ?? '') as string,
        ]),
      );
    }

    // Costs per project: query stock_movements joined to items via item_id.
    // The mock harness does not support PostgREST nested selects, so we run
    // two queries: movements first (project_id, item_id, qty), items second
    // (id -> unit_cost_cents), then fold client-side.
    const costByProject = new Map<string, bigint>();
    if (topProjectIds.length > 0) {
      try {
        const { data: moves } = await client
          .from('stock_movements')
          .select('project_id,item_id,quantity,direction')
          .eq('org_id', orgId)
          .in('project_id', topProjectIds);
        const moveRows = (moves ?? []) as Array<Record<string, unknown>>;
        const itemIds = Array.from(
          new Set(moveRows.map((m) => m.item_id as string).filter(Boolean)),
        );
        let costByItem = new Map<string, bigint>();
        if (itemIds.length > 0) {
          const { data: items } = await client
            .from('items')
            .select('id,unit_cost_cents,supply_source')
            .eq('org_id', orgId)
            .in('id', itemIds);
          // Zero org cost for material the org neither owns nor pays for
          // (migration 0120). Keyed off the item default per the supply-source
          // costing decision (the stock_movements ledger carries no per-line
          // override).
          const zeroCostSources = new Set([
            'customer_supplied',
            'third_party_consigned',
          ]);
          costByItem = new Map(
            ((items ?? []) as Array<Record<string, unknown>>).map((it) => [
              it.id as string,
              zeroCostSources.has(it.supply_source as string)
                ? 0n
                : asBig(it.unit_cost_cents),
            ]),
          );
        }
        for (const m of moveRows) {
          // Consumed inventory only (production / outbound). 'in'-direction
          // movements are receiving, which are not a project cost.
          const dir = m.direction as string | null;
          if (dir && dir !== 'out' && dir !== 'consume') continue;
          const pid = m.project_id as string | null;
          if (!pid) continue;
          const qty = asNum(m.quantity);
          const unit = costByItem.get(m.item_id as string) ?? 0n;
          const add = BigInt(roundHalfEven(qty * Number(unit)));
          costByProject.set(pid, (costByProject.get(pid) ?? 0n) + add);
        }
      } catch (err) {
        // Leave the cost map empty on any failure; the SPA renders the row
        // with zero cost rather than a 500.
        console.error('dashboard.project_cost.fallback', {
          org_id: orgId,
          detail: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const project_margins = topProjectIds.map((pid) => {
      const revenue = revByProject.get(pid) ?? 0n;
      const cost = costByProject.get(pid) ?? 0n;
      const margin = revenue - cost;
      // Margin pct as a number with one decimal. Division-by-zero -> 0.
      const pct =
        revenue === 0n
          ? 0
          : Math.round((Number(margin) / Number(revenue)) * 1000) / 10;
      return {
        project_id: pid,
        project_name: projectNames.get(pid) ?? '',
        revenue_cents: revenue.toString(),
        cost_cents: cost.toString(),
        margin_cents: margin.toString(),
        margin_pct: pct,
      };
    });

    const out: KitCostSummary = {
      kpis: {
        total_revenue_ytd_cents: totalRevenueYtd.toString(),
        invoiced_this_month_cents: invoicedThisMonth.toString(),
        active_projects_count: activeProjects,
        inventory_value_cents: inventoryValue.toString(),
      },
      revenue_trend,
      top_customers,
      project_margins,
    };
    return ok(out);
  },
};

Deno.serve((req) => route(req, [summary, kitcostSummary], { bundle: BUNDLE }));

export { summary, kitcostSummary };
