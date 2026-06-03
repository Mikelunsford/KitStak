// KittingJobsListPage. Migrated to the shared UI kit (F-Wave10-UI-KIT-01):
// PageHeader + FilterBar + Select + DataTable + StatusBadge + Pagination replace
// the hand-rolled header, dual filter selects, inline status pill, and table.
// Behavior preserved: the create CTA stays gated on copack.kitting_job.create,
// the ?status= deep-link still seeds the status filter, both status and
// warehouse filters drive the server query, and the onboarding empty state is
// unchanged. The redundant trailing "View" link column is dropped (the job
// number is already a link to the same detail page).

import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { EntityLabel } from '@/components/data/EntityLabel';
import { ListEmptyState } from '@/components/shell/ListEmptyState';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { FilterBar, type FilterChip } from '@/components/ui/FilterBar';
import { Select } from '@/components/ui/Select';
import { DataTable, type DataColumn } from '@/components/ui/DataTable';
import { Pagination, paginate } from '@/components/ui/Pagination';
import { StatusBadge, humaniseStatus } from '@/components/ui/StatusBadge';
import { useKittingJobsList, useSalesOrdersList, useCoPackWarehousesList } from '@/lib/hooks/useCoPack';
import { useVioCapabilities } from '@/lib/hooks/useVioCapabilities';
import { formatDateMedium } from '@/lib/dates';
import type { KittingJob, KittingJobStatus } from '@/lib/types/copack';

const PAGE_SIZE = 50;

type StatusFilter = KittingJobStatus | 'all';

const JOB_STATUSES: ReadonlyArray<KittingJobStatus> = [
  'draft',
  'started',
  'completed',
  'cancelled',
];

const ALLOWED_JOB_STATUSES = new Set<string>(JOB_STATUSES);

function parseJobStatusParam(raw: string | null): StatusFilter {
  if (raw && ALLOWED_JOB_STATUSES.has(raw)) return raw as KittingJobStatus;
  return 'all';
}

export function KittingJobsListPage() {
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState<StatusFilter>(() =>
    parseJobStatusParam(searchParams.get('status')),
  );
  const [warehouseId, setWarehouseId] = useState<string>('');
  const [page, setPage] = useState(0);

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

  const warehouseName = useMemo(() => {
    const map: Record<string, string> = {};
    for (const w of warehouses.data ?? []) map[w.id] = `${w.code} · ${w.display_name}`;
    return map;
  }, [warehouses.data]);

  const columns: ReadonlyArray<DataColumn<KittingJob>> = useMemo(
    () => [
      {
        key: 'job',
        header: 'Job',
        cellClassName: 'font-mono',
        render: (j) => (
          <Link to={`/copack/kitting/${j.id}`} className="text-ink hover:text-accent">
            {j.job_number ?? j.id.slice(0, 8)}
          </Link>
        ),
      },
      {
        key: 'status',
        header: 'Status',
        render: (j) => <StatusBadge status={j.status} />,
      },
      {
        key: 'order',
        header: 'Sales order',
        cellClassName: 'text-ink-dim',
        render: (j) =>
          j.sales_order_id ? orderNumber[j.sales_order_id] ?? j.sales_order_id.slice(0, 8) : '·',
      },
      {
        key: 'warehouse',
        header: 'Warehouse',
        cellClassName: 'text-ink-dim',
        render: (j) =>
          j.warehouse_id ? <EntityLabel kind="copack_warehouse" id={j.warehouse_id} /> : '·',
      },
      {
        key: 'planned',
        header: 'Planned start',
        cellClassName: 'text-ink-dim',
        render: (j) => formatDateMedium(j.planned_start_at),
      },
      {
        key: 'created',
        header: 'Created',
        cellClassName: 'text-ink-dim',
        render: (j) => formatDateMedium(j.created_at),
      },
    ],
    [orderNumber],
  );

  function applyStatus(next: StatusFilter) {
    setStatus(next);
    setPage(0);
  }
  function applyWarehouse(next: string) {
    setWarehouseId(next);
    setPage(0);
  }

  const rows = jobs.data ?? [];
  const totalCount = rows.length;
  const { sliceStart, sliceEnd } = paginate(totalCount, PAGE_SIZE, page);
  const pageRows = rows.slice(sliceStart, sliceEnd);

  const chips: FilterChip[] = [
    ...(status !== 'all'
      ? [{ key: 'status', label: `Status: ${humaniseStatus(status)}`, onClear: () => applyStatus('all') }]
      : []),
    ...(warehouseId
      ? [
          {
            key: 'warehouse',
            label: `Warehouse: ${warehouseName[warehouseId] ?? warehouseId.slice(0, 8)}`,
            onClear: () => applyWarehouse(''),
          },
        ]
      : []),
  ];

  const showOnboardingEmpty =
    !jobs.isLoading && !jobs.error && totalCount === 0 && status === 'all' && !warehouseId;

  const meta =
    !jobs.isLoading && !jobs.error
      ? `${totalCount} ${totalCount === 1 ? 'kitting job' : 'kitting jobs'}`
      : undefined;

  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-6 px-8 py-12">
      <PageHeader
        eyebrow="Make / Kitting Jobs"
        title="Kitting Jobs"
        meta={meta}
        actions={
          caps.can('copack.kitting_job.create') ? (
            <Link to="/copack/kitting/new">
              <Button variant="primary">New kitting job</Button>
            </Link>
          ) : null
        }
      />

      <FilterBar chips={chips}>
        <label className="flex items-center gap-2">
          <span className="font-sans text-xs uppercase tracking-wide text-ink-dim">Status</span>
          <Select
            value={status}
            onChange={(e) => applyStatus(e.target.value as StatusFilter)}
            aria-label="Filter by status"
          >
            <option value="all">All statuses</option>
            {JOB_STATUSES.map((s) => (
              <option key={s} value={s}>
                {humaniseStatus(s)}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex items-center gap-2">
          <span className="font-sans text-xs uppercase tracking-wide text-ink-dim">Warehouse</span>
          <Select
            value={warehouseId}
            onChange={(e) => applyWarehouse(e.target.value)}
            disabled={warehouses.isLoading}
            aria-label="Filter by warehouse"
          >
            <option value="">All warehouses</option>
            {(warehouses.data ?? []).map((w) => (
              <option key={w.id} value={w.id}>
                {w.code} · {w.display_name}
              </option>
            ))}
          </Select>
        </label>
      </FilterBar>

      {jobs.error ? (
        <p className="font-sans text-sm text-accent">
          {jobs.error instanceof Error ? jobs.error.message : 'Failed to load kitting jobs.'}
        </p>
      ) : showOnboardingEmpty ? (
        <ListEmptyState
          entity="kitting job"
          explainer="Kitting jobs assemble finished kits from their component items."
          addLabel="Add kitting job"
          addTo="/copack/kitting/new"
          canAdd={caps.can('copack.kitting_job.create')}
        />
      ) : (
        <>
          <DataTable
            columns={columns}
            rows={pageRows}
            getRowKey={(j) => j.id}
            loading={jobs.isLoading}
            empty="No kitting jobs match the current filters."
          />
          {totalCount > PAGE_SIZE ? (
            <Pagination
              page={page}
              totalCount={totalCount}
              pageSize={PAGE_SIZE}
              onPageChange={setPage}
            />
          ) : null}
        </>
      )}
    </section>
  );
}
