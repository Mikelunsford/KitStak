// R-W13-UX-02: inline staged-lines editor for the quote CREATE screen.
// Mirrors the QuoteDetailPage add-line UI (ItemPicker pre-fill,
// QuantityInput, DollarInput, PercentInput, taxable checkbox) but holds
// drafts in memory rather than firing a mutation per add. The create
// page replays the staged drafts through addLineItem after the header
// POST succeeds, all under one operator action (Create).
//
// Modeled on `@/components/forms/LineItemsEditor` (the receiving/shipment
// create-form precedent): a table of staged rows plus an add-row form,
// drafts owned by the parent via `lines` / `onChange`.

import { useState } from 'react';

import { EntityLabel } from '@/components/data/EntityLabel';
import { Button } from '@/components/ui/Button';
import { TextInput } from '@/components/ui/TextInput';
import { ItemPicker } from '@/components/ui/pickers';
import { DollarInput } from '@/components/forms/DollarInput';
import { PercentInput } from '@/components/forms/PercentInput';
import { QuantityInput } from '@/components/forms/QuantityInput';
import { formatCents } from '@/lib/money';
import { formatQuantity } from '@/lib/formatQuantity';

import { applyItemSelection } from './applyItemSelection';
import {
  nextQuoteDraftId,
  type QuoteLineDraft,
} from './quoteLineDraft';
import {
  estimateLineAmountCents,
  estimateSubtotalCents,
  ESTIMATED_SUBTOTAL_LABEL,
} from './quoteLineEstimate';

export interface QuoteCreateLinesEditorProps {
  lines: QuoteLineDraft[];
  onChange: (lines: QuoteLineDraft[]) => void;
  currencyCode: string;
  disabled?: boolean;
}

export function QuoteCreateLinesEditor({
  lines,
  onChange,
  currencyCode,
  disabled = false,
}: QuoteCreateLinesEditorProps) {
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [sku, setSku] = useState('');
  const [qty, setQty] = useState<number | null>(1000);
  const [price, setPrice] = useState<number | null>(0);
  const [discountBps, setDiscountBps] = useState<number | null>(0);
  const [taxId, setTaxId] = useState('');
  const [isTaxable, setIsTaxable] = useState(true);

  const reset = () => {
    setSelectedItemId(null);
    setName('');
    setSku('');
    setQty(1000);
    setPrice(0);
    setDiscountBps(0);
    setTaxId('');
    setIsTaxable(true);
  };

  const onAdd = () => {
    if (!name.trim()) return;
    const next: QuoteLineDraft = {
      draftId: nextQuoteDraftId(),
      item_id: selectedItemId,
      name,
      sku,
      quantity_e3: qty,
      unit_price_cents: price,
      discount_bps: discountBps,
      tax_id: taxId,
      is_taxable: isTaxable,
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
            <th className="px-4 py-2">Name</th>
            <th className="px-4 py-2">Qty</th>
            <th className="px-4 py-2">Unit price</th>
            <th className="px-4 py-2">Discount</th>
            <th className="px-4 py-2">Amount</th>
            <th className="px-4 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {lines.length === 0 ? (
            <tr>
              <td colSpan={6} className="px-4 py-3 text-ink-dim text-sm">
                No lines yet.
              </td>
            </tr>
          ) : (
            lines.map((l) => (
              <tr key={l.draftId} className="border-t border-line">
                <td className="px-4 py-2">
                  {l.name}
                  {l.item_id ? (
                    <span className="text-ink-dim text-xs block">
                      <EntityLabel kind="item" id={l.item_id} />
                    </span>
                  ) : null}
                </td>
                <td className="px-4 py-2 tabular-nums text-sm">
                  {formatQuantity((l.quantity_e3 ?? 0) / 1000)}
                </td>
                <td className="px-4 py-2 tabular-nums text-sm">
                  {formatCents(l.unit_price_cents ?? 0, currencyCode)}
                </td>
                <td className="px-4 py-2 tabular-nums text-sm">
                  {((l.discount_bps ?? 0) / 100).toFixed(2)}%
                </td>
                <td className="px-4 py-2 tabular-nums text-sm text-ink">
                  {formatCents(estimateLineAmountCents(l), currencyCode)}
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
        {lines.length > 0 ? (
          <tfoot>
            <tr className="border-t border-line">
              <td
                colSpan={4}
                className="px-4 py-2 text-right text-sm text-ink-dim"
              >
                {ESTIMATED_SUBTOTAL_LABEL}
              </td>
              <td className="px-4 py-2 tabular-nums text-sm text-ink">
                {formatCents(estimateSubtotalCents(lines), currencyCode)}
              </td>
              <td className="px-4 py-2"></td>
            </tr>
          </tfoot>
        ) : null}
      </table>

      <div className="flex flex-col gap-3 border border-line p-4 mt-4">
        <h3 className="font-display tracking-wider text-ink">ADD LINE</h3>
        <ItemPicker
          value={selectedItemId}
          onChange={(itemId, item) => {
            setSelectedItemId(itemId);
            const next = applyItemSelection(item);
            if (!next) return;
            setName(next.name);
            setSku(next.sku);
            setPrice(Number(next.unit_price_cents));
          }}
          label="Item (optional, pre-fills name and price)"
          filter={{ active: true }}
          disabled={disabled}
        />
        <div className="flex gap-3 flex-wrap items-end">
          <TextInput
            label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <TextInput
            label="SKU"
            value={sku}
            onChange={(e) => setSku(e.target.value)}
          />
          <QuantityInput label="Quantity" value={qty} onChange={setQty} />
          <DollarInput label="Unit price" value={price} onChange={setPrice} />
          <PercentInput
            label="Discount"
            value={discountBps}
            onChange={setDiscountBps}
          />
          <TextInput
            label="Tax id (optional)"
            value={taxId}
            onChange={(e) => setTaxId(e.target.value)}
          />
          <label className="flex items-center gap-2 mt-6">
            <input
              type="checkbox"
              checked={isTaxable}
              onChange={(e) => setIsTaxable(e.target.checked)}
            />
            <span className="font-sans text-sm text-ink-dim tracking-wide uppercase">
              Taxable
            </span>
          </label>
          <Button
            type="button"
            onClick={onAdd}
            disabled={!name.trim() || disabled}
          >
            Add line
          </Button>
        </div>
      </div>
    </section>
  );
}
