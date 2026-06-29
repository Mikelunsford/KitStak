// Receiving tab: the inbound receiving order the build flow drafted from the
// BOM (read-only here; received against on the Receiving surface). Pure
// presentational so the element-tree walk can test it. ADR 0006 P2c.

import { Link } from 'react-router-dom';

import { fmtDate } from '@/lib/jobbuilder/jobLogic';
import type { ReceivingOrder } from '@/lib/services/receivingOrdersService';

export function ReceivingTab({
  receivingOrder,
  receivingOrderId,
}: {
  receivingOrder: ReceivingOrder | null;
  receivingOrderId: string | null;
}) {
  if (!receivingOrder) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h3 className="font-display text-lg tracking-wide text-ink">Receiving order</h3>
          <p className="font-sans text-sm text-ink-dim">
            Inbound for the bill of materials.
          </p>
        </div>
        <p className="border border-line bg-bg-2 px-4 py-6 text-center font-sans text-sm text-ink-faint">
          No receiving order yet. Building from an approved quote drafts one.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h3 className="font-display text-lg tracking-wide text-ink">Receiving order</h3>
          <p className="font-sans text-sm text-ink-dim">
            Inbound for the bill of materials. Receive against it on the Receiving surface.
          </p>
        </div>
        {receivingOrderId ? (
          <Link
            to={`/inventory/receiving/${receivingOrderId}`}
            className="shrink-0 font-sans text-sm text-accent"
          >
            Open receiving order
          </Link>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-5 border border-line bg-bg-2 p-5 sm:grid-cols-3">
        <Fact label="RO number" value={receivingOrder.receiving_number ?? '-'} />
        <Fact label="Status" value={receivingOrder.status} />
        <Fact label="Expected delivery" value={fmtDate(receivingOrder.expected_date ?? '')} />
      </div>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="font-sans text-xs uppercase tracking-wide text-ink-dim">{label}</span>
      <span className="font-sans text-sm text-ink">{value}</span>
    </div>
  );
}
