// dashboard-api: GET /dashboard/summary
//
// Returns aggregate KPIs for the dashboard tiles. All queries are scoped to
// caller.orgId. Returns a DashboardSummary object byte-mirrored with
// _shared/types/cross_cutting.ts.

import { route, type Route } from '../_shared/route.ts';
import { admin } from '../_shared/handler-helpers.ts';
import { ApiError, ok } from '../_shared/responses.ts';
import { requireCaller } from '../_shared/tenant.ts';
import { hasCrossCuttingCap } from '../_shared/capabilities/cross_cutting.ts';
import type { DashboardSummary } from '../_shared/types/cross_cutting.ts';

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
  for (const row of data as Array<Record<string, unknown>>) {
    const v = row[column];
    if (typeof v === 'string') total += BigInt(v);
    else if (typeof v === 'number') total += BigInt(Math.trunc(v));
  }
  return total;
}

const summary: Route = {
  method: 'GET',
  path: '/dashboard/summary',
  async handler({ req }) {
    const caller = requireCaller(req);
    if (!hasCrossCuttingCap(caller.role, 'dashboard.summary.read')) {
      throw new ApiError('FORBIDDEN', 403, 'caller lacks capability: dashboard.summary.read');
    }
    const client = admin();
    const orgId = caller.orgId;

    // Each helper tolerates a missing parent table by returning 0; that
    // keeps the bundle deployable even when an upstream agent's migration
    // has not yet been applied.
    const [
      openInvoices,
      overdueInvoices,
      openQuotes,
      inFlightReceiving,
      inFlightShipments,
      activeProjects,
      arBalance,
    ] = await Promise.all([
      countTable(client, 'invoices', orgId, [['status', 'open']]).catch(() => 0),
      countTable(client, 'invoices', orgId, [['status', 'overdue']]).catch(() => 0),
      countTable(client, 'quotes', orgId, [['status', 'open']]).catch(() => 0),
      countTable(client, 'receiving_orders', orgId, [['status', 'in_progress']]).catch(() => 0),
      countTable(client, 'shipments', orgId, [['status', 'in_transit']]).catch(() => 0),
      countTable(client, 'projects', orgId, [['status', 'active']]).catch(() => 0),
      sumColumn(client, 'invoices', 'balance_cents', orgId, [['status', 'open']]).catch(() => 0n),
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
    };
    return ok(out);
  },
};

Deno.serve((req) => route(req, [summary], { bundle: BUNDLE }));

export { summary };
