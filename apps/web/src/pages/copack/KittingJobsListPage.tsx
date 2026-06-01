import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { EntityLabel } from '@/components/data/EntityLabel';
import { ListEmptyState } from '@/components/shell/ListEmptyState';
import { useKittingJobsList, useSalesOrdersList, useCoPackWarehousesList } from '@/lib/hooks/useCoPack';
import { useVioCapabilities } from '@/lib/hooks/useVioCapabilities';
import { formatDateMedium } from '@/lib/dates';
import type { KittingJobStatus } from '@/lib/types/copack';

/**
 * KittingJobsListPage. Pillar 3 surface. Mirrors ManufacturingRunsListPage.
 *
 * The route is reachable today but the copack-api bundle gates on
 * plugins.copack_ecom and returns 404 for orgs without the flag. The Sidebar
 * entry that lands here is also flag-gated, so unauthorised orgs never see the
 * link. Supports ?status= deep-links from the home status cards.
 */
type StatusFilter = KittingJobStatus | 'all';

const ALLOWED_JOB_STATUSES = new Set<string>([
  'draft',
  'started',
  'completed',
  'cancelled',
]);

function parseJobStatusParam(raw: string | null): StatusFilter {
  if (raw && ALLOWED_JOB_STATUSES.has(raw)) {
    return raw as KittingJobStatus;
  }
  return 'all';
}

export function KittingJobsListPage() {
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState<StatusFilter>(() =>
    parseJobStatusParam(searchParams.get('status')),
  );
  const [warehouseId, setWarehouseId] = useState<string>('');

  const filters = useMemo(() => {
    const f: { status?: StatusFilter; warehouse_id?: string } = {};
    if (status !== 'all') f.status = status;
    if (warehouseId) f.warehouse_id = warehouseId;
    return f;
  }, [status, warehouseId]);

  const jobs = useKittingJobsList(filters);
  const warehouses = useCoPackWarehousesList();
  const orders = useSalesOrdersList();
  const caps = useVioCapabilities();

  const orderNumber = useMemo(() => {
    const map: Record<string, string> = {};
    for (const o of orders.data ?? []) map[o.id] = o.order_number ?? o.id.slice(0, 8);
    return map;
  }, [orders.data]);

  return (
    <section className="px-8 py-12 max-w-6xl mx-auto flex flex-col gap-6">
      <header className="flex items-center justify-between">
        <h1 className="text-4xl font-display tracking-wide text-ink">KITTING JOBS</h1>
        {caps.can('copack.kitting_job.create') ? (
          <Link
            to="/copack/kitting/new"
            className="px-4 py-2 bg-accent text-on-primary font-sans text-sm"
          >
            New kitting job
          </Link>
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

      {jobs.isLoading ? <p className="text-ink-dim">Loading.</p> : null}
      {jobs.error ? (
        <p className="text-accent font-sans text-sm">
          {jobs.error instanceof Error ? jobs.error.message : 'Failed to load kitting jobs.'}
        </p>
      ) : null}

      {!jobs.isLoading && (jobs.data ?? []).length === 0 && status === 'all' && !warehouseId ? (
        <ListEmptyState
          entity="kitting job"
          explainer="Kitting jobs assemble finished kits from their component items."
          addLabel="Add kitting job"
          addTo="/copack/kitting/new"
          canAdd={caps.can('copack.kitting_job.create')}
        />
      ) : (
        <table className="w-full border border-line text-sm font-sans">
          <thead className="bg-bg-2 text-left text-ink-dim">
            <tr>
              <th className="px-4 py-2">Job</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Sales order</th>
              <th className="px-4 py-2">Warehouse</th>
              <th className="px-4 py-2">Planned start</th>
              <th className="px-4 py-2">Created</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {(jobs.data ?? []).length === 0 && !jobs.isLoading ? (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-ink-dim text-sm">
                  No kitting jobs match the current filters.
                </td>
              </tr>
            ) : (
              (jobs.data ?? []).map((j) => (
                <tr key={j.id} className="border-t border-line">
                  <td className="px-4 py-2">
                    <Link to={`/copack/kitting/${j.id}`} className="text-ink underline">
                      {j.job_number ?? j.id.slice(0, 8)}
                    </Link>
                  </td>
                  <td className="px-4 py-2">
                    <span className="inline-block px-2 py-0.5 border border-line text-xs font-mono uppercase text-ink-dim">
                      {j.status}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-ink-dim">
                    {j.sales_order_id ? (orderNumber[j.sales_order_id] ?? j.sales_order_id.slice(0, 8)) : '.'}
                  </td>
                  <td className="px-4 py-2 text-ink-dim">
                    {j.warehouse_id ? <EntityLabel kind="copack_warehouse" id={j.warehouse_id} /> : '·'}
                  </td>
                  <td className="px-4 py-2 text-ink-dim">{formatDateMedium(j.planned_start_at)}</td>
                  <td className="px-4 py-2 text-ink-dim">{formatDateMedium(j.created_at)}</td>
                  <td className="px-4 py-2">
                    <Link to={`/copack/kitting/${j.id}`} className="text-ink underline text-xs">
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
