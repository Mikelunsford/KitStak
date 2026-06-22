// POsListPage. Workstream C of the 2026-06-17 UI scan adds the server list
// toolbar (search on PO number, sortable headers, status facet, keyset pager,
// saved views) behind feature.list_toolbar. The flag-off path is the original
// client-state view (the F-Wave10-UI-KIT-01 migration: PageHeader + FilterBar +
// Select + DataTable + StatusBadge + Pagination, with the ?status= deep-link
// applied client-side), extracted verbatim into POsListLegacy; the flag-on path
// is POsListToolbar. The parent renders one or the other.

import { useState } from 'react';
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
import { usePurchaseOrdersList } from '@/lib/hooks/usePurchaseOrders';
import { useVioCapabilities } from '@/lib/hooks/useVioCapabilities';
import { useOrgFlags } from '@/lib/hooks/useOrgFlags';
import { useServerList } from '@/lib/hooks/useServerList';
import { listPurchaseOrdersPage } from '@/lib/services/purchaseOrdersService';
import { purchaseOrdersKeys } from '@/lib/queryKeys/purchaseOrders';
import { FEATURE_FLAGS } from '@/lib/constants';
import { formatCents } from '@/lib/money';
import type { PurchaseOrder } from '@/lib/services/purchaseOrdersService';

const PAGE_SIZE = 50;

// PO statuses the list accepts via ?status=. Ordered for the filter dropdown;
// an arbitrary string never reaches the filter state.
const PO_STATUSES = [
  'draft',
  'submitted',
  'approved',
  'partial_received',
  'received',
  'closed',
  'cancelled',
] as const;

const ALLOWED_PO_STATUSES = new Set<string>(PO_STATUSES);

function parseStatusParam(raw: string | null): string | undefined {
  if (!raw) return undefined;
  return ALLOWED_PO_STATUSES.has(raw) ? raw : undefined;
}

const COLUMNS: ReadonlyArray<DataColumn<PurchaseOrder>> = [
  {
    key: 'po_number',
    header: 'PO #',
    cellClassName: 'tabular-nums',
    render: (po) => (
      <Link
        to={`/purchasing/purchase-orders/${po.id}`}
        className={LINK_CLASS}
      >
        {po.po_number ?? po.id.slice(0, 8)}
      </Link>
    ),
  },
  {
    key: 'vendor',
    header: 'Vendor',
    cellClassName: 'text-ink-dim',
    render: (po) => <EntityLabel kind="vendor" id={po.vendor_id} />,
  },
  {
    key: 'status',
    header: 'Status',
    sortKey: 'status',
    render: (po) => <StatusBadge status={po.status} />,
  },
  {
    key: 'total',
    header: 'Total',
    align: 'right',
    cellClassName: 'tabular-nums',
    render: (po) => formatCents(po.total_cents as number | string, po.currency_code),
  },
  {
    key: 'order_date',
    header: 'Order date',
    sortKey: 'order_date',
    cellClassName: 'text-ink-dim',
    render: (po) => po.order_date,
  },
];

export function POsListPage() {
  const flags = useOrgFlags();
  return flags.data[FEATURE_FLAGS.UI_LIST_TOOLBAR] ? (
    <POsListToolbar />
  ) : (
    <POsListLegacy />
  );
}

