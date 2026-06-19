// SalesOrdersListPage. Workstream C of the 2026-06-17 UI scan adds the server
// list toolbar (search on order number, sortable headers, status facet, keyset
// pager) behind feature.list_toolbar. The flag-off path is the original
// client-state view, extracted verbatim into SalesOrdersListLegacy; the flag-on
// path is SalesOrdersListToolbar. The parent renders one or the other.
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
import { useSalesOrdersList, useSalesChannelsList } from '@/lib/hooks/useCoPack';
import { useOrgFlags } from '@/lib/hooks/useOrgFlags';
import { useServerList } from '@/lib/hooks/useServerList';
import { useVioCapabilities } from '@/lib/hooks/useVioCapabilities';
import { listSalesOrdersPage } from '@/lib/services/copackService';
import { salesOrdersKeys } from '@/lib/queryKeys/copack';
import { formatDateMedium } from '@/lib/dates';
import { FEATURE_FLAGS } from '@/lib/constants';
import type { SalesOrder, SalesOrderStatus } from '@/lib/types/copack';

const PAGE_SIZE = 50;

type StatusFilter = SalesOrderStatus | 'all';

const ORDER_STATUSES: ReadonlyArray<SalesOrderStatus> = [
  'draft',
  'confirmed',
  'picking',
  'packed',
  'shipped',
  'cancelled',
];

const ALLOWED_ORDER_STATUSES = new Set<string>(ORDER_STATUSES);

function parseOrderStatusParam(raw: string | null): StatusFilter {
  if (raw && ALLOWED_ORDER_STATUSES.has(raw)) return raw as SalesOrderStatus;
  return 'all';
}

// Static toolbar columns. Sortable headers map to the edge SORT_COLS allowlist
// (created_at, status). order_number is nullable so it is searchable, not
// sortable. Channel name resolution needs a runtime map, so the toolbar view
// shows the short channel id instead of carrying a per-page lookup.
const TOOLBAR_COLUMNS: ReadonlyArray<DataColumn<SalesOrder>> = [
  {
    key: 'order',
    header: 'Order',
    cellClassName: 'tabular-nums',
    render: (o) => (
      <Link to={`/copack/orders/${o.id}`} className={LINK_CLASS}>
        {o.order_number ?? o.id.slice(0, 8)}
      </Link>
    ),
  },
  {
    key: 'status',
    header: 'Status',
    sortKey: 'status',
    render: (o) => <StatusBadge status={o.status} />,
  },
  {
    key: 'channel',
    header: 'Channel',
    cellClassName: 'text-ink-dim',
    render: (o) => (o.channel_id ? o.channel_id.slice(0, 8) : '·'),
  },
  {
    key: 'customer',
    header: 'Customer',
    cellClassName: 'text-ink-dim',
    render: (o) =>
      o.customer_id ? <EntityLabel kind="customer" id={o.customer_id} /> : '·',
  },
  {
    key: 'ordered',
    header: 'Ordered',
    cellClassName: 'text-ink-dim',
    render: (o) => formatDateMedium(o.ordered_at),
  },
  {
    key: 'created',
    header: 'Created',
    sortKey: 'created_at',
    cellClassName: 'text-ink-dim',
    render: (o) => formatDateMedium(o.created_at),
  },
];

export function SalesOrdersListPage() {
  const flags = useOrgFlags();
  return flags.data[FEATURE_FLAGS.UI_LIST_TOOLBAR] ? (
    <SalesOrdersListToolbar />
  ) : (
    <SalesOrdersListLegacy />
  );
}

