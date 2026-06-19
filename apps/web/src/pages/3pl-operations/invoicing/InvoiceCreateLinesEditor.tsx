// R-W13-UX-02: inline staged-lines editor for the invoice CREATE screen.
// Mirrors the InvoiceDetailPage add-line UI (ItemPicker pre-fill,
// description, qty, unit price cents) but holds drafts in memory rather
// than firing a mutation per add. The create page replays the staged
// drafts through createInvoiceLineItem after the header POST succeeds,
// all under one operator action (Create). Sits alongside the existing B1
// source-document prefill: when the operator deep-links from a shipment
// or project, those derived lines POST first, then these manual drafts.
//
// Modeled on `@/components/forms/LineItemsEditor` (the receiving create
// precedent): a table of staged rows plus an add-row form, drafts owned
// by the parent via `lines` / `onChange`.

import { useState } from 'react';

import { EntityLabel } from '@/components/data/EntityLabel';
import { Button } from '@/components/ui/Button';
import { TextInput } from '@/components/ui/TextInput';
import { ItemPicker } from '@/components/ui/pickers';
import { formatCents } from '@/lib/money';

import { applyItemSelectionToInvoiceLine } from './applyItemSelectionToInvoiceLine';
import {
  nextInvoiceDraftId,
  type InvoiceLineDraft,
} from './invoiceLineDraft';

export interface InvoiceCreateLinesEditorProps {
  lines: InvoiceLineDraft[];
  onChange: (lines: InvoiceLineDraft[]) => void;
  currencyCode: string;
  disabled?: boolean;
}

export function InvoiceCreateLinesEditor({
  lines,
  onChange,
  currencyCode,
  disabled = false,
}: InvoiceCreateLinesEditorProps) {
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [qty, setQty] = useState('1');
  const [price, setPrice] = useState('0');

  const reset = () => {
    setSelectedItemId(null);
    setDescription('');
    setQty('1');
    setPrice('0');
  };

  const onAdd = () => {
    if (!description.trim()) return;
    const next: InvoiceLineDraft = {
      draftId: nextInvoiceDraftId(),
      item_id: selectedItemId,
      description,
      quantity: qty,
      unit_price_cents: price,
    };
    onChange([...lines, next]);
    reset();
  };

  const onRemove = (draftId: string) => {
    onChange(lines.filter((l) => l.draftId !== draftId));
  };

  return (
    <section>
      <h2 className="text-2xl font-display tracking-wider text-ink mb-3">LINES</h2>
      <table className="w-full border border-line">
        <thead className="bg-bg-2 text-left text-sm font-display tracking-wider text-ink">
          <tr>
            <th className="px-4 py-2">Description</th>
            <th className="px-4 py-2">Qty</th>
            <th className="px-4 py-2">Unit price</th>
            <th className="px-4 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {lines.length === 0 ? (
            <tr>
              <td colSpan={4} className="px-4 py-3 text-ink-dim text-sm">
                No lines yet.
              </td>
            </tr>
          ) : (
            lines.map((l) => (
              <tr key={l.draftId} className="border-t border-line">
                <td className="px-4 py-2">
                  {l.description}
                  {l.item_id ? (
                    <span className="text-ink-dim text-xs block">
                      <EntityLabel kind="item" id={l.item_id} />
                    </span>
                  ) : null}
                </td>
                <td className="px-4 py-2 tabular-nums text-sm">
                  {Number(l.quantity || 0).toFixed(2)}
                </td>
                <td className="px-4 py-2 tabular-nums text-sm">
                  {formatCents(Number(l.unit_price_cents || 0), currencyCode)}
                </td>
                <td className="px-4 py-2">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => onRemove(l.draftId)}
                    disabled={disabled}
                  >
                    Remove
                  </Button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      <div className="flex flex-col gap-3 border border-line p-4 mt-4">
        <h3 className="font-display tracking-wider text-ink">ADD LINE</h3>
        <ItemPicker
          value={selectedItemId}
          onChange={(itemId, item) => {
            setSelectedItemId(itemId);
            const next = applyItemSelectionToInvoiceLine(item);
            if (!next) return;
            setDescription(next.description);
            setPrice(next.unit_price_cents);
          }}
          label="Item (optional, pre-fills description and price)"
          filter={{ active: true }}
          disabled={disabled}
        />
        <div className="flex gap-3 flex-wrap items-end">
          <TextInput
            label="Description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <TextInput
            label="Qty"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            inputMode="decimal"
          />
          <TextInput
            label="Unit price (cents)"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            inputMode="numeric"
          />
          <Button
            type="button"
            onClick={onAdd}
            disabled={!description.trim() || disabled}
          >
            Add line
          </Button>
        </div>
      </div>
    </section>
  );
}
