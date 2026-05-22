import { useState } from 'react';
import { useParams } from 'react-router-dom';

import { AuditTimeline } from '@/components/shell/AuditTimeline';
import { Button } from '@/components/ui/Button';
import {
  usePurchaseOrder, usePurchaseOrderLines, useTransitionPurchaseOrder,
} from '@/lib/hooks/usePurchaseOrders';
import { useVioCapabilities } from '@/lib/hooks/useVioCapabilities';
import { useVendor } from '@/lib/hooks/useVendors';
import { useMe } from '@/lib/hooks/useMe';
import { hasCap } from '@/lib/capabilities';
import { renderPdf } from '@/lib/services/pdfService';
import {
  PURCHASE_ORDER_FSM, canTransitionVio,
} from '@/lib/workflow/vendors_inventory_ops';
import type { PurchaseOrderStatus } from '@/lib/types/vendors_inventory_ops';
import { destructiveConfirm } from '@/lib/destructiveConfirm';

export function PODetailPage() {
  const { id } = useParams<{ id: string }>();
  const po = usePurchaseOrder(id);
  const lines = usePurchaseOrderLines(id);
  const transition = useTransitionPurchaseOrder(id ?? '');
  const caps = useVioCapabilities();
  const [pdfPending, setPdfPending] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const me = useMe({ enabled: true });
  const canRenderPdf = me.data?.active_role
    ? hasCap(me.data.active_role, 'pdf.document.render')
    : false;

  const vendor = useVendor(po.data?.vendor_id);

  if (po.isLoading) return <p className="px-8 py-12 text-ink-dim">Loading.</p>;
  if (po.error || !po.data) return <p className="px-8 py-12 text-accent">PO not found.</p>;

  const data = po.data;
  const allowedNext = PURCHASE_ORDER_FSM.transitions
    .filter((t) => t.from === data.status)
    .map((t) => t.to);

  // F-Wave8-PDF-PO-DOWNLOAD-01. Build the PO render payload from the loaded
  // purchase order and its line items, call the pdf-worker, and trigger a
  // download via a hidden anchor. Mirrors InvoiceDetailPage's onDownloadPdf.
  const onDownloadPdf = async () => {
    setPdfError(null);
    setPdfPending(true);
    try {
      const result = await renderPdf('purchase_order', {
        vendor_display_name: vendor.data?.display_name ?? data.vendor_id,
        po_number: data.po_number ?? data.id.slice(0, 8),
        issue_date: data.order_date,
        lines: (lines.data ?? []).map((l) => ({
          description: l.description,
          quantity: String(l.quantity_ordered),
          unit_price_cents: String(l.unit_price_cents),
          line_total_cents: String(l.line_total_cents),
        })),
        subtotal_cents: String(data.subtotal_cents),
        total_cents: String(data.total_cents),
        currency: data.currency_code,
      });
      if ('not_available' in result) {
        setPdfError(result.message);
        return;
      }
      const a = document.createElement('a');
      a.href = result.url;
      a.download = `po-${data.po_number ?? data.id.slice(0, 8)}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err) {
      setPdfError(err instanceof Error ? err.message : 'Download failed.');
    } finally {
      setPdfPending(false);
    }
  };

  return (
    <section className="px-8 py-12 max-w-5xl mx-auto flex flex-col gap-6">
      <header className="flex items-center justify-between">
        <h1 className="text-4xl font-display tracking-wide text-ink">
          PO {data.po_number ?? data.id.slice(0, 8)}
        </h1>
        <div className="flex items-center gap-2">
          {canRenderPdf && (
            <Button
              variant="secondary"
              onClick={onDownloadPdf}
              disabled={pdfPending}
            >
              {pdfPending ? 'Building.' : 'Download PDF'}
            </Button>
          )}
          <span className="px-2 py-0.5 border border-line text-xs font-mono uppercase text-ink-dim">
            {data.status}
          </span>
        </div>
      </header>
      {pdfError && (
        <p className="font-sans text-sm text-accent">
          {pdfError}
        </p>
      )}

      {caps.can('purchase_orders.purchase_order.transition') && allowedNext.length > 0 ? (
        <div className="flex gap-2">
          {allowedNext.map((to) => (
            <button
              key={to}
              type="button"
              disabled={transition.isPending || !canTransitionVio(PURCHASE_ORDER_FSM, data.status, to)}
              onClick={() => {
                // UX-Q8: cancelling reverses a vendor commitment.
                if (to === 'cancelled' && !destructiveConfirm({
                  action: 'Cancel this purchase order',
                  consequence: 'The order will move to cancelled and the vendor commitment will be reversed.',
                })) return;
                transition.mutate(to as PurchaseOrderStatus);
              }}
              className="px-3 py-1 border border-line font-sans text-xs uppercase text-ink hover:bg-bg-2"
            >
              {to.replace('_', ' ')}
            </button>
          ))}
        </div>
      ) : null}

      {transition.error && (
        <p className="font-sans text-sm text-accent">
          {transition.error instanceof Error
            ? transition.error.message
            : 'Transition failed.'}
        </p>
      )}

      <dl className="grid grid-cols-2 gap-4 font-sans text-sm">
        <dt className="text-ink-dim">Vendor</dt><dd className="text-ink">{data.vendor_id}</dd>
        <dt className="text-ink-dim">Order date</dt><dd className="text-ink">{data.order_date}</dd>
        <dt className="text-ink-dim">Expected</dt><dd className="text-ink">{data.expected_date ?? ''}</dd>
        <dt className="text-ink-dim">Subtotal</dt><dd className="text-ink">{String(data.subtotal_cents)}</dd>
        <dt className="text-ink-dim">Tax</dt><dd className="text-ink">{String(data.tax_cents)}</dd>
        <dt className="text-ink-dim">Total</dt><dd className="text-ink">{String(data.total_cents)}</dd>
      </dl>

      <h2 className="text-2xl font-display tracking-wide text-ink">LINE ITEMS</h2>
      <table className="w-full border border-line text-sm font-sans">
        <thead className="bg-bg-2 text-left text-ink-dim">
          <tr>
            <th className="px-4 py-2">Description</th>
            <th className="px-4 py-2">Qty</th>
            <th className="px-4 py-2">Received</th>
            <th className="px-4 py-2">Unit</th>
            <th className="px-4 py-2">Total</th>
          </tr>
        </thead>
        <tbody>
          {(lines.data ?? []).map((l) => (
            <tr key={l.id} className="border-t border-line">
              <td className="px-4 py-2 text-ink">{l.description}</td>
              <td className="px-4 py-2 text-ink-dim">{String(l.quantity_ordered)}</td>
              <td className="px-4 py-2 text-ink-dim">{String(l.quantity_received)}</td>
              <td className="px-4 py-2 text-ink-dim">{String(l.unit_price_cents)}</td>
              <td className="px-4 py-2 text-ink-dim">{String(l.line_total_cents)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <section className="mt-6">
        <h2 className="text-2xl font-display tracking-wide text-ink mb-3">HISTORY</h2>
        <AuditTimeline entityType="purchase_order" entityId={id ?? null} />
      </section>
    </section>
  );
}