function SalesOrdersListToolbar() {
  const caps = useVioCapabilities();
  const server = useServerList<SalesOrder>({
    enabled: true,
    queryKeyBase: salesOrdersKeys.all,
    fetchPage: listSalesOrdersPage,
    defaultSort: { by: 'created_at', dir: 'desc' },
    facets: [{ key: 'status', label: 'Status', format: humaniseStatus }],
  });

  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-6 px-8 py-12">
      <PageHeader
        eyebrow="Co-Pack and Ecom / Sales orders"
        title="Sales Orders"
        actions={
          caps.can('copack.order.create') ? (
            <Link to="/copack/orders/new">
              <Button variant="primary">New sales order</Button>
            </Link>
          ) : null
        }
      />

      <ListToolbar
        searchValue={server.searchInput}
        onSearchChange={server.setSearchInput}
        searchPlaceholder="Search order number"
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
            {ORDER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {humaniseStatus(s)}
              </option>
            ))}
          </Select>
        </label>
      </ListToolbar>

      <SavedViewsBar
        entityType="sales_order"
        currentConfig={server.viewConfig}
        onApply={server.applyView}
      />

      {server.isError ? (
        <p className="font-sans text-sm text-accent">Failed to load sales orders.</p>
      ) : (
        <>
          <DataTable
            columns={TOOLBAR_COLUMNS}
            rows={server.rows}
            getRowKey={(o) => o.id}
            loading={server.isLoading}
            empty="No sales orders match these filters."
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

function SalesOrdersListLegacy() {
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState<StatusFilter>(() =>
    parseOrderStatusParam(searchParams.get('status')),
  );
  const [channelId, setChannelId] = useState<string>('');
  const [page, setPage] = useState(0);

  const filters = useMemo(() => {
    const f: { status?: StatusFilter; channel_id?: string } = {};
    if (status !== 'all') f.status = status;
    if (channelId) f.channel_id = channelId;
    return f;
  }, [status, channelId]);

  const orders = useSalesOrdersList(filters);
  const channels = useSalesChannelsList();
  const caps = useVioCapabilities();

  const channelName = useMemo(() => {
    const map: Record<string, string> = {};
    for (const c of channels.data ?? []) map[c.id] = c.name;
    return map;
  }, [channels.data]);

  const columns: ReadonlyArray<DataColumn<SalesOrder>> = useMemo(
    () => [
      {
        key: 'order',
        header: 'Order',
        cellClassName: 'tabular-nums',
        render: (o) => (
          <Link to={`/copack/orders/${o.id}`} className={LINK_CLASS}>
            {o.order_number ?? o.id.slice(0, 8)}
          </Link>
        ),
      },
      {
        key: 'status',
        header: 'Status',
        render: (o) => <StatusBadge status={o.status} />,
      },
      {
        key: 'channel',
        header: 'Channel',
        cellClassName: 'text-ink-dim',
        render: (o) =>
          o.channel_id ? channelName[o.channel_id] ?? o.channel_id.slice(0, 8) : '·',
      },
      {
        key: 'customer',
        header: 'Customer',
        cellClassName: 'text-ink-dim',
        render: (o) =>
          o.customer_id ? <EntityLabel kind="customer" id={o.customer_id} /> : '·',
      },
      {
        key: 'ordered',
        header: 'Ordered',
        cellClassName: 'text-ink-dim',
        render: (o) => formatDateMedium(o.ordered_at),
      },
      {
        key: 'created',
        header: 'Created',
        cellClassName: 'text-ink-dim',
        render: (o) => formatDateMedium(o.created_at),
      },
    ],
    [channelName],
  );

  function applyStatus(next: StatusFilter) {
    setStatus(next);
    setPage(0);
  }
  function applyChannel(next: string) {
    setChannelId(next);
    setPage(0);
  }

  const rows = orders.data ?? [];
  const totalCount = rows.length;
  const { sliceStart, sliceEnd } = paginate(totalCount, PAGE_SIZE, page);
  const pageRows = rows.slice(sliceStart, sliceEnd);

  const chips: FilterChip[] = [
    ...(status !== 'all'
      ? [{ key: 'status', label: `Status: ${humaniseStatus(status)}`, onClear: () => applyStatus('all') }]
      : []),
    ...(channelId
      ? [
          {
            key: 'channel',
            label: `Channel: ${channelName[channelId] ?? channelId.slice(0, 8)}`,
            onClear: () => applyChannel(''),
          },
        ]
      : []),
  ];

  const showOnboardingEmpty =
    !orders.isLoading && !orders.error && totalCount === 0 && status === 'all' && !channelId;

  const meta =
    !orders.isLoading && !orders.error
      ? `${totalCount} ${totalCount === 1 ? 'sales order' : 'sales orders'}`
      : undefined;

  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-6 px-8 py-12">
      <PageHeader
        eyebrow="Co-Pack and Ecom / Sales orders"
        title="Sales Orders"
        meta={meta}
        actions={
          caps.can('copack.order.create') ? (
            <Link to="/copack/orders/new">
              <Button variant="primary">New sales order</Button>
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
            {ORDER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {humaniseStatus(s)}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex items-center gap-2">
          <span className="font-sans text-xs uppercase tracking-wide text-ink-dim">Channel</span>
          <Select
            value={channelId}
            onChange={(e) => applyChannel(e.target.value)}
            disabled={channels.isLoading}
            aria-label="Filter by channel"
          >
            <option value="">All channels</option>
            {(channels.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </label>
      </FilterBar>

      {orders.error ? (
        <p className="font-sans text-sm text-accent">
          {orders.error instanceof Error ? orders.error.message : 'Failed to load sales orders.'}
        </p>
      ) : showOnboardingEmpty ? (
        <ListEmptyState
          entity="sales order"
          explainer="Sales orders capture what a customer wants before it is kitted and shipped."
          addLabel="Add sales order"
          addTo="/copack/orders/new"
          canAdd={caps.can('copack.order.create')}
        />
      ) : (
        <>
          <DataTable
            columns={columns}
            rows={pageRows}
            getRowKey={(o) => o.id}
            loading={orders.isLoading}
            empty="No sales orders match the current filters."
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
