import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';

import { AuditTimeline } from '@/components/shell/AuditTimeline';
import { Button } from '@/components/ui/Button';
import { TextInput } from '@/components/ui/TextInput';
import { ItemPicker } from '@/components/ui/pickers';
import {
  useQuote, useSubmitQuote, useApproveQuote, useReviseQuote,
  useCancelQuote, useSendQuote, useConvertQuoteToProject,
  useAddLineItem, useRemoveLineItem,
} from '@/lib/hooks/useQuotes';
import { useCustomer } from '@/lib/hooks/useCustomer';
import { useItem } from '@/lib/hooks/useItems';
import { useMe } from '@/lib/hooks/useMe';
import { hasCap } from '@/lib/capabilities';
import { renderPdf } from '@/lib/services/pdfService';
import { canTransition, QUOTE_FSM } from '@/lib/workflow/sales';
import { formatCents } from '@/lib/money';
import type { QuoteState } from '@/lib/types/sales';

/**
 * QuoteDetailPage. Header now resolves customer display_name with a link to
 * the customer detail page. Line-add form uses ItemPicker; selecting an item
 * pre-fills sku, unit_price_cents, and item_id, with tax/discount inputs
 * exposed (the handler already accepts them per G-QUOTE-LINE-01).
 */
export function QuoteDetailPage() {
  const { id } = useParams();
  const { data, isLoading, error } = useQuote(id);
  const addLine = useAddLineItem(id ?? '');
  const removeLine = useRemoveLineItem(id ?? '');
  const submit = useSubmitQuote();
  const approve = useApproveQuote();
  const revise = useReviseQuote();
  const cancel = useCancelQuote();
  const send = useSendQuote();
  const convert = useConvertQuoteToProject();

  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [lineName, setLineName] = useState('');
  const [lineSku, setLineSku] = useState('');
  const [lineQty, setLineQty] = useState('1000');
  const [linePrice, setLinePrice] = useState('0');
  const [lineDiscountBps, setLineDiscountBps] = useState('0');
  const [lineTaxId, setLineTaxId] = useState('');
  const [lineIsTaxable, setLineIsTaxable] = useState(true);
  const [pdfPending, setPdfPending] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);

  const customerId = data?.quote.customer_id ?? null;
  const customer = useCustomer(customerId ?? undefined);
  const selectedItem = useItem(selectedItemId ?? undefined);
  const me = useMe({ enabled: true });
  const canRenderPdf = me.data?.active_role
    ? hasCap(me.data.active_role, 'pdf.document.render')
    : false;

  if (isLoading) return <p className="p-8 text-ink-dim">Loading.</p>;
  if (error || !data) return <p className="p-8 text-accent">Quote not found.</p>;

  const { quote, lineItems } = data;
  const state = quote.state as QuoteState;

  const onPickItem = (itemId: string | null) => {
    setSelectedItemId(itemId);
    if (itemId && selectedItem.data) {
      setLineName(selectedItem.data.name);
      setLineSku(selectedItem.data.sku);
      setLinePrice(String(selectedItem.data.unit_price_cents));
    }
  };

  // F-Wave8-PDF-QUOTE-DOWNLOAD-01. Build the quote render payload from the
  // loaded quote and its line items, call the pdf-worker, and trigger a
  // download via a hidden anchor. Mirrors InvoiceDetailPage's onDownloadPdf.
  const onDownloadPdf = async () => {
    setPdfError(null);
    setPdfPending(true);
    try {
      // QuoteLineItem stores quantity_e3 (thousandths). Convert to a decimal
      // string before handing to the worker so the rendered PDF reads as a
      // normal quantity rather than a thousandths integer.
      const result = await renderPdf('quote', {
        customer_display_name: customer.data?.display_name ?? '',
        quote_number: quote.number,
        issue_date: quote.submitted_at ?? quote.sent_at ?? '',
        lines: lineItems.map((l) => ({
          description: l.name,
          quantity: (Number(l.quantity_e3) / 1000).toFixed(3),
          unit_price_cents: String(l.unit_price_cents),
          line_total_cents: String(l.line_total_cents),
        })),
        subtotal_cents: String(quote.subtotal_cents),
        tax_cents: String(quote.tax_cents),
        total_cents: String(quote.total_cents),
        currency: quote.currency_code,
      });
      if ('not_available' in result) {
        setPdfError(result.message);
        return;
      }
      const a = document.createElement('a');
      a.href = result.url;
      a.download = `quote-${quote.number}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err) {
      setPdfError(err instanceof Error ? err.message : 'Download failed.');
    } finally {
      setPdfPending(false);
    }
  };

  const onAddLine = (e: FormEvent) => {
    e.preventDefault();
    if (!id) return;
    // F-Wave7-MUTATION-ERRORS-SWEEP-01: mutate(input, { onSuccess }) so a
    // 4xx surfaces in the inline error renderer under the form instead of
    // silently leaving the operator with a stuck form.
    addLine.mutate(
      {
        name: lineName,
        sku: lineSku || null,
        item_id: selectedItemId,
        kind: 'item',
        quantity_e3: lineQty,
        unit_price_cents: linePrice,
        discount_bps: Number(lineDiscountBps) || 0,
        tax_id: lineTaxId || null,
        is_taxable: lineIsTaxable,
      },
      {
        onSuccess: () => {
          setSelectedItemId(null);
          setLineName('');
          setLineSku('');
          setLineQty('1000');
          setLinePrice('0');
          setLineDiscountBps('0');
          setLineTaxId('');
          setLineIsTaxable(true);
        },
      },
    );
  };

  return (
    <section className="px-8 py-12 max-w-5xl mx-auto flex flex-col gap-6">
      <header className="flex items-baseline justify-between">
        <div>
          <h1 className="text-4xl font-display tracking-wide text-ink">{quote.number}</h1>
          {quote.title && <p className="text-ink-dim">{quote.title}</p>}
          {customerId && (
            <p className="text-ink-dim text-sm mt-1">
              Customer:{' '}
              <Link
                to={`/crm/customers/${customerId}`}
                className="text-ink hover:text-accent"
              >
                {customer.data?.display_name ?? customerId}
              </Link>
            </p>
          )}
        </div>
        <span className="px-3 py-1 border border-line font-mono text-sm">
          {state}
        </span>
      </header>

      <div className="flex flex-wrap gap-2">
        {canTransition(QUOTE_FSM, state, 'submitted') && id && (
          <Button onClick={() => submit.mutate(id)}>Submit</Button>
        )}
        {canTransition(QUOTE_FSM, state, 'approved') && id && (
          <Button onClick={() => approve.mutate(id)}>Approve</Button>
        )}
        {canTransition(QUOTE_FSM, state, 'revise_requested') && id && (
          <Button variant="secondary" onClick={() => revise.mutate(id)}>Request revise</Button>
        )}
        {canTransition(QUOTE_FSM, state, 'cancelled') && id && (
          <Button variant="ghost" onClick={() => cancel.mutate(id)}>Cancel</Button>
        )}
        {state === 'approved' && id && (
          <Button variant="secondary" onClick={() => send.mutate(id)}>Send</Button>
        )}
        {canTransition(QUOTE_FSM, state, 'project_pending') && id && (
          <Button
            onClick={() => convert.mutate(id)}
            disabled={convert.isPending}
          >
            {convert.isPending ? 'Converting.' : 'Convert to project'}
          </Button>
        )}
        {canRenderPdf && (
          <Button
            variant="secondary"
            onClick={onDownloadPdf}
            disabled={pdfPending}
          >
            {pdfPending ? 'Building.' : 'Download PDF'}
          </Button>
        )}
      </div>
      {convert.isError && (
        <p className="text-accent font-sans text-sm">
          Convert failed: {convert.error instanceof Error ? convert.error.message : 'unknown error'}
        </p>
      )}
      {pdfError && (
        <p className="text-accent font-sans text-sm">
          {pdfError}
        </p>
      )}

      <table className="w-full border border-line">
        <thead className="bg-bg-2 text-left text-sm font-display tracking-wider text-ink">
          <tr>
            <th className="px-4 py-2">Name</th>
            <th className="px-4 py-2">Qty</th>
            <th className="px-4 py-2">Unit price</th>
            <th className="px-4 py-2">Tax %</th>
            <th className="px-4 py-2">Total</th>
            <th className="px-4 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {lineItems.map((l) => (
            <tr key={l.id} className="border-t border-line">
              <td className="px-4 py-2">{l.name}</td>
              <td className="px-4 py-2 font-mono text-sm">
                {(Number(l.quantity_e3) / 1000).toFixed(3)}
              </td>
              <td className="px-4 py-2 font-mono text-sm">
                {formatCents(l.unit_price_cents, quote.currency_code)}
              </td>
              <td className="px-4 py-2 font-mono text-sm">
                {(l.tax_rate_snapshot / 100).toFixed(2)}
              </td>
              <td className="px-4 py-2 font-mono text-sm">
                {formatCents(l.line_total_cents, quote.currency_code)}
              </td>
              <td className="px-4 py-2">
                {['draft', 'revise_requested'].includes(state) && (
                  <Button
                    variant="ghost"
                    onClick={() => removeLine.mutate(l.id)}
                  >
                    Remove
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-line">
            <td colSpan={4} className="px-4 py-2 text-right text-ink-dim">Total</td>
            <td className="px-4 py-2 font-mono text-sm">
              {formatCents(quote.total_cents, quote.currency_code)}
            </td>
            <td></td>
          </tr>
        </tfoot>
      </table>

      {['draft', 'revise_requested'].includes(state) && (
        <form onSubmit={onAddLine} className="flex flex-col gap-3 border border-line p-4">
          <h3 className="font-display tracking-wider text-ink">ADD LINE</h3>
          <ItemPicker
            value={selectedItemId}
            onChange={onPickItem}
            label="Item (optional, pre-fills name and price)"
            filter={{ active: true }}
          />
          <div className="flex gap-3 flex-wrap items-end">
            <TextInput
              label="Name"
              value={lineName}
              onChange={(e) => setLineName(e.target.value)}
              required
            />
            <TextInput
              label="SKU"
              value={lineSku}
              onChange={(e) => setLineSku(e.target.value)}
            />
            <TextInput
              label="Qty (e3)"
              value={lineQty}
              onChange={(e) => setLineQty(e.target.value)}
              inputMode="numeric"
            />
            <TextInput
              label="Unit price (cents)"
              value={linePrice}
              onChange={(e) => setLinePrice(e.target.value)}
              inputMode="numeric"
            />
            <TextInput
              label="Discount bps"
              value={lineDiscountBps}
              onChange={(e) => setLineDiscountBps(e.target.value)}
              inputMode="numeric"
            />
            <TextInput
              label="Tax id (optional)"
              value={lineTaxId}
              onChange={(e) => setLineTaxId(e.target.value)}
            />
            <label className="flex items-center gap-2 mt-6">
              <input
                type="checkbox"
                checked={lineIsTaxable}
                onChange={(e) => setLineIsTaxable(e.target.checked)}
              />
              <span className="font-sans text-sm text-ink-dim tracking-wide uppercase">
                Taxable
              </span>
            </label>
            <Button type="submit" disabled={addLine.isPending}>
              {addLine.isPending ? 'Adding.' : 'Add line'}
            </Button>
          </div>
          {addLine.error && (
            <p className="font-sans text-sm text-accent">
              {addLine.error instanceof Error
                ? addLine.error.message
                : 'Add line failed.'}
            </p>
          )}
        </form>
      )}

      <section className="mt-6">
        <h2 className="text-2xl font-display tracking-wide text-ink mb-3">HISTORY</h2>
        <AuditTimeline entityType="quote" entityId={id ?? null} />
      </section>
    </section>
  );
}
