// WarehousesListPage. Migrated to the shared UI kit (F-Wave10-UI-KIT-01):
// PageHeader + Button + DataTable + StatusBadge + Pagination replace the
// hand-rolled header, table, and active text. No FilterBar: warehouses has no
// filter state. The create CTA and onboarding empty state stay cap-gated on
// warehouses.warehouse.create.

import { useState } from 'react';
import { Link } from 'react-router-dom';

import { LINK_CLASS } from '@/components/data/entityLabelStyles';
import { ReferenceField } from '@/components/data/ReferenceField';
import { ListEmptyState } from '@/components/shell/ListEmptyState';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, type DataColumn } from '@/components/ui/DataTable';
import { Pagination, paginate } from '@/components/ui/Pagination';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { useWarehousesList } from '@/lib/hooks/useInventory';
import { useVioCapabilities } from '@/lib/hooks/useVioCapabilities';
import type { Warehouse } from '@/lib/types/vendors_inventory_ops';

const PAGE_SIZE = 50;

const COLUMNS: ReadonlyArray<DataColumn<Warehouse>> = [
  {
    key: 'name',
    header: 'Name',
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

export function WarehousesListPage() {
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
        eyebrow="Inventory / Warehouses"
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
