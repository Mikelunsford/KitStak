import { useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';

import { AuditTimeline } from '@/components/shell/AuditTimeline';
import { Button } from '@/components/ui/Button';
import { TextInput } from '@/components/ui/TextInput';
import {
  useQuote, useSubmitQuote, useApproveQuote, useReviseQuote,
  useCancelQuote, useSendQuote, useConvertQuoteToProject,
  useAddLineItem, useRemoveLineItem,
} from '@/lib/hooks/useQuotes';
import { canTransition, QUOTE_FSM } from '@/lib/workflow/sales';
import { formatCents } from '@/lib/money';
import type { QuoteState } from '@/lib/types/sales';

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

  const [lineName, setLineName] = useState('');
  const [lineQty, setLineQty] = useState('1000');
  const [linePrice, setLinePrice] = useState('0');

  if (isLoading) return <p className="p-8 text-ink-dim">Loading.</p>;
  if (error || !data) return <p className="p-8 text-accent">Quote not found.</p>;

  const { quote, lineItems } = data;
  const state = quote.state as QuoteState;

  const onAddLine = async (e: FormEvent) => {
    e.preventDefault();
    if (!id) return;
    await addLine.mutateAsync({
      name: lineName,
      kind: 'item',
      quantity_e3: lineQty,
      unit_price_cents: linePrice,
      discount_bps: 0,
      is_taxable: true,
    });
    setLineName(''); setLineQty('1000'); setLinePrice('0');
  };

  return (
    <section className="px-8 py-12 max-w-5xl mx-auto flex flex-col gap-6">
      <header className="flex items-baseline justify-between">
        <div>
          <h1 className="text-4xl font-display tracking-wide text-ink">{quote.number}</h1>
          {quote.title && <p className="text-ink-dim">{quote.title}</p>}
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
          <Button onClick={() => convert.mutate(id)}>Convert to project</Button>
        )}
      </div>

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
        <form onSubmit={onAddLine} className="flex gap-3 items-end flex-wrap">
          <TextInput
            label="New line name"
            value={lineName}
            onChange={(e) => setLineName(e.target.value)}
            required
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
          <Button type="submit">Add line</Button>
        </form>
      )}

      <section className="mt-6">
        <h2 className="text-2xl font-display tracking-wide text-ink mb-3">HISTORY</h2>
        <AuditTimeline entityType="quote" entityId={id ?? null} />
      </section>
    </section>
  );
}