function POsListToolbar() {
  const caps = useVioCapabilities();
  const server = useServerList<PurchaseOrder>({
    enabled: true,
    queryKeyBase: purchaseOrdersKeys.all,
    fetchPage: listPurchaseOrdersPage,
    defaultSort: { by: 'created_at', dir: 'desc' },
    facets: [{ key: 'status', label: 'Status', format: humaniseStatus }],
  });

  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-6 px-8 py-12">
      <PageHeader
        title="Purchase Orders"
        actions={
          caps.can('purchase_orders.purchase_order.create') ? (
            <Link to="/purchasing/purchase-orders/new">
              <Button variant="primary">New PO</Button>
            </Link>
          ) : null
        }
      />

      <ListToolbar
        searchValue={server.searchInput}
        onSearchChange={server.setSearchInput}
        searchPlaceholder="Search PO number"
        chips={server.chips}
        onClearAll={server.clearAll}
      >
        <label className="flex items-center gap-2">
          <span className="font-sans text-xs uppercase tracking-wide text-ink-dim">
            Status
          </span>
          <Select
            value={server.facetValues.status ?? ''}
            onChange={(e) => server.setFacet('status', e.target.value)}
            aria-label="Filter by status"
          >
            <option value="">All statuses</option>
            {PO_STATUSES.map((s) => (
              <option key={s} value={s}>
                {humaniseStatus(s)}
              </option>
            ))}
          </Select>
        </label>
      </ListToolbar>

      <SavedViewsBar
        entityType="purchase_order"
        currentConfig={server.viewConfig}
        onApply={server.applyView}
      />

      {server.isError ? (
        <p className="font-sans text-accent">Failed to load.</p>
      ) : (
        <>
          <DataTable
            columns={COLUMNS}
            rows={server.rows}
            getRowKey={(po) => po.id}
            loading={server.isLoading}
            empty="No purchase orders match these filters."
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

function POsListLegacy() {
  const [searchParams, setSearchParams] = useSearchParams();
  const statusFilter = parseStatusParam(searchParams.get('status'));
  const [page, setPage] = useState(0);

  const { data, isLoading, error } = usePurchaseOrdersList();
  const caps = useVioCapabilities();

  function applyStatusFilter(next: string) {
    const params = new URLSearchParams(searchParams);
    if (next) params.set('status', next);
    else params.delete('status');
    setSearchParams(params, { replace: true });
    setPage(0);
  }

  const allRows = data ?? [];
  const rows = statusFilter
    ? allRows.filter((po) => po.status === statusFilter)
    : allRows;
  const totalCount = rows.length;
  const { sliceStart, sliceEnd } = paginate(totalCount, PAGE_SIZE, page);
  const pageRows = rows.slice(sliceStart, sliceEnd);

  const chips: FilterChip[] = statusFilter
    ? [
        {
          key: 'status',
          label: `Status: ${humaniseStatus(statusFilter)}`,
          onClear: () => applyStatusFilter(''),
        },
      ]
    : [];

  const showOnboardingEmpty =
    !isLoading && !error && !statusFilter && allRows.length === 0;

  const meta =
    !isLoading && !error
      ? `${totalCount} ${totalCount === 1 ? 'purchase order' : 'purchase orders'}`
      : undefined;

  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-6 px-8 py-12">
      <PageHeader
        title="Purchase Orders"
        meta={meta}
        actions={
          caps.can('purchase_orders.purchase_order.create') ? (
            <Link to="/purchasing/purchase-orders/new">
              <Button variant="primary">New PO</Button>
            </Link>
          ) : null
        }
      />

      <FilterBar chips={chips}>
        <label className="flex items-center gap-2">
          <span className="font-sans text-xs uppercase tracking-wide text-ink-dim">
            Status
          </span>
          <Select
            value={statusFilter ?? ''}
            onChange={(e) => applyStatusFilter(e.target.value)}
            aria-label="Filter by status"
          >
            <option value="">All statuses</option>
            {PO_STATUSES.map((s) => (
              <option key={s} value={s}>
                {humaniseStatus(s)}
              </option>
            ))}
          </Select>
        </label>
      </FilterBar>

      {error ? (
        <p className="font-sans text-accent">Failed to load.</p>
      ) : showOnboardingEmpty ? (
        <ListEmptyState
          entity="purchase order"
          explainer="Purchase orders commit to buying from a vendor."
          addLabel="Add purchase order"
          addTo="/purchasing/purchase-orders/new"
          canAdd={caps.can('purchase_orders.purchase_order.create')}
        />
      ) : (
        <>
          <DataTable
            columns={COLUMNS}
            rows={pageRows}
            getRowKey={(po) => po.id}
            loading={isLoading}
            empty="No purchase orders match this filter."
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
