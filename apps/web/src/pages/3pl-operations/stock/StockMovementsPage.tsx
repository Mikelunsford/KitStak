// StockMovementsPage. 3PL inventory ledger. Migration to the shared UI kit
// (F-Wave10-UI-KIT-01): PageHeader + DataTable replace the hand-rolled header
// and table. The signed-qty coloring, the SourceCell linking, and the
// onboarding ListEmptyState are preserved. Money fix: unit_cost_cents was
// rendered as a raw String() (showing whole cents like "1250"); it now renders
// through formatCents so the ledger reads "$12.50".

import { Link } from 'react-router-dom';

import { EntityLabel } from '@/components/data/EntityLabel';
import { LINK_CLASS } from '@/components/data/entityLabelStyles';
import { ListEmptyState } from '@/components/shell/ListEmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, type DataColumn } from '@/components/ui/DataTable';
import { useStockMovements } from '@/lib/hooks/useInventory';
import { formatCents } from '@/lib/money';
import type { StockMovement } from '@/lib/types/vendors_inventory_ops';

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
    <Link to={href} className={LINK_CLASS}>
      {label}
    </Link>
  );
}

const COLUMNS: ReadonlyArray<DataColumn<StockMovement>> = [
  {
    key: 'when',
    header: 'When',
    cellClassName: 'text-ink-dim',
    render: (m) => m.occurred_at,
  },
  {
    key: 'type',
    header: 'Type',
    cellClassName: 'text-ink',
    render: (m) => m.movement_type,
  },
  {
    key: 'item',
    header: 'Item',
    cellClassName: 'text-ink-dim',
    render: (m) => <EntityLabel kind="item" id={m.item_id} />,
  },
  {
    key: 'qty',
    header: 'Qty',
    align: 'right',
    cellClassName: 'tabular-nums',
    render: (m) => {
      const sign = signForMovementType(m.movement_type);
      const qtyClass =
        sign === -1 ? 'text-accent' : sign === 1 ? 'text-ink' : 'text-ink-dim';
      return <span className={qtyClass}>{formatStockMovementQty(m)}</span>;
    },
  },
  {
    key: 'unit_cost',
    header: 'Unit cost',
    align: 'right',
    cellClassName: 'tabular-nums text-ink-dim',
    render: (m) =>
      m.unit_cost_cents == null ? '' : formatCents(m.unit_cost_cents, 'USD'),
  },
  {
    key: 'source',
    header: 'Source',
    cellClassName: 'text-ink-dim',
    render: (m) => (
      <SourceCell
        entityType={m.source_entity_type}
        entityId={m.source_entity_id}
      />
    ),
  },
];

export function StockMovementsPage() {
  const { data, isLoading } = useStockMovements();
  const rows = data ?? [];

  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-6 px-8 py-12">
      <PageHeader eyebrow="Inventory / Stock movements" title="Stock movements" />
      {!isLoading && rows.length === 0 ? (
        <ListEmptyState
          entity="movement"
          explainer="Stock movements are the audit trail of every inventory change. They appear automatically when you receive, build, or ship items."
          addLabel="Add movement"
          addTo="/inventory/stock/movements"
          canAdd={false}
        />
      ) : (
        <DataTable
          columns={COLUMNS}
          rows={rows}
          getRowKey={(m) => m.id}
          loading={isLoading}
          empty="No stock movements yet."
        />
      )}
    </section>
  );
}
