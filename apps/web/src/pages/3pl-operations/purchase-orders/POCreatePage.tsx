import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { TextInput } from '@/components/ui/TextInput';
import { DollarInput } from '@/components/forms/DollarInput';
import { PercentInput } from '@/components/forms/PercentInput';
import { VendorPicker, ItemPicker } from '@/components/ui/pickers';
import { CurrencyField } from '@/components/ui/CurrencyField';
import { nextStepToast } from '@/lib/nextStepToast';
import { useCreatePurchaseOrder } from '@/lib/hooks/usePurchaseOrders';
import { createPoLineItem } from '@/lib/services/poLineItemsService';
import type { PoLineItem } from '@/lib/types/vendors_inventory_ops';

import { poCreatedMessage } from './poCreatedToast';

/**
 * POCreatePage. Closes G-PO-FORM-01 (VendorPicker replaces raw UUID input)
 * and G-PO-LINES-01 (line items captured at create time). The create-PO
 * mutation accepts only the header today, so the chain pattern matches
 * Stage-1 references: first POST creates the PO, then a Promise.all over
 * createPoLineItem(poId, line) posts each line against the existing
 * /vendors-api/purchase-orders/:id/line-items endpoint. Triggers in the
 * schema roll up subtotal/tax/total cents on the PO header as lines land,
 * so the header totals you see on the detail page reflect the lines we
 * just posted.
 *
 * Also reads ?vendor_id= from the query string so the "New PO" CTA on the
 * vendor detail page can prefill the picker.
 */
interface LineDraft {
  key: string;
  itemId: string | null;
  description: string;
  quantityOrdered: string;
  // PR A2: cents and bps now stored as integers via the primitives.
  // null permitted while the operator clears the field mid-edit.
  unitPriceCents: number | null;
  taxRateBps: number | null;
}

function emptyLine(): LineDraft {
  return {
    key: crypto.randomUUID(),
    itemId: null,
    description: '',
    quantityOrdered: '1',
    unitPriceCents: 0,
    taxRateBps: 0,
  };
}

export function POCreatePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const create = useCreatePurchaseOrder();

  const prefilledVendorId = searchParams.get('vendor_id');

  const [vendorId, setVendorId] = useState<string | null>(prefilledVendorId);
  const [poNumber, setPoNumber] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [orderDate, setOrderDate] = useState('');
  const [expectedDate, setExpectedDate] = useState('');
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);
  const [error, setError] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);

  function updateLine(key: string, patch: Partial<LineDraft>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }
  function removeLine(key: string) {
    setLines((prev) =>
      prev.length > 1 ? prev.filter((l) => l.key !== key) : prev,
    );
  }
  function addLine() {
    setLines((prev) => [...prev, emptyLine()]);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!vendorId) {
      setError('Vendor is required.');
      return;
    }
    if (currency.length !== 3) {
      setError('Currency must be a 3-letter code.');
      return;
    }

    setPosting(true);
    try {
      const out = await create.mutateAsync({
        vendor_id: vendorId,
        currency_code: currency,
        po_number: poNumber || null,
        ...(orderDate ? { order_date: orderDate } : {}),
        ...(expectedDate ? { expected_date: expectedDate } : {}),
      });

      const linesToPost = lines.filter(
        (l) => l.description.trim().length > 0 || l.itemId,
      );
      if (linesToPost.length > 0) {
        await Promise.all(
          linesToPost.map((l) => {
            const body: Partial<PoLineItem> = {
              description: l.description || '',
              quantity_ordered: l.quantityOrdered,
              unit_price_cents: String(l.unitPriceCents ?? 0),
              tax_rate_bps: l.taxRateBps ?? 0,
            };
            if (l.itemId) body.item_id = l.itemId;
            return createPoLineItem(out.id, body);
          }),
        );
      }

      // F-UIUX-TOASTS-ROLLOUT-01 (Pattern A): confirm the create and name the
      // next verb. linesToPost is the real count of non-empty lines POSTed;
      // with lines the PO is ready to send, without it the next step is adding
      // lines on the detail page.
      nextStepToast(poCreatedMessage(out.po_number, linesToPost.length));
      navigate(`/purchasing/purchase-orders/${out.id}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPosting(false);
    }
  }

  return (
    <section className="px-8 py-12 max-w-3xl mx-auto flex flex-col gap-6">
      <PageHeader title="New Purchase Order" />
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <VendorPicker
          value={vendorId}
          onChange={setVendorId}
          label="Vendor"
          required
        />
        <TextInput
          label="PO number"
          value={poNumber}
          onChange={(e) => setPoNumber(e.target.value)}
        />
        <TextInput
          label="Order date"
          type="date"
          value={orderDate}
          onChange={(e) => setOrderDate(e.target.value)}
        />
        <TextInput
          label="Expected date"
          type="date"
          value={expectedDate}
          onChange={(e) => setExpectedDate(e.target.value)}
        />

        <details className="border border-line bg-bg-2/40">
          <summary className="px-4 py-2 cursor-pointer text-sm text-ink-dim tracking-wide uppercase">
            Advanced (optional)
          </summary>
          <div className="flex flex-col gap-4 p-4 border-t border-line">
            <CurrencyField value={currency} onChange={setCurrency} />
          </div>
        </details>

        <section className="flex flex-col gap-3 border-t border-line pt-4">
          <header className="flex items-center justify-between">
            <h2 className="text-xl font-display tracking-wide text-ink">
              LINE ITEMS
            </h2>
            <Button type="button" variant="secondary" onClick={addLine}>
              Add line
            </Button>
          </header>
          <p className="font-sans text-xs text-ink-dim">
            Empty rows are skipped. Line totals roll up to the header after save.
          </p>
          {lines.map((l, idx) => (
            <fieldset
              key={l.key}
              className="flex flex-col gap-2 border border-line bg-bg-2 p-3"
            >
              <legend className="font-sans text-xs uppercase text-ink-dim px-1">
                Line {idx + 1}
              </legend>
              <ItemPicker
                value={l.itemId}
                onChange={(v) => updateLine(l.key, { itemId: v })}
                label="Item (optional)"
              />
              <TextInput
                label="Description"
                value={l.description}
                onChange={(e) =>
                  updateLine(l.key, { description: e.target.value })
                }
              />
              <div className="grid grid-cols-3 gap-2">
                <TextInput
                  label="Qty"
                  value={l.quantityOrdered}
                  onChange={(e) =>
                    updateLine(l.key, { quantityOrdered: e.target.value })
                  }
                  inputMode="decimal"
                />
                <DollarInput
                  label="Unit price"
                  value={l.unitPriceCents}
                  onChange={(v) => updateLine(l.key, { unitPriceCents: v })}
                />
                <PercentInput
                  label="Tax rate"
                  value={l.taxRateBps}
                  onChange={(v) => updateLine(l.key, { taxRateBps: v })}
                />
              </div>
              {lines.length > 1 && (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => removeLine(l.key)}
                >
                  Remove line
                </Button>
              )}
            </fieldset>
          ))}
        </section>

        {(error || create.error) && (
          <p className="text-accent font-sans text-sm">
            {error ?? (create.error as Error).message}
          </p>
        )}

        <div className="flex gap-2">
          <Button type="submit" disabled={posting || create.isPending}>
            {posting || create.isPending ? 'Saving.' : 'Save PO'}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => navigate('/purchasing/purchase-orders')}
          >
            Cancel
          </Button>
        </div>
      </form>
    </section>
  );
}
