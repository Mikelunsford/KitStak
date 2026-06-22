// FulfillmentsListPage. Workstream C of the 2026-06-17 UI scan adds the server
// list toolbar (search on fulfillment number, sortable headers, status facet,
// keyset pager) behind feature.list_toolbar. The flag-off path is the original
// client-state view, extracted verbatim into FulfillmentsListLegacy; the flag-on
// path is FulfillmentsListToolbar. The parent renders one or the other.
//
// Earlier migration note (F-Wave10-UI-KIT-01): PageHeader + FilterBar + Select +
// DataTable + StatusBadge + Pagination replaced the hand-rolled header, status
// select, inline status pill, and table. The legacy body below preserves that
// behavior unchanged.

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
import { useFulfillmentsList, useSalesOrdersList } from '@/lib/hooks/useCoPack';
import { useOrgFlags } from '@/lib/hooks/useOrgFlags';
import { useServerList } from '@/lib/hooks/useServerList';
import { useVioCapabilities } from '@/lib/hooks/useVioCapabilities';
import { listFulfillmentsPage } from '@/lib/services/copackService';
import { fulfillmentsKeys } from '@/lib/queryKeys/copack';
import { formatDateMedium } from '@/lib/dates';
import { FEATURE_FLAGS } from '@/lib/constants';
import type { Fulfillment, FulfillmentStatus } from '@/lib/types/copack';

const PAGE_SIZE = 50;

type StatusFilter = FulfillmentStatus | 'all';

const FULFILLMENT_STATUSES: ReadonlyArray<FulfillmentStatus> = [
  'pending',
  'picking',
  'packed',
  'shipped',
  'cancelled',
];

const ALLOWED_FULFILLMENT_STATUSES = new Set<string>(FULFILLMENT_STATUSES);

function parseFulfillmentStatusParam(raw: string | null): StatusFilter {
  if (raw && ALLOWED_FULFILLMENT_STATUSES.has(raw)) return raw as FulfillmentStatus;
  return 'all';
}

// Static toolbar columns. Sortable headers map to the edge SORT_COLS allowlist
// (created_at, status). fulfillment_number is nullable so it is searchable, not
// sortable. The sales-order number needs a runtime map, so the toolbar view
// shows the short sales-order id instead of carrying a per-page lookup.
const TOOLBAR_COLUMNS: ReadonlyArray<DataColumn<Fulfillment>> = [
  {
    key: 'fulfillment',
    header: 'Fulfillment',
    cellClassName: 'tabular-nums',
    render: (f) => (
      <Link to={`/copack/fulfillments/${f.id}`} className={LINK_CLASS}>
        {f.fulfillment_number ?? f.id.slice(0, 8)}
      </Link>
    ),
  },
  {
    key: 'status',
    header: 'Status',
    sortKey: 'status',
    render: (f) => <StatusBadge status={f.status} />,
  },
  {
    key: 'order',
    header: 'Sales order',
    cellClassName: 'text-ink-dim',
    render: (f) => f.sales_order_id.slice(0, 8),
  },
  {
    key: 'warehouse',
    header: 'Warehouse',
    cellClassName: 'text-ink-dim',
    render: (f) =>
      f.warehouse_id ? <EntityLabel kind="copack_warehouse" id={f.warehouse_id} /> : '·',
  },
  {
    key: 'created',
    header: 'Created',
    sortKey: 'created_at',
    cellClassName: 'text-ink-dim',
    render: (f) => formatDateMedium(f.created_at),
  },
];

export function FulfillmentsListPage() {
  const flags = useOrgFlags();
  return flags.data[FEATURE_FLAGS.UI_LIST_TOOLBAR] ? (
    <FulfillmentsListToolbar />
  ) : (
    <FulfillmentsListLegacy />
  );
}

