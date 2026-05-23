import { Link } from 'react-router-dom';

import { EntityLabel } from '@/components/data/EntityLabel';
import { ListEmptyState } from '@/components/shell/ListEmptyState';
import { useStockMovements } from '@/lib/hooks/useInventory';

import {
  formatStockMovementQty,
  signForMovementType,
} from './formatStockMovementQty';

/**
 * StockMovementsPage. Read-only append-only ledger. Movements are emitted
 * by triggers on receiving_orders/production_runs/shipments status -> received|
 * completed|shipped. Not user-writable.
 *
 * F-Wave9-AUDIT-V3-WAVE-E-01:
 *   - item 5: Qty column shows the SIGNED magnitude (+ for inbound,
 *     - for outbound). Storage shape unchanged; this is render-only.
 *     Outbound rows render in accent so positive vs negative carries
 *     visual signal alongside the prefix.
 *   - item 6: Source column links to the originating entity (receiving
 *     order, shipment, production run, etc.) instead of showing the
 *     entity-type string with no anchor. Falls back to the plain type
 *     label when source_entity_id is null (older adjustment rows).
 */

/**
 * Maps a stock_movements `source_entity_type` to the SPA route that
 * owns that entity. Returns null when the type does not yet have a
 * detail page wired into the SPA, in which case the caller renders a
 * non-link badge so the column still reads as the source.
 */
function sourceLinkFor(
  entityType: string | null,
  entityId: string | null,
): string | null {
  if (!entityType || !entityId) return null;
  switch (entityType) {
    case 'receiving_order':
      return `/3pl-operations/receiving-orders/${entityId}`;
    case 'shipment':
      return `/3pl-operations/shipments/${entityId}`;
    case 'manufacturing_run':
    case 'production_run':
      return `/manufacturing/runs/${entityId}`;
    default:
      return null;
  }
}

function SourceCell({
  entityType,
  entityId,
}: {
  entityType: string | null;
  entityId: string | null;
}) {
  if (!entityType) return <span>{''}</span>;
  const href = sourceLinkFor(entityType, entityId);
  const label = entityType.replace(/_/g, ' ');
  if (!href) return <span>{label}</span>;
  return (
    <Link to={href} className="text-ink underline hover:text-accent">
      {label}
    </Link>
  );
}

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
          <tr><th className="px-4 py-2">When</th><th className="px-4 py-2">Type</th><th className="px-4 py-2">Item</th><th className="px-4 py-2 text-right">Qty</th><th className="px-4 py-2">Unit cost</th><th className="px-4 py-2">Source</th></tr>
        </thead>
        <tbody>
          {(data ?? []).map((m) => {
            const sign = signForMovementType(m.movement_type);
            const qtyClass =
              sign === -1
                ? 'text-accent'
                : sign === 1
                  ? 'text-ink'
                  : 'text-ink-dim';
            return (
              <tr key={m.id} className="border-t border-line">
                <td className="px-4 py-2 text-ink-dim">{m.occurred_at}</td>
                <td className="px-4 py-2 text-ink">{m.movement_type}</td>
                <td className="px-4 py-2 text-ink-dim"><EntityLabel kind="item" id={m.item_id} /></td>
                <td className={`px-4 py-2 text-right font-mono ${qtyClass}`}>
                  {formatStockMovementQty(m)}
                </td>
                <td className="px-4 py-2 text-ink-dim">{String(m.unit_cost_cents)}</td>
                <td className="px-4 py-2 text-ink-dim">
                  <SourceCell
                    entityType={m.source_entity_type}
                    entityId={m.source_entity_id}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      )}
    </section>
  );
}
