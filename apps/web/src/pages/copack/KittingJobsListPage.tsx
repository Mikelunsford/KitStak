// KittingJobsListPage. Workstream C of the 2026-06-17 UI scan adds the server
// list toolbar (search on job number, sortable headers, status + warehouse
// facets, keyset pager) behind feature.list_toolbar. The flag-off path is the
// original client-state view, extracted verbatim into KittingJobsListLegacy; the
// flag-on path is KittingJobsListToolbar. The parent renders one or the other.
//
// Earlier migration note (F-Wave10-UI-KIT-01): PageHeader + FilterBar + Select +
// DataTable + StatusBadge + Pagination replaced the hand-rolled header, dual
// filter selects, inline status pill, and table. The legacy body below preserves
// that behavior unchanged.

import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { EntityLabel } from '@/components/data/EntityLabel';
import { LINK_CLASS } from '@/components/data/entityLabelStyles';
import { ListEmptyState } from '@/components/shell/ListEmptyState';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { FilterBar, type FilterChip } from '@/components/ui/FilterBar';
import { ListToolbar } from '@/components/ui/ListToolbar';
import { SavedViewsBar } from '@/components/ui/SavedViewsBar';
import { Select } from '@/components/ui/Select';
import { DataTable, type DataColumn } from '@/components/ui/DataTable';
import { Pagination, paginate } from '@/components/ui/Pagination';
import { CursorPager } from '@/components/ui/CursorPager';
import { StatusBadge, humaniseStatus } from '@/components/ui/StatusBadge';
import { useKittingJobsList, useSalesOrdersList, useCoPackWarehousesList } from '@/lib/hooks/useCoPack';
import { useOrgFlags } from '@/lib/hooks/useOrgFlags';
import { useServerList } from '@/lib/hooks/useServerList';
import { useVioCapabilities } from '@/lib/hooks/useVioCapabilities';
import { listKittingJobsPage } from '@/lib/services/copackService';
import { kittingJobsKeys } from '@/lib/queryKeys/copack';
import { formatDateMedium } from '@/lib/dates';
import { FEATURE_FLAGS } from '@/lib/constants';
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

// Static toolbar columns. Sortable headers map to the edge SORT_COLS allowlist
// (created_at, status). job_number is nullable so it is searchable, not
// sortable. The sales-order number needs a runtime map, so the toolbar view
// shows the short sales-order id instead of carrying a per-page lookup.
const TOOLBAR_COLUMNS: ReadonlyArray<DataColumn<KittingJob>> = [
  {
    key: 'job',
    header: 'Job',
    cellClassName: 'tabular-nums',
    render: (j) => (
      <Link to={`/copack/kitting/${j.id}`} className={LINK_CLASS}>
        {j.job_number ?? j.id.slice(0, 8)}
      </Link>
    ),
  },
  {
    key: 'status',
    header: 'Status',
    sortKey: 'status',
    render: (j) => <StatusBadge status={j.status} />,
  },
  {
    key: 'order',
    header: 'Sales order',
    cellClassName: 'text-ink-dim',
    render: (j) => (j.sales_order_id ? j.sales_order_id.slice(0, 8) : '·'),
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
    sortKey: 'created_at',
    cellClassName: 'text-ink-dim',
    render: (j) => formatDateMedium(j.created_at),
  },
];

export function KittingJobsListPage() {
  const flags = useOrgFlags();
  return flags.data[FEATURE_FLAGS.UI_LIST_TOOLBAR] ? (
    <KittingJobsListToolbar />
  ) : (
    <KittingJobsListLegacy />
  );
}

function KittingJobsListToolbar() {
  const caps = useVioCapabilities();
  const warehouses = useCoPackWarehousesList();
  const server = useServerList<KittingJob>({
    enabled: true,
    queryKeyBase: kittingJobsKeys.all,
    fetchPage: listKittingJobsPage,
    defaultSort: { by: 'created_at', dir: 'desc' },
    facets: [
      { key: 'status', label: 'Status', format: humaniseStatus },
      { key: 'warehouse_id', label: 'Warehouse' },
    ],
  });

  const warehouseName = useMemo(() => {
    const map: Record<string, string> = {};
    for (const w of warehouses.data ?? []) map[w.id] = `${w.code} · ${w.display_name}`;
    return map;
  }, [warehouses.data]);

  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-6 px-8 py-12">
      <PageHeader
        title="Kitting Jobs"
        actions={
          caps.can('copack.kitting_job.create') ? (
            <Link to="/copack/kitting/new">
              <Button variant="primary">New kitting job</Button>
            </Link>
          ) : null
        }
      />

      <ListToolbar
        searchValue={server.searchInput}
        onSearchChange={server.setSearchInput}
        searchPlaceholder="Search job number"
        chips={server.chips.map((chip) =>
          chip.key === 'warehouse_id' && server.facetValues.warehouse_id
            ? {
                ...chip,
                label: `Warehouse: ${
                  warehouseName[server.facetValues.warehouse_id] ??
                  server.facetValues.warehouse_id.slice(0, 8)
                }`,
              }
            : chip,
        )}
        onClearAll={server.clearAll}
      >
        <label className="flex items-center gap-2">
          <span className="font-sans text-xs uppercase tracking-wide text-ink-dim">Status</span>
          <Select
            value={server.facetValues.status ?? ''}
            onChange={(e) => server.setFacet('status', e.target.value)}
            aria-label="Filter by status"
          >
            <option value="">All statuses</option>
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
            value={server.facetValues.warehouse_id ?? ''}
            onChange={(e) => server.setFacet('warehouse_id', e.target.value)}
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
      </ListToolbar>

      <SavedViewsBar
        entityType="kitting_job"
        currentConfig={server.viewConfig}
        onApply={server.applyView}
      />

      {server.isError ? (
        <p className="font-sans text-sm text-accent">Failed to load kitting jobs.</p>
      ) : (
        <>
          <DataTable
            columns={TOOLBAR_COLUMNS}
            rows={server.rows}
            getRowKey={(j) => j.id}
            loading={server.isLoading}
            empty="No kitting jobs match these filters."
            sortBy={server.sortBy}
            sortDir={server.sortDir}
            onSort={server.onSort}
          />
          <CursorPager
            canPrev={server.canPrev}
            canNext={server.canNext}
            onPrev={server.onPrev}
            onNext={server.onNext}
            label={`${server.rows.length} shown`}
          />
        </>
      )}
    </section>
  );
}

function KittingJobsListLegacy() {
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
        cellClassName: 'tabular-nums',
        render: (j) => (
          <Link to={`/copack/kitting/${j.id}`} className={LINK_CLASS}>
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