function FulfillmentsListToolbar() {
  const caps = useVioCapabilities();
  const server = useServerList<Fulfillment>({
    enabled: true,
    queryKeyBase: fulfillmentsKeys.all,
    fetchPage: listFulfillmentsPage,
    defaultSort: { by: 'created_at', dir: 'desc' },
    facets: [{ key: 'status', label: 'Status', format: humaniseStatus }],
  });

  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-6 px-8 py-12">
      <PageHeader
        title="Fulfillments"
        actions={
          caps.can('copack.fulfillment.pick') ? (
            <Link to="/copack/fulfillments/new">
              <Button variant="primary">New fulfillment</Button>
            </Link>
          ) : null
        }
      />

      <ListToolbar
        searchValue={server.searchInput}
        onSearchChange={server.setSearchInput}
        searchPlaceholder="Search fulfillment number"
        chips={server.chips}
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
            {FULFILLMENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {humaniseStatus(s)}
              </option>
            ))}
          </Select>
        </label>
      </ListToolbar>

      <SavedViewsBar
        entityType="fulfillment"
        currentConfig={server.viewConfig}
        onApply={server.applyView}
      />

      {server.isError ? (
        <p className="font-sans text-sm text-accent">Failed to load fulfillments.</p>
      ) : (
        <>
          <DataTable
            columns={TOOLBAR_COLUMNS}
            rows={server.rows}
            getRowKey={(f) => f.id}
            loading={server.isLoading}
            empty="No fulfillments match these filters."
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

function FulfillmentsListLegacy() {
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState<StatusFilter>(() =>
    parseFulfillmentStatusParam(searchParams.get('status')),
  );
  const [page, setPage] = useState(0);

  const filters = useMemo(() => {
    const f: { status?: StatusFilter } = {};
    if (status !== 'all') f.status = status;
    return f;
  }, [status]);

  const fulfillments = useFulfillmentsList(filters);
  const orders = useSalesOrdersList();
  const caps = useVioCapabilities();

  const orderNumber = useMemo(() => {
    const map: Record<string, string> = {};
    for (const o of orders.data ?? []) map[o.id] = o.order_number ?? o.id.slice(0, 8);
    return map;
  }, [orders.data]);

  const columns: ReadonlyArray<DataColumn<Fulfillment>> = useMemo(
    () => [
      {
        key: 'fulfillment',
        header: 'Fulfillment',
        cellClassName: 'tabular-nums',
        render: (f) => (
          <Link to={`/copack/fulfillments/${f.id}`} className={LINK_CLASS}>
            {f.fulfillment_number ?? f.id.slice(0, 8)}
          </Link>
        ),
      },
      {
        key: 'status',
        header: 'Status',
        render: (f) => <StatusBadge status={f.status} />,
      },
      {
        key: 'order',
        header: 'Sales order',
        cellClassName: 'text-ink-dim',
        render: (f) => orderNumber[f.sales_order_id] ?? f.sales_order_id.slice(0, 8),
      },
      {
        key: 'warehouse',
        header: 'Warehouse',
        cellClassName: 'text-ink-dim',
        render: (f) =>
          f.warehouse_id ? <EntityLabel kind="copack_warehouse" id={f.warehouse_id} /> : '·',
      },
      {
        key: 'created',
        header: 'Created',
        cellClassName: 'text-ink-dim',
        render: (f) => formatDateMedium(f.created_at),
      },
    ],
    [orderNumber],
  );

  function applyStatus(next: StatusFilter) {
    setStatus(next);
    setPage(0);
  }

  const rows = fulfillments.data ?? [];
  const totalCount = rows.length;
  const { sliceStart, sliceEnd } = paginate(totalCount, PAGE_SIZE, page);
  const pageRows = rows.slice(sliceStart, sliceEnd);

  const chips: FilterChip[] =
    status !== 'all'
      ? [{ key: 'status', label: `Status: ${humaniseStatus(status)}`, onClear: () => applyStatus('all') }]
      : [];

  const showOnboardingEmpty =
    !fulfillments.isLoading && !fulfillments.error && totalCount === 0 && status === 'all';

  const meta =
    !fulfillments.isLoading && !fulfillments.error
      ? `${totalCount} ${totalCount === 1 ? 'fulfillment' : 'fulfillments'}`
      : undefined;

  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-6 px-8 py-12">
      <PageHeader
        title="Fulfillments"
        meta={meta}
        actions={
          caps.can('copack.fulfillment.pick') ? (
            <Link to="/copack/fulfillments/new">
              <Button variant="primary">New fulfillment</Button>
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
            {FULFILLMENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {humaniseStatus(s)}
              </option>
            ))}
          </Select>
        </label>
      </FilterBar>

      {fulfillments.error ? (
        <p className="font-sans text-sm text-accent">
          {fulfillments.error instanceof Error
            ? fulfillments.error.message
            : 'Failed to load fulfillments.'}
        </p>
      ) : showOnboardingEmpty ? (
        <ListEmptyState
          entity="fulfillment"
          explainer="Fulfillments pick, pack, and ship the orders that are ready to go out the door."
          addLabel="Add fulfillment"
          addTo="/copack/fulfillments/new"
          canAdd={caps.can('copack.fulfillment.pick')}
        />
      ) : (
        <>
          <DataTable
            columns={columns}
            rows={pageRows}
            getRowKey={(f) => f.id}
            loading={fulfillments.isLoading}
            empty="No fulfillments match the current filters."
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
