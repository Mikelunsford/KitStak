// WmsBinStockListPage (Wave 12 Body B Phase B2). The bin-grain on-hand rollup:
// one row per (warehouse, location, item, lot), derived from the append-only
// stock_movements ledger by the recompute_bin_stock_level trigger. Read-only:
// there is no create CTA and no mutation. The sum of on-hand over every location
// partition reconciles to the spine warehouse total by construction. Shared UI
// kit (PageHeader + FilterBar + DataTable + Pagination) matching the Locations
// list surface; eyebrow "WMS".

import { useMemo, useState } from 'react';

import { EntityLabel } from '@/components/data/EntityLabel';
import { PageHeader } from '@/components/ui/PageHeader';
import { FilterBar } from '@/components/ui/FilterBar';
import { Select } from '@/components/ui/Select';
import { DataTable, type DataColumn } from '@/components/ui/DataTable';
import { Pagination, paginate } from '@/components/ui/Pagination';
import { useWmsBinStockList } from '@/lib/hooks/useWmsBinStock';
import { useWmsLocationsList } from '@/lib/hooks/useWmsLocations';
import type { BinStockLevel } from '@/lib/services/wmsBinStockService';
import type { WarehouseLocation } from '@/lib/services/wmsLocationsService';

const PAGE_SIZE = 50;

// Resolve a location_id to its operator-facing code via the locations list. The
// rollup is keyed by id; the code is what the operator reads on the shelf.
function locationCode(
  locations: ReadonlyArray<WarehouseLocation> | undefined,
  id: string,
): string {
  const row = locations?.find((l) => l.id === id);
  return row ? row.code : `${id.slice(0, 8)}…`;
}

export function WmsBinStockListPage() {
  const [locationId, setLocationId] = useState('');
  const [page, setPage] = useState(0);

  const { data, isLoading, error } = useWmsBinStockList(
    locationId ? { location_id: locationId } : {},
  );
  const locationsQuery = useWmsLocationsList();
  const locations = locationsQuery.data;

  const columns: ReadonlyArray<DataColumn<BinStockLevel>> = useMemo(
    () => [
      {
        key: 'location',
        header: 'Location',
        cellClassName: 'tabular-nums text-ink',
        render: (r) => locationCode(locations, r.location_id),
      },
      {
        key: 'warehouse',
        header: 'Warehouse',
        cellClassName: 'text-ink-dim',
        render: (r) => <EntityLabel kind="warehouse" id={r.warehouse_id} />,
      },
      {
        key: 'item',
        header: 'Item',
        cellClassName: 'text-ink-dim',
        render: (r) => <EntityLabel kind="item" id={r.item_id} />,
      },
      {
        key: 'lot',
        header: 'Lot',
        cellClassName: 'tabular-nums text-ink-dim',
        render: (r) => (r.lot_id ? `${r.lot_id.slice(0, 8)}…` : 'No lot'),
      },
      {
        key: 'on_hand',
        header: 'On hand',
        cellClassName: 'text-right tabular-nums',
        render: (r) => String(r.quantity_on_hand),
      },
    ],
    [locations],
  );

  const rows = data ?? [];
  const totalCount = rows.length;
  const { sliceStart, sliceEnd } = paginate(totalCount, PAGE_SIZE, page);
  const pageRows = rows.slice(sliceStart, sliceEnd);

  const meta =
    !isLoading && !error
      ? `${totalCount} ${totalCount === 1 ? 'bin row' : 'bin rows'}`
      : undefined;

  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-6 px-8 py-12">
      <PageHeader eyebrow="WMS" title="Bin stock" meta={meta} />

      <FilterBar>
        <Select
          value={locationId}
          onChange={(e) => {
            setLocationId(e.target.value);
            setPage(0);
          }}
          aria-label="Filter bin stock by location"
        >
          <option value="">All locations</option>
          {(locations ?? []).map((l) => (
            <option key={l.id} value={l.id}>
              {l.code}
            </option>
          ))}
        </Select>
      </FilterBar>

      {error ? (
        <p className="font-sans text-accent">Failed to load bin stock.</p>
      ) : (
        <>
          <DataTable
            columns={columns}
            rows={pageRows}
            getRowKey={(r) => r.id}
            loading={isLoading}
            empty="No bin stock yet. Bin rows appear as located movements post to the ledger."
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
