import { useMemo } from 'react';
import { Link } from 'react-router-dom';

import { ListEmptyState } from '@/components/shell/ListEmptyState';
import { useBomItemsList } from '@/lib/hooks/useInventory';
import { useItemsList } from '@/lib/hooks/useItems';
import { useVioCapabilities } from '@/lib/hooks/useVioCapabilities';

interface BomRow {
  parentItemId: string;
  componentCount: number;
}

export function BomsListPage() {
  const { data: lines, isLoading } = useBomItemsList();
  const { data: items } = useItemsList();
  const caps = useVioCapabilities();

  const itemLabel = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of items ?? []) {
      map.set(item.id, `${item.sku} · ${item.name}`);
    }
    return map;
  }, [items]);

  const rows = useMemo<BomRow[]>(() => {
    const counts = new Map<string, number>();
    for (const line of lines ?? []) {
      counts.set(line.parent_item_id, (counts.get(line.parent_item_id) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([parentItemId, componentCount]) => ({ parentItemId, componentCount }))
      .sort((a, b) =>
        (itemLabel.get(a.parentItemId) ?? a.parentItemId).localeCompare(
          itemLabel.get(b.parentItemId) ?? b.parentItemId,
        ),
      );
  }, [lines, itemLabel]);

  return (
    <section className="px-8 py-12 max-w-6xl mx-auto flex flex-col gap-6">
      <header className="flex items-center justify-between">
        <h1 className="text-4xl font-display tracking-wide text-ink">BILLS OF MATERIALS</h1>
        {caps.can('stock.bom.write') ? (
          <Link to="/3pl-operations/boms/new" className="px-4 py-2 bg-accent text-on-primary font-sans text-sm">New BOM</Link>
        ) : null}
      </header>
      {isLoading ? <p className="text-ink-dim">Loading.</p> : null}
      {!isLoading && rows.length === 0 ? (
        <ListEmptyState
          entity="bill of materials"
          explainer="A bill of materials lists the component items and quantities that go into building a finished product."
          addLabel="Add BOM"
          addTo="/3pl-operations/boms/new"
          canAdd={caps.can('stock.bom.write')}
        />
      ) : (
      <table className="w-full border border-line text-sm font-sans">
        <thead className="bg-bg-2 text-left text-ink-dim">
          <tr><th className="px-4 py-2">Finished item</th><th className="px-4 py-2">Components</th></tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.parentItemId} className="border-t border-line">
              <td className="px-4 py-2"><Link to={`/3pl-operations/boms/${row.parentItemId}`} className="text-ink underline">{itemLabel.get(row.parentItemId) ?? row.parentItemId}</Link></td>
              <td className="px-4 py-2 text-ink-dim">{row.componentCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
      )}
    </section>
  );
}
