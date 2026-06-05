// ItemsListPage. Migration to the shared UI kit (F-Wave10-UI-KIT-01):
// PageHeader + DataTable + StatusBadge + Pagination replace the hand-rolled
// header, "Yes/No" active text, table, and pagination. Items have no filters
// today, so no FilterBar is added; the list stays unfiltered. The onboarding
// ListEmptyState branch and the loading/error handling are preserved.

import { useState } from 'react';
import { Link } from 'react-router-dom';

import { ListEmptyState } from '@/components/shell/ListEmptyState';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, type DataColumn } from '@/components/ui/DataTable';
import { Pagination, paginate } from '@/components/ui/Pagination';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { useItemsList } from '@/lib/hooks/useItems';
import { formatCents } from '@/lib/money';
import type { Item } from '@/lib/types/sales';

const PAGE_SIZE = 50;

const COLUMNS: ReadonlyArray<DataColumn<Item>> = [
  {
    key: 'sku',
    header: 'SKU',
    cellClassName: 'font-mono',
    render: (item) => item.sku,
  },
  {
    key: 'name',
    header: 'Name',
    render: (item) => (
      <Link
        to={`/catalog/items/${item.id}`}
        className="text-ink hover:text-accent"
      >
        {item.name}
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
    cellClassName: 'font-mono',
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

export function ItemsListPage() {
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
        eyebrow="Library / Items"
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
