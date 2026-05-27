// PortalQuoteActions. Customer-facing "Download PDF" trigger per quote row.
//
// F-Wave9-PORTAL-NO-ACTION-WIRING-01: mirrors PortalInvoiceActions for the
// quote-side download. The only meaningful difference is that quote line
// items store quantity_e3 (thousandths) per the operator-side schema; we
// convert to a decimal string before handing to pdf-worker so the rendered
// PDF reads as a normal quantity rather than a thousandths integer (same
// transform the operator-side QuoteDetailPage performs).

import { useState } from 'react';

import { getPortalQuote } from '@/lib/services/portalService';
import { renderPdf } from '@/lib/services/pdfService';

interface PortalQuoteActionsProps {
  quoteId: string;
  quoteNumber: string;
  customerDisplayName: string;
}

export function PortalQuoteActions({
  quoteId,
  quoteNumber,
  customerDisplayName,
}: PortalQuoteActionsProps) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onDownload = async () => {
    setPending(true);
    setError(null);
    try {
      const detail = await getPortalQuote(quoteId);
      const result = await renderPdf('quote', {
        customer_display_name:
          detail.customer_display_name || customerDisplayName,
        quote_number: detail.quote.number,
        // The customer-visible issue date: prefer submitted_at, fall back
        // to sent_at. Matches operator-side QuoteDetailPage logic so both
        // PDFs read the same.
        issue_date:
          detail.quote.submitted_at ?? detail.quote.sent_at ?? '',
        lines: detail.line_items.map((l) => ({
          description: l.name ?? '',
          quantity: (Number(l.quantity_e3 ?? 0) / 1000).toFixed(3),
          unit_price_cents: String(l.unit_price_cents ?? '0'),
          line_total_cents: String(l.line_total_cents ?? '0'),
        })),
        subtotal_cents: String(detail.quote.subtotal_cents),
        tax_cents: String(detail.quote.tax_cents),
        total_cents: String(detail.quote.total_cents),
        currency: detail.quote.currency_code,
      });
      if ('not_available' in result) {
        setError(result.message);
        return;
      }
      const a = document.createElement('a');
      a.href = result.url;
      a.download = `quote-${quoteNumber}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
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
        data-testid={`portal-quote-download-${quoteId}`}
      >
        {pending ? 'Building.' : 'Download PDF'}
      </button>
      {error ? (
        <p
          className="font-sans text-xs text-accent"
          data-testid={`portal-quote-download-error-${quoteId}`}
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
