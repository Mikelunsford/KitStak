// ItemsListPage. Workstream C of the 2026-06-17 UI scan adds the server list
// toolbar (search on SKU + name, sortable headers, kind facet, active-only
// toggle, keyset pager) behind feature.list_toolbar. The flag-off path is the
// original unfiltered client-slice view, extracted verbatim into ItemsListLegacy;
// the flag-on path is ItemsListToolbar. The parent renders one or the other.

import { useState } from 'react';
import { Link } from 'react-router-dom';

import { LINK_CLASS } from '@/components/data/entityLabelStyles';
import { ReferenceField } from '@/components/data/ReferenceField';
import { ListEmptyState } from '@/components/shell/ListEmptyState';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { ListToolbar } from '@/components/ui/ListToolbar';
import { SavedViewsBar } from '@/components/ui/SavedViewsBar';
import { Select } from '@/components/ui/Select';
import { DataTable, type DataColumn } from '@/components/ui/DataTable';
import { Pagination, paginate } from '@/components/ui/Pagination';
import { CursorPager } from '@/components/ui/CursorPager';
import { StatusBadge, humaniseStatus } from '@/components/ui/StatusBadge';
import { useItemsList } from '@/lib/hooks/useItems';
import { useOrgFlags } from '@/lib/hooks/useOrgFlags';
import { useServerList } from '@/lib/hooks/useServerList';
import { listItemsPage } from '@/lib/services/itemsService';
import { itemsKeys } from '@/lib/queryKeys/items';
import { FEATURE_FLAGS } from '@/lib/constants';
import { formatCents } from '@/lib/money';
import type { Item } from '@/lib/types/sales';

const PAGE_SIZE = 50;

const ITEM_KINDS = ['product', 'service', 'kit', 'subscription', 'bundle'] as const;

const COLUMNS: ReadonlyArray<DataColumn<Item>> = [
  {
    key: 'name',
    header: 'Name',
    sortKey: 'name',
    render: (item) => (
      <Link to={`/catalog/items/${item.id}`} className={LINK_CLASS}>
        {item.name ?? item.sku}
      </Link>
    ),
  },
  {
    key: 'kind',
    header: 'Kind',
    render: (item) => item.kind,
  },
  {
    key: 'price',
    header: 'Price',
    align: 'right',
    sortKey: 'unit_price_cents',
    cellClassName: 'tabular-nums',
    render: (item) => formatCents(item.unit_price_cents, item.currency_code),
  },
  {
    key: 'status',
    header: 'Status',
    render: (item) => (
      <StatusBadge status={item.is_active ? 'active' : 'inactive'} />
    ),
  },
];

function renderItemDetails(item: Item) {
  return <ReferenceField label="SKU" value={item.sku} />;
}

export function ItemsListPage() {
  const flags = useOrgFlags();
  return flags.data[FEATURE_FLAGS.UI_LIST_TOOLBAR] ? (
    <ItemsListToolbar />
  ) : (
    <ItemsListLegacy />
  );
}

function ItemsListToolbar() {
  const server = useServerList<Item>({
    enabled: true,
    queryKeyBase: itemsKeys.all,
    fetchPage: listItemsPage,
    defaultSort: { by: 'created_at', dir: 'desc' },
    facets: [
      { key: 'kind', label: 'Kind' },
      { key: 'active', label: 'Active only', toggle: true },
    ],
  });

  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-6 px-8 py-12">
      <PageHeader
        eyebrow="Catalog / Items"
        title="Items"
        actions={
          <Link to="/catalog/items/new">
            <Button variant="primary">New item</Button>
          </Link>
        }
      />

      <ListToolbar
        searchValue={server.searchInput}
        onSearchChange={server.setSearchInput}
        searchPlaceholder="Search SKU or name"
        chips={server.chips}
        onClearAll={server.clearAll}
      >
        <label className="flex items-center gap-2">
          <span className="font-sans text-xs uppercase tracking-wide text-ink-dim">
            Kind
          </span>
          <Select
            value={server.facetValues.kind ?? ''}
            onChange={(e) => server.setFacet('kind', e.target.value)}
            aria-label="Filter by kind"
          >
            <option value="">All kinds</option>
            {ITEM_KINDS.map((k) => (
              <option key={k} value={k}>
                {humaniseStatus(k)}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex items-center gap-2 font-sans text-sm text-ink-dim">
          <input
            type="checkbox"
            checked={server.facetValues.active === 'true'}
            onChange={(e) => server.setFacet('active', e.target.checked ? 'true' : '')}
          />
          Active only
        </label>
      </ListToolbar>

      <SavedViewsBar
        entityType="item"
        currentConfig={server.viewConfig}
        onApply={server.applyView}
      />

      {server.isError ? (
        <p className="font-sans text-accent">Failed to load items.</p>
      ) : (
        <>
          <DataTable
            columns={COLUMNS}
            rows={server.rows}
            getRowKey={(item) => item.id}
            loading={server.isLoading}
            empty="No items match these filters."
            sortBy={server.sortBy}
            sortDir={server.sortDir}
            onSort={server.onSort}
            renderRowDetails={renderItemDetails}
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

function ItemsListLegacy() {
  const [page, setPage] = useState(0);
  const { data, isLoading, error } = useItemsList();

  const rows = data ?? [];
  const totalCount = rows.length;
  const { sliceStart, sliceEnd } = paginate(totalCount, PAGE_SIZE, page);
  const pageRows = rows.slice(sliceStart, sliceEnd);

  const showOnboardingEmpty = !isLoading && !error && totalCount === 0;

  const meta =
    !isLoading && !error
      ? `${totalCount} ${totalCount === 1 ? 'item' : 'items'}`
      : undefined;

  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-6 px-8 py-12">
      <PageHeader
        eyebrow="Catalog / Items"
        title="Items"
        meta={meta}
        actions={
          <Link to="/catalog/items/new">
            <Button variant="primary">New item</Button>
          </Link>
        }
      />

      {error ? (
        <p className="font-sans text-accent">Failed to load items.</p>
      ) : showOnboardingEmpty ? (
        <ListEmptyState
          entity="item"
          explainer="Items are the SKUs you receive, build, and ship."
          addLabel="Add item"
          addTo="/catalog/items/new"
        />
      ) : (
        <>
          <DataTable
            columns={COLUMNS}
            rows={pageRows}
            getRowKey={(item) => item.id}
            loading={isLoading}
            empty="No items yet."
            renderRowDetails={renderItemDetails}
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
