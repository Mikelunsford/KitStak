// WarehousesListPage. Workstream C of the 2026-06-17 UI scan adds the server
// list toolbar (search on name + code, sortable headers, an active facet, a
// keyset pager) behind feature.list_toolbar. The flag-off path is the original
// client-state view, extracted verbatim into WarehousesListLegacy; the flag-on
// path is WarehousesListToolbar. The parent renders one or the other.
//
// Prior migration (F-Wave10-UI-KIT-01): PageHeader + Button + DataTable +
// StatusBadge + Pagination replaced the hand-rolled header, table, and active
// text. The create CTA and onboarding empty state stay cap-gated on
// warehouses.warehouse.create.

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
import { StatusBadge } from '@/components/ui/StatusBadge';
import { useWarehousesList } from '@/lib/hooks/useInventory';
import { useOrgFlags } from '@/lib/hooks/useOrgFlags';
import { useServerList } from '@/lib/hooks/useServerList';
import { useVioCapabilities } from '@/lib/hooks/useVioCapabilities';
import { listWarehousesPage } from '@/lib/services/warehousesService';
import { warehousesKeys } from '@/lib/queryKeys/inventory';
import { FEATURE_FLAGS } from '@/lib/constants';
import type { Warehouse } from '@/lib/types/vendors_inventory_ops';

const PAGE_SIZE = 50;

const COLUMNS: ReadonlyArray<DataColumn<Warehouse>> = [
  {
    key: 'name',
    header: 'Name',
    sortKey: 'display_name',
    render: (w) => (
      <Link to={`/inventory/warehouses/${w.id}`} className={LINK_CLASS}>
        {w.display_name ?? w.code}
      </Link>
    ),
  },
  {
    key: 'default',
    header: 'Default',
    render: (w) => (w.is_default ? 'Yes' : ''),
  },
  {
    key: 'active',
    header: 'Active',
    render: (w) => <StatusBadge status={w.is_active ? 'active' : 'inactive'} />,
  },
];

function renderWarehouseDetails(w: Warehouse) {
  return <ReferenceField label="Code" value={w.code} />;
}

function formatActive(value: string): string {
  return value === 'true' ? 'Active' : 'Inactive';
}

export function WarehousesListPage() {
  const flags = useOrgFlags();
  return flags.data[FEATURE_FLAGS.UI_LIST_TOOLBAR] ? (
    <WarehousesListToolbar />
  ) : (
    <WarehousesListLegacy />
  );
}

function WarehousesListToolbar() {
  const caps = useVioCapabilities();
  const server = useServerList<Warehouse>({
    enabled: true,
    queryKeyBase: warehousesKeys.all,
    fetchPage: listWarehousesPage,
    defaultSort: { by: 'created_at', dir: 'desc' },
    facets: [{ key: 'active', label: 'Active', format: formatActive }],
  });

  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-6 px-8 py-12">
      <PageHeader
        title="Warehouses"
        actions={
          caps.can('warehouses.warehouse.create') ? (
            <Link to="/inventory/warehouses/new">
              <Button variant="primary">New warehouse</Button>
            </Link>
          ) : null
        }
      />

      <ListToolbar
        searchValue={server.searchInput}
        onSearchChange={server.setSearchInput}
        searchPlaceholder="Search name or code"
        chips={server.chips}
        onClearAll={server.clearAll}
      >
        <label className="flex items-center gap-2">
          <span className="font-sans text-xs uppercase tracking-wide text-ink-dim">
            Active
          </span>
          <Select
            value={server.facetValues.active ?? ''}
            onChange={(e) => server.setFacet('active', e.target.value)}
            aria-label="Filter by active"
          >
            <option value="">All warehouses</option>
            <option value="true">Active</option>
            <option value="false">Inactive</option>
          </Select>
        </label>
      </ListToolbar>

      <SavedViewsBar
        entityType="warehouse"
        currentConfig={server.viewConfig}
        onApply={server.applyView}
      />

      {server.isError ? (
        <p className="font-sans text-accent">Failed to load warehouses.</p>
      ) : (
        <>
          <DataTable
            columns={COLUMNS}
            rows={server.rows}
            getRowKey={(w) => w.id}
            loading={server.isLoading}
            empty="No warehouses match these filters."
            renderRowDetails={renderWarehouseDetails}
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

function WarehousesListLegacy() {
  const { data, isLoading } = useWarehousesList();
  const caps = useVioCapabilities();
  const [page, setPage] = useState(0);

  const rows = data ?? [];
  const totalCount = rows.length;
  const { sliceStart, sliceEnd } = paginate(totalCount, PAGE_SIZE, page);
  const pageRows = rows.slice(sliceStart, sliceEnd);

  const meta = !isLoading
    ? `${totalCount} ${totalCount === 1 ? 'warehouse' : 'warehouses'}`
    : undefined;

  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-6 px-8 py-12">
      <PageHeader
        title="Warehouses"
        meta={meta}
        actions={
          caps.can('warehouses.warehouse.create') ? (
            <Link to="/inventory/warehouses/new">
              <Button variant="primary">New warehouse</Button>
            </Link>
          ) : null
        }
      />

      {!isLoading && totalCount === 0 ? (
        <ListEmptyState
          entity="warehouse"
          explainer="Warehouses are the physical locations where your inventory lives."
          addLabel="Add warehouse"
          addTo="/inventory/warehouses/new"
          canAdd={caps.can('warehouses.warehouse.create')}
        />
      ) : (
        <>
          <DataTable
            columns={COLUMNS}
            rows={pageRows}
            getRowKey={(w) => w.id}
            loading={isLoading}
            empty="No warehouses yet."
            renderRowDetails={renderWarehouseDetails}
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
