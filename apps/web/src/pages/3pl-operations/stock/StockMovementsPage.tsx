import { EntityLabel } from '@/components/data/EntityLabel';
import { ListEmptyState } from '@/components/shell/ListEmptyState';
import { useStockMovements } from '@/lib/hooks/useInventory';

/**
 * StockMovementsPage. Read-only append-only ledger. Movements are emitted
 * by triggers on receiving_orders/production_runs/shipments status -> received|
 * completed|shipped. Not user-writable.
 */
export function StockMovementsPage() {
  const { data, isLoading } = useStockMovements();
  return (
    <section className="px-8 py-12 max-w-6xl mx-auto flex flex-col gap-6">
      <h1 className="text-4xl font-display tracking-wide text-ink">STOCK MOVEMENTS</h1>
      {isLoading ? <p className="text-ink-dim">Loading.</p> : null}
      {!isLoading && (data ?? []).length === 0 ? (
        <ListEmptyState
          entity="movement"
          explainer="Stock movements are the audit trail of every inventory change. They appear automatically when you receive, build, or ship items."
          addLabel="Add movement"
          addTo="/3pl-operations/stock/movements"
          canAdd={false}
        />
      ) : (
      <table className="w-full border border-line text-sm font-sans">
        <thead className="bg-bg-2 text-left text-ink-dim">
          <tr><th className="px-4 py-2">When</th><th className="px-4 py-2">Type</th><th className="px-4 py-2">Item</th><th className="px-4 py-2">Qty</th><th className="px-4 py-2">Unit cost</th><th className="px-4 py-2">Source</th></tr>
        </thead>
        <tbody>
          {(data ?? []).map((m) => (
            <tr key={m.id} className="border-t border-line">
              <td className="px-4 py-2 text-ink-dim">{m.occurred_at}</td>
              <td className="px-4 py-2 text-ink">{m.movement_type}</td>
              <td className="px-4 py-2 text-ink-dim"><EntityLabel kind="item" id={m.item_id} /></td>
              <td className="px-4 py-2 text-ink">{String(m.quantity)}</td>
              <td className="px-4 py-2 text-ink-dim">{String(m.unit_cost_cents)}</td>
              <td className="px-4 py-2 text-ink-dim">{m.source_entity_type ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
      )}
    </section>
  );
}
