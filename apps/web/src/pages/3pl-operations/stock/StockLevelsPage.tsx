import { useMemo, useState } from 'react';
import { EntityLabel } from '@/components/data/EntityLabel';
import { useStockLevels } from '@/lib/hooks/useInventory';
import { useWarehousesList } from '@/lib/hooks/useInventory';

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
    const m = new Map<string, typeof levelsData>();
    for (const row of levelsData ?? []) {
      const existing = m.get(row.warehouse_id) ?? [];
      m.set(row.warehouse_id, [...(existing ?? []), row]);
    }
    return m;
  }, [levelsData]);

  const whName = useMemo(() => {
    const m = new Map<string, string>();
    for (const w of warehouses.data ?? []) m.set(w.id, w.display_name);
    return m;
  }, [warehouses.data]);

  return (
    <section className="px-8 py-12 max-w-6xl mx-auto flex flex-col gap-6">
      <h1 className="text-4xl font-display tracking-wide text-ink">STOCK LEVELS</h1>
      <div className="flex gap-2 items-center">
        <label className="text-ink-dim font-sans text-sm">Warehouse</label>
        <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}
          className="border border-line bg-bg-2 px-3 py-2 text-ink text-sm">
          <option value="">All warehouses</option>
          {(warehouses.data ?? []).map((w) => (
            <option key={w.id} value={w.id}>{w.display_name}</option>
          ))}
        </select>
      </div>
      {levels.isLoading ? <p className="text-ink-dim">Loading.</p> : null}
      {Array.from(grouped.entries()).map(([whId, rows]) => (
        <div key={whId} className="flex flex-col gap-2">
          <h2 className="text-xl font-display tracking-wider text-ink">{whName.get(whId) ?? whId.slice(0, 8)}</h2>
          <table className="w-full border border-line text-sm font-sans">
            <thead className="bg-bg-2 text-left text-ink-dim">
              <tr><th className="px-4 py-2">Item</th><th className="px-4 py-2">On hand</th><th className="px-4 py-2">Reserved</th><th className="px-4 py-2">In transit</th><th className="px-4 py-2">Available</th></tr>
            </thead>
            <tbody>
              {(rows ?? []).map((r) => (
                <tr key={r.id} className="border-t border-line">
                  <td className="px-4 py-2 text-ink-dim"><EntityLabel kind="item" id={r.item_id} /></td>
                  <td className="px-4 py-2 text-ink">{String(r.quantity_on_hand)}</td>
                  <td className="px-4 py-2 text-ink-dim">{String(r.quantity_reserved)}</td>
                  <td className="px-4 py-2 text-ink-dim">{String(r.quantity_in_transit)}</td>
                  <td className="px-4 py-2 text-ink">{String(r.quantity_available)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </section>
  );
}
