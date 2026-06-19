// WmsBinStockListPage (Wave 12 Body B Phase B2). The bin-grain on-hand rollup:
// one row per (warehouse, location, item, lot), derived from the append-only
// stock_movements ledger by the recompute_bin_stock_level trigger. Read-only:
// there is no create CTA and no mutation. The sum of on-hand over every location
// partition reconciles to the spine warehouse total by construction. UI scan
// Workstream C adds the server list toolbar (sortable headers, location facet,
// keyset pager, saved views) behind feature.list_toolbar. The flag-off path is
// the original client-state view, extracted verbatim into WmsBinStockListLegacy;
// the flag-on path is WmsBinStockListToolbar. The rollup has no text identifier
// column, so the toolbar offers no free-text search (it sorts, facets, pages).

import { useMemo, useState } from 'react';

import { EntityLabel } from '@/components/data/EntityLabel';
import { PageHeader } from '@/components/ui/PageHeader';
import { FilterBar } from '@/components/ui/FilterBar';
import { SavedViewsBar } from '@/components/ui/SavedViewsBar';
import { Select } from '@/components/ui/Select';
import { DataTable, type DataColumn } from '@/components/ui/DataTable';
import { Pagination, paginate } from '@/components/ui/Pagination';
import { CursorPager } from '@/components/ui/CursorPager';
import { useWmsBinStockList } from '@/lib/hooks/useWmsBinStock';
import { useWmsLocationsList } from '@/lib/hooks/useWmsLocations';
import { useOrgFlags } from '@/lib/hooks/useOrgFlags';
import { useServerList } from '@/lib/hooks/useServerList';
import { listWmsBinStockPage } from '@/lib/services/wmsBinStockService';
import { wmsBinStockKeys } from '@/lib/queryKeys/wms';
import { FEATURE_FLAGS } from '@/lib/constants';
import type { BinStockLevel } from '@/lib/services/wmsBinStockService';
import type { WarehouseLocation } from '@/lib/services/wmsLocationsService';

const PAGE_SIZE = 50;

// Resolve a location_id to its operator-facing code via the locations list. The
// rollup is keyed by id; the code is what the operator reads on the shelf. This
// is a per-row lookup against a separate query, not an aggregation over the bin
// list, so it stays correct when the bin list is paged server-side.
function locationCode(
  locations: ReadonlyArray<WarehouseLocation> | undefined,
  id: string,
): string {
  const row = locations?.find((l) => l.id === id);
  return row ? row.code : `${id.slice(0, 8)}…`;
}

function useBinStockColumns(
  locations: ReadonlyArray<WarehouseLocation> | undefined,
): ReadonlyArray<DataColumn<BinStockLevel>> {
  return useMemo(
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
        align: 'right',
        sortKey: 'quantity_on_hand',
        cellClassName: 'text-right tabular-nums',
        render: (r) => String(r.quantity_on_hand),
      },
    ],
    [locations],
  );
}

export function WmsBinStockListPage() {
  const flags = useOrgFlags();
  return flags.data[FEATURE_FLAGS.UI_LIST_TOOLBAR] ? (
    <WmsBinStockListToolbar />
  ) : (
    <WmsBinStockListLegacy />
  );
}

function WmsBinStockListToolbar() {
  const locationsQuery = useWmsLocationsList();
  const locations = locationsQuery.data;
  const columns = useBinStockColumns(locations);

  const server = useServerList<BinStockLevel>({
    enabled: true,
    queryKeyBase: wmsBinStockKeys.all,
    fetchPage: listWmsBinStockPage,
    defaultSort: { by: 'updated_at', dir: 'desc' },
    facets: [
      {
        key: 'location_id',
        label: 'Location',
        format: (id) => locationCode(locations, id),
      },
    ],
  });

  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-6 px-8 py-12">
      <PageHeader eyebrow="WMS" title="Bin stock" />

      <FilterBar chips={server.chips} onClearAll={server.clearAll}>
        <label className="flex items-center gap-2">
          <span className="font-sans text-xs uppercase tracking-wide text-ink-dim">
            Location
          </span>
          <Select
            value={server.facetValues.location_id ?? ''}
            onChange={(e) => server.setFacet('location_id', e.target.value)}
            aria-label="Filter bin stock by location"
          >
            <option value="">All locations</option>
            {(locations ?? []).map((l) => (
              <option key={l.id} value={l.id}>
                {l.code}
              </option>
            ))}
          </Select>
        </label>
      </FilterBar>

      <SavedViewsBar
        entityType="bin_stock_level"
        currentConfig={server.viewConfig}
        onApply={server.applyView}
      />

      {server.isError ? (
        <p className="font-sans text-accent">Failed to load bin stock.</p>
      ) : (
        <>
          <DataTable
            columns={columns}
            rows={server.rows}
            getRowKey={(r) => r.id}
            loading={server.isLoading}
            empty="No bin stock matches these filters."
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

function WmsBinStockListLegacy() {
  const [locationId, setLocationId] = useState('');
  const [page, setPage] = useState(0);

  const { data, isLoading, error } = useWmsBinStockList(
    locationId ? { location_id: locationId } : {},
  );
  const locationsQuery = useWmsLocationsList();
  const locations = locationsQuery.data;

  const columns = useBinStockColumns(locations);

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
