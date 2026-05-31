import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { EntityLabel } from '@/components/data/EntityLabel';
import { ListEmptyState } from '@/components/shell/ListEmptyState';
import { useManufacturingRunsList } from '@/lib/hooks/useManufacturing';
import { useWarehousesList } from '@/lib/hooks/useInventory';
import { useVioCapabilities } from '@/lib/hooks/useVioCapabilities';
import type { ManufacturingRunStatus } from '@/lib/types/vendors_inventory_ops';

/**
 * ManufacturingRunsListPage. Path A5 of the Manufacturing wiring plan.
 * Pillar 2 surface. Mirrors ReceivingOrdersListPage shape.
 *
 * The route is reachable today but the manufacturing-api bundle gates on
 * plugins.manufacturing and returns 404 for orgs without the flag. A6 flips
 * the flag for the operator. The Sidebar entry that lands here is also
 * gated, so unauthorised orgs never see the link.
 */
type StatusFilter = ManufacturingRunStatus | 'all';

const ALLOWED_RUN_STATUSES = new Set<string>([
  'draft',
  'started',
  'completed',
  'cancelled',
]);

function parseRunStatusParam(raw: string | null): StatusFilter {
  if (raw && ALLOWED_RUN_STATUSES.has(raw)) {
    return raw as ManufacturingRunStatus;
  }
  return 'all';
}

export function ManufacturingRunsListPage() {
  // UX-Q5: support ?status= deep-links from the dashboard work card
  // ("Runs in production" -> ?status=started). Filter is preserved as
  // local state once the page mounts so the operator can change it.
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState<StatusFilter>(() =>
    parseRunStatusParam(searchParams.get('status')),
  );
  const [warehouseId, setWarehouseId] = useState<string>('');

  const filters = useMemo(() => {
    const f: { status?: StatusFilter; warehouse_id?: string } = {};
    if (status !== 'all') f.status = status;
    if (warehouseId) f.warehouse_id = warehouseId;
    return f;
  }, [status, warehouseId]);

  const runs = useManufacturingRunsList(filters);
  const warehouses = useWarehousesList();
  const caps = useVioCapabilities();

  return (
    <section className="px-8 py-12 max-w-6xl mx-auto flex flex-col gap-6">
      <header className="flex items-center justify-between">
        <h1 className="text-4xl font-display tracking-wide text-ink">MANUFACTURING RUNS</h1>
        {caps.can('manufacturing.run.create') ? (
          <div className="flex gap-2">
            {caps.can('manufacturing.run.line_item.create') ? (
              <Link
                to="/manufacturing/runs/from-bom"
                className="px-4 py-2 border border-line text-ink font-sans text-sm"
              >
                Build from BOM
              </Link>
            ) : null}
            <Link
              to="/manufacturing/runs/new"
              className="px-4 py-2 bg-accent text-on-primary font-sans text-sm"
            >
              New manufacturing run
            </Link>
          </div>
        ) : null}
      </header>

      <div className="flex flex-wrap gap-4 items-end">
        <label className="flex flex-col gap-1">
          <span className="font-sans text-xs text-ink-dim tracking-wide uppercase">Status</span>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as StatusFilter)}
            className="bg-bg-2 border border-line text-ink px-3 py-2 font-sans focus:outline-none focus:border-accent"
          >
            <option value="all">All</option>
            <option value="draft">Draft</option>
            <option value="started">Started</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-sans text-xs text-ink-dim tracking-wide uppercase">Warehouse</span>
          <select
            value={warehouseId}
            onChange={(e) => setWarehouseId(e.target.value)}
            disabled={warehouses.isLoading}
            className="bg-bg-2 border border-line text-ink px-3 py-2 font-sans focus:outline-none focus:border-accent disabled:opacity-50"
          >
            <option value="">All warehouses</option>
            {(warehouses.data ?? []).map((w) => (
              <option key={w.id} value={w.id}>
                {w.code} · {w.display_name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {runs.isLoading ? <p className="text-ink-dim">Loading.</p> : null}
      {runs.error ? (
        <p className="text-accent font-sans text-sm">
          {runs.error instanceof Error ? runs.error.message : 'Failed to load manufacturing runs.'}
        </p>
      ) : null}

      {!runs.isLoading && (runs.data ?? []).length === 0 && status === 'all' && !warehouseId ? (
        <ListEmptyState
          entity="manufacturing run"
          explainer="Manufacturing runs convert raw materials into finished kits."
          addLabel="Add manufacturing run"
          addTo="/manufacturing/runs/new"
          canAdd={caps.can('manufacturing.run.create')}
        />
      ) : (
      <table className="w-full border border-line text-sm font-sans">
        <thead className="bg-bg-2 text-left text-ink-dim">
          <tr>
            <th className="px-4 py-2">Run</th>
            <th className="px-4 py-2">Status</th>
            <th className="px-4 py-2">Project</th>
            <th className="px-4 py-2">Warehouse</th>
            <th className="px-4 py-2">Planned start</th>
            <th className="px-4 py-2">Created</th>
            <th className="px-4 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {(runs.data ?? []).length === 0 && !runs.isLoading ? (
            <tr>
              <td colSpan={7} className="px-4 py-6 text-ink-dim text-sm">
                No manufacturing runs match the current filters.
              </td>
            </tr>
          ) : (
            (runs.data ?? []).map((r) => (
              <tr key={r.id} className="border-t border-line">
                <td className="px-4 py-2">
                  <Link to={`/manufacturing/runs/${r.id}`} className="text-ink underline">
                    {r.run_number ?? r.id.slice(0, 8)}
                  </Link>
                </td>
                <td className="px-4 py-2">
                  <span className="inline-block px-2 py-0.5 border border-line text-xs font-mono uppercase text-ink-dim">
                    {r.status}
                  </span>
                </td>
                <td className="px-4 py-2 text-ink-dim">
                  {r.project_id ? <EntityLabel kind="project" id={r.project_id} /> : '.'}
                </td>
                <td className="px-4 py-2 text-ink-dim">
                  <EntityLabel kind="warehouse" id={r.warehouse_id} />
                </td>
                <td className="px-4 py-2 text-ink-dim">{r.planned_start_at ?? ''}</td>
                <td className="px-4 py-2 text-ink-dim">{r.created_at.slice(0, 10)}</td>
                <td className="px-4 py-2">
                  <Link to={`/manufacturing/runs/${r.id}`} className="text-ink underline text-xs">
                    View
                  </Link>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
      )}
    </section>
  );
}
