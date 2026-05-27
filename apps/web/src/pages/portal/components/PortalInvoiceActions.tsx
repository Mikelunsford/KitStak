// PortalInvoiceActions. Customer-facing "Download PDF" trigger per invoice row.
//
// F-Wave9-PORTAL-NO-ACTION-WIRING-01: the portal data tables were read-only.
// This component adds the minimum-viable action — render the invoice PDF the
// customer can save or print. The download flow is:
//
//   1. GET /customer-portal-api/portal/invoices/:id pulls the trusted
//      invoice header, line items, and customer display name. Pattern B:
//      cross-customer hits return 404.
//   2. POST /pdf-worker/pdf/render with the bundle. customer_user already
//      holds the pdf.document.render cap so no role grant change is
//      required.
//   3. The worker returns a data: URL, the SPA triggers a download via a
//      hidden anchor (same trick the operator-side InvoiceDetailPage uses).
//
// Deferred to follow-ups (skipped this round, filed as separate IDs):
//   F-Wave9-PORTAL-DETAIL-VIEWS-01 — row click to detail view.
//   F-Wave9-PORTAL-PAY-INVOICE-01 — Stripe wiring.

import { useState } from 'react';

import { getPortalInvoice } from '@/lib/services/portalService';
import { renderPdf } from '@/lib/services/pdfService';

interface PortalInvoiceActionsProps {
  invoiceId: string;
  invoiceNumber: string;
  customerDisplayName: string;
}

export function PortalInvoiceActions({
  invoiceId,
  invoiceNumber,
  customerDisplayName,
}: PortalInvoiceActionsProps) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onDownload = async () => {
    setPending(true);
    setError(null);
    try {
      const detail = await getPortalInvoice(invoiceId);
      const result = await renderPdf('invoice', {
        // Prefer the server-side display name (Pattern B trusted source).
        // Fall back to the dashboard's already-loaded name so the PDF is
        // never blank if the customer query is mid-flight.
        customer_display_name:
          detail.customer_display_name || customerDisplayName,
        invoice_number: detail.invoice.invoice_number,
        issue_date: detail.invoice.issue_date ?? '',
        due_date: detail.invoice.due_date ?? '',
        lines: detail.line_items.map((l) => ({
          description: l.description ?? '',
          quantity: String(l.quantity ?? '0'),
          unit_price_cents: String(l.unit_price_cents ?? '0'),
          line_total_cents: String(l.line_total_cents ?? '0'),
        })),
        subtotal_cents: String(detail.invoice.subtotal_cents),
        tax_cents: String(detail.invoice.tax_total_cents),
        total_cents: String(detail.invoice.total_cents),
        currency: detail.invoice.currency_code,
      });
      if ('not_available' in result) {
        setError(result.message);
        return;
      }
      triggerDownload(result.url, `invoice-${invoiceNumber}.pdf`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Download failed.');
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={() => {
          void onDownload();
        }}
        disabled={pending}
        className="inline-flex items-center border border-line bg-bg px-2 py-1 font-sans text-xs text-ink hover:bg-bg-2 disabled:opacity-50"
        data-testid={`portal-invoice-download-${invoiceId}`}
      >
        {pending ? 'Building.' : 'Download PDF'}
      </button>
      {error ? (
        <p
          className="font-sans text-xs text-accent"
          data-testid={`portal-invoice-download-error-${invoiceId}`}
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Trigger a browser download via a hidden anchor. Shared shape across all
 * portal action surfaces; pulled out so the unit test on PortalInvoiceActions
 * can stub it via dependency injection if needed.
 */
function triggerDownload(href: string, filename: string): void {
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
