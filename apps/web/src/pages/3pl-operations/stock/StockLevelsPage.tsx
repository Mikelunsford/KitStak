// StockLevelsPage. 3PL inventory. Migration to the shared UI kit
// (F-Wave10-UI-KIT-01): PageHeader + FilterBar + Select + DataTable replace the
// hand-rolled header, raw warehouse select, and per-warehouse tables. Behavior
// preserved: rows stay grouped by warehouse (one table per warehouse), the
// warehouse filter narrows the query, and quantity_available stays the
// server-derived GENERATED column.

import { useMemo, useState } from 'react';

import { EntityLabel } from '@/components/data/EntityLabel';
import { PageHeader } from '@/components/ui/PageHeader';
import { FilterBar, type FilterChip } from '@/components/ui/FilterBar';
import { Select } from '@/components/ui/Select';
import { DataTable, type DataColumn } from '@/components/ui/DataTable';
import { useStockLevels, useWarehousesList } from '@/lib/hooks/useInventory';
import type { StockLevel } from '@/lib/types/vendors_inventory_ops';

const COLUMNS: ReadonlyArray<DataColumn<StockLevel>> = [
  {
    key: 'item',
    header: 'Item',
    cellClassName: 'text-ink-dim',
    render: (r) => <EntityLabel kind="item" id={r.item_id} />,
  },
  {
    key: 'on_hand',
    header: 'On hand',
    align: 'right',
    cellClassName: 'tabular-nums text-ink',
    render: (r) => String(r.quantity_on_hand),
  },
  {
    key: 'reserved',
    header: 'Reserved',
    align: 'right',
    cellClassName: 'tabular-nums text-ink-dim',
    render: (r) => String(r.quantity_reserved),
  },
  {
    key: 'in_transit',
    header: 'In transit',
    align: 'right',
    cellClassName: 'tabular-nums text-ink-dim',
    render: (r) => String(r.quantity_in_transit),
  },
  {
    key: 'available',
    header: 'Available',
    align: 'right',
    cellClassName: 'tabular-nums text-ink',
    render: (r) => String(r.quantity_available),
  },
];

/**
 * StockLevelsPage. Groups quantity_on_hand / reserved / in_transit /
 * available rows by warehouse. quantity_available is server-derived
 * (GENERATED column on stock_levels).
 */
export function StockLevelsPage() {
  const [warehouseId, setWarehouseId] = useState<string>('');
  const warehouses = useWarehousesList();
  const levels = useStockLevels(warehouseId ? { warehouseId } : {});

  const levelsData = levels.data;
  const grouped = useMemo(() => {
    const m = new Map<string, StockLevel[]>();
    for (const row of levelsData ?? []) {
      const existing = m.get(row.warehouse_id) ?? [];
      m.set(row.warehouse_id, [...existing, row]);
    }
    return m;
  }, [levelsData]);

  const whName = useMemo(() => {
    const m = new Map<string, string>();
    for (const w of warehouses.data ?? []) m.set(w.id, w.display_name);
    return m;
  }, [warehouses.data]);

  const groups = Array.from(grouped.entries());

  const chips: FilterChip[] = [];
  if (warehouseId) {
    chips.push({
      key: 'warehouse',
      label: `Warehouse: ${whName.get(warehouseId) ?? warehouseId}`,
      onClear: () => setWarehouseId(''),
    });
  }

  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-6 px-8 py-12">
      <PageHeader eyebrow="Inventory / Stock levels" title="Stock levels" />

      <FilterBar chips={chips}>
        <label className="flex items-center gap-2">
          <span className="font-sans text-xs uppercase tracking-wide text-ink-dim">
            Warehouse
          </span>
          <Select
            value={warehouseId}
            onChange={(e) => setWarehouseId(e.target.value)}
            disabled={warehouses.isLoading}
            aria-label="Filter by warehouse"
          >
            <option value="">All warehouses</option>
            {(warehouses.data ?? []).map((w) => (
              <option key={w.id} value={w.id}>
                {w.display_name}
              </option>
            ))}
          </Select>
        </label>
      </FilterBar>

      {levels.error ? (
        <p className="font-sans text-sm text-accent">
          {levels.error instanceof Error
            ? levels.error.message
            : 'Failed to load stock levels.'}
        </p>
      ) : levels.isLoading ? (
        <DataTable columns={COLUMNS} rows={[]} getRowKey={(r) => r.id} loading />
      ) : groups.length === 0 ? (
        <DataTable
          columns={COLUMNS}
          rows={[]}
          getRowKey={(r) => r.id}
          empty="No stock levels found."
        />
      ) : (
        groups.map(([whId, rows]) => (
          <div key={whId} className="flex flex-col gap-2">
            <h2 className="font-display text-xl tracking-wider text-ink">
              {whName.get(whId) ?? whId.slice(0, 8)}
            </h2>
            <DataTable columns={COLUMNS} rows={rows} getRowKey={(r) => r.id} />
          </div>
        ))
      )}
    </section>
  );
}
