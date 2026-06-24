import { DetailLayout, StatusBadge } from 'kitstak-ui';

export function InvoiceDetail() {
  return (
    <DetailLayout
      rail={
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2 border border-line p-4">
            <span className="font-mono text-xs uppercase tracking-wide text-ink-dim">Status</span>
            <StatusBadge status="partially_paid" />
          </div>
          <div className="flex flex-col gap-2 border border-line p-4">
            <span className="font-mono text-xs uppercase tracking-wide text-ink-dim">Key facts</span>
            <dl className="flex flex-col gap-1 text-sm text-ink">
              <div className="flex justify-between"><dt className="text-ink-dim">Customer</dt><dd>Acme Logistics</dd></div>
              <div className="flex justify-between"><dt className="text-ink-dim">Issued</dt><dd>Jun 01, 2025</dd></div>
              <div className="flex justify-between"><dt className="text-ink-dim">Due</dt><dd>Jun 12, 2025</dd></div>
              <div className="flex justify-between"><dt className="text-ink-dim">Balance</dt><dd className="tabular-nums">$12,300.00</dd></div>
            </dl>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-4 border border-line p-4">
        <h2 className="font-display text-2xl uppercase tracking-wide text-ink">Line items</h2>
        <p className="text-sm text-ink-dim">3 lines across SKU-4410, SKU-4411, and pallet storage for warehouse Tacoma DC.</p>
      </div>
    </DetailLayout>
  );
}
