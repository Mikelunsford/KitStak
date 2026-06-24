// ADR 0004 unit 6: tier-building UI for the quote detail page.
//
// A quote starts non-tiered (every line tier_id null, header = sum of lines).
// Adding the first tier flips it to tiered: the header total moves to the tier
// grain (recompute_quote_totals zeroes the header and rolls each tier up from its
// own lines), so a line left unassigned to a tier no longer counts toward any
// total. To keep that from biting the operator, adding the FIRST tier moves every
// existing untiered line into it, and any later orphan line is surfaced in an
// UNASSIGNED section with a one-click reassign.
//
// Lines are added through the page's ADD LINE form (which carries a Tier
// selector); this panel owns tier CRUD, the grouped per-tier display, per-line
// remove, quick reassign, reorder, and a dedicated inline editor so a line's
// fields are edited in place without leaving the tier view.

import { useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/Button';
import { TextInput } from '@/components/ui/TextInput';
import { QuantityInput } from '@/components/forms/QuantityInput';
import { DollarInput } from '@/components/forms/DollarInput';
import { PercentInput } from '@/components/forms/PercentInput';
import { formatCents } from '@/lib/money';
import { formatQuantity } from '@/lib/formatQuantity';
import {
  useCreateTier, useUpdateTier, useDeleteTier, useReorderTiers,
  useUpdateLineItem, useRemoveLineItem,
} from '@/lib/hooks/useQuotes';
import type { BillingInterval, QuoteLineItem, QuoteTier } from '@/lib/types/sales';

import { moveTierOrder } from './quoteTierOrder';

export interface QuoteTiersPanelProps {
  quoteId: string;
  tiers: QuoteTier[];
  lineItems: QuoteLineItem[];
  currencyCode: string;
}

// A row for one line inside a tier (or the unassigned group). Collapsed, it shows
// name, qty, line total, a quick move-to-tier select, and Edit / Remove. Edit
// expands a dedicated inline editor (name, sku, quantity, unit price, discount,
// tax, billing interval) so a line is edited in place without leaving the tier
// view. The server re-snapshots tax and recomputes every line_*_cents from these
// trusted inputs; the panel never sends totals.
function TierLineRow({
  quoteId, line, tiers, currencyCode,
}: {
  quoteId: string;
  line: QuoteLineItem;
  tiers: QuoteTier[];
  currencyCode: string;
}) {
  const reassign = useUpdateLineItem(quoteId);
  const update = useUpdateLineItem(quoteId);
  const remove = useRemoveLineItem(quoteId);

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(line.name);
  const [sku, setSku] = useState(line.sku ?? '');
  const [qty, setQty] = useState<number | null>(Number(line.quantity_e3));
  const [price, setPrice] = useState<number | null>(Number(line.unit_price_cents));
  const [discountBps, setDiscountBps] = useState<number | null>(line.discount_bps);
  const [taxId, setTaxId] = useState(line.tax_id ?? '');
  const [isTaxable, setIsTaxable] = useState(line.is_taxable);
  const [billing, setBilling] = useState<BillingInterval>(line.billing_interval);

  // Reseed the drafts from the current line each time the editor opens so a row
  // that changed underneath (e.g. a reassign) edits the latest values.
  const beginEdit = () => {
    setName(line.name);
    setSku(line.sku ?? '');
    setQty(Number(line.quantity_e3));
    setPrice(Number(line.unit_price_cents));
    setDiscountBps(line.discount_bps);
    setTaxId(line.tax_id ?? '');
    setIsTaxable(line.is_taxable);
    setBilling(line.billing_interval);
    update.reset();
    setEditing(true);
  };

  const onSave = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    update.mutate(
      {
        lineId: line.id,
        payload: {
          name,
          sku: sku || null,
          quantity_e3: qty ?? 0,
          unit_price_cents: price ?? 0,
          discount_bps: discountBps ?? 0,
          tax_id: taxId || null,
          is_taxable: isTaxable,
          billing_interval: billing,
        },
      },
      { onSuccess: () => setEditing(false) },
    );
  };

  return (
    <>
      <tr className="border-t border-line">
        <td className="px-3 py-2 text-sm">
          {line.name}
          {line.billing_interval === 'monthly' ? (
            <span className="text-ink-dim text-xs block uppercase tracking-wide">
              Monthly
            </span>
          ) : null}
        </td>
        <td className="px-3 py-2 tabular-nums text-sm">
          {formatQuantity(Number(line.quantity_e3) / 1000)}
        </td>
        <td className="px-3 py-2 tabular-nums text-sm text-ink">
          {formatCents(Number(line.line_total_cents), currencyCode)}
        </td>
        <td className="px-3 py-2">
          <select
            aria-label="Move line to tier"
            value={line.tier_id ?? ''}
            onChange={(e) =>
              reassign.mutate({
                lineId: line.id,
                payload: { tier_id: e.target.value === '' ? null : e.target.value },
              })
            }
            disabled={reassign.isPending}
            className="bg-bg-2 border border-line text-ink px-2 py-1 text-sm font-sans focus:outline-none focus:border-accent disabled:opacity-50"
          >
            <option value="">Unassigned</option>
            {tiers.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </td>
        <td className="px-3 py-2 text-right">
          <Button
            type="button"
            variant="ghost"
            onClick={() => (editing ? setEditing(false) : beginEdit())}
            aria-expanded={editing}
          >
            {editing ? 'Close' : 'Edit'}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => remove.mutate(line.id)}
            disabled={remove.isPending}
          >
            Remove
          </Button>
        </td>
      </tr>
      {editing ? (
        <tr className="bg-bg-2">
          <td colSpan={5} className="px-3 py-3">
            <form onSubmit={onSave} className="flex flex-wrap items-end gap-3">
              <TextInput
                label="Name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
              <TextInput
                label="SKU"
                value={sku}
                onChange={(e) => setSku(e.target.value)}
              />
              <QuantityInput label="Quantity" value={qty} onChange={setQty} />
              <DollarInput label="Unit price" value={price} onChange={setPrice} />
              <PercentInput label="Discount" value={discountBps} onChange={setDiscountBps} />
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
              <label className="flex flex-col gap-2">
                <span className="font-sans text-sm text-ink-dim tracking-wide uppercase">
                  Billing
                </span>
                <select
                  value={billing}
                  onChange={(e) => setBilling(e.target.value as BillingInterval)}
                  className="bg-bg-2 border border-line text-ink px-4 py-3 font-sans focus:outline-none focus:border-accent disabled:opacity-50"
                >
                  <option value="one_time">One time</option>
                  <option value="monthly">Monthly</option>
                </select>
              </label>
              <Button type="submit" disabled={update.isPending || !name.trim()}>
                {update.isPending ? 'Saving.' : 'Save line'}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
              {update.error ? (
                <p className="font-sans text-sm text-accent w-full">
                  {update.error instanceof Error
                    ? update.error.message
                    : 'Save line failed.'}
                </p>
              ) : null}
            </form>
          </td>
        </tr>
      ) : null}
    </>
  );
}

// One tier section: header (label + break-quantity edit, per-tier total, reorder,
// remove) over the tier's lines. Owns its own label / break draft state so each
// tier instance edits independently.
function TierRow({
  quoteId, tier, tiers, lines, currencyCode, isFirst, isLast, onMove,
}: {
  quoteId: string;
  tier: QuoteTier;
  tiers: QuoteTier[];
  lines: QuoteLineItem[];
  currencyCode: string;
  isFirst: boolean;
  isLast: boolean;
  onMove: (tierId: string, dir: -1 | 1) => void;
}) {
  const update = useUpdateTier(quoteId);
  const remove = useDeleteTier(quoteId);
  const [label, setLabel] = useState(tier.label);
  const [breakQty, setBreakQty] = useState<number | null>(Number(tier.break_quantity_e3));

  const dirty =
    label !== tier.label || (breakQty ?? 0) !== Number(tier.break_quantity_e3);

  const onSaveMeta = () => {
    if (!dirty || !label.trim()) return;
    update.mutate({
      tierId: tier.id,
      payload: { label, break_quantity_e3: breakQty ?? 0 },
    });
  };

  return (
    <section className="border border-line">
      <header className="flex flex-wrap items-end gap-3 bg-bg-2 px-4 py-3">
        <TextInput label="Tier" value={label} onChange={(e) => setLabel(e.target.value)} />
        <QuantityInput label="Break qty" value={breakQty} onChange={setBreakQty} />
        <div className="ml-auto flex items-center gap-3">
          <span className="font-sans text-sm text-ink-dim tracking-wide uppercase">
            Tier total
          </span>
          <span className="tabular-nums text-ink">
            {formatCents(Number(tier.total_cents), currencyCode)}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {dirty ? (
            <Button type="button" onClick={onSaveMeta} disabled={update.isPending || !label.trim()}>
              {update.isPending ? 'Saving.' : 'Save'}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            onClick={() => onMove(tier.id, -1)}
            disabled={isFirst}
            aria-label="Move tier up"
          >
            Up
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onMove(tier.id, 1)}
            disabled={isLast}
            aria-label="Move tier down"
          >
            Down
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => remove.mutate(tier.id)}
            disabled={remove.isPending}
          >
            Remove tier
          </Button>
        </div>
      </header>
      <table className="w-full">
        <tbody>
          {lines.length === 0 ? (
            <tr>
              <td colSpan={5} className="px-3 py-3 text-ink-dim text-sm">
                No lines in this tier yet. Use ADD LINE below and pick this tier.
              </td>
            </tr>
          ) : (
            lines.map((l) => (
              <TierLineRow
                key={l.id}
                quoteId={quoteId}
                line={l}
                tiers={tiers}
                currencyCode={currencyCode}
              />
            ))
          )}
        </tbody>
      </table>
    </section>
  );
}

export function QuoteTiersPanel({
  quoteId, tiers, lineItems, currencyCode,
}: QuoteTiersPanelProps) {
  const createTier = useCreateTier(quoteId);
  const reorder = useReorderTiers(quoteId);
  const moveOrphan = useUpdateLineItem(quoteId);

  const sorted = [...tiers].sort((a, b) => a.sort_order - b.sort_order);
  const orphanLines = lineItems.filter((l) => l.tier_id === null);
  const isTiered = sorted.length > 0;

  // Lean: the first tier absorbs the quote's existing untiered lines so they are
  // not silently dropped from the (now tier-grain) totals.
  const onAddTier = () => {
    const isFirst = sorted.length === 0;
    createTier.mutate(
      { label: `Tier ${sorted.length + 1}` },
      {
        onSuccess: (tier) => {
          if (isFirst) {
            for (const line of orphanLines) {
              moveOrphan.mutate({ lineId: line.id, payload: { tier_id: tier.id } });
            }
          }
        },
      },
    );
  };

  const onMove = (tierId: string, dir: -1 | 1) => {
    // The Up / Down buttons are disabled at the ends, so this only fires for a
    // valid move; moveTierOrder is defensive regardless.
    reorder.mutate(moveTierOrder(sorted.map((t) => t.id), tierId, dir));
  };

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-display tracking-wider text-ink">TIERS</h2>
        <Button type="button" onClick={onAddTier} disabled={createTier.isPending}>
          {createTier.isPending ? 'Adding tier.' : 'Add tier'}
        </Button>
      </div>

      {!isTiered ? (
        <p className="text-ink-dim text-sm">
          This quote is a single offer. Add a tier to split it into quantity breaks
          (one document, one number, many tiers). The first tier takes the current
          lines; only the accepted tier becomes the project on convert.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {sorted.map((tier, i) => (
            <TierRow
              key={tier.id}
              quoteId={quoteId}
              tier={tier}
              tiers={sorted}
              lines={lineItems.filter((l) => l.tier_id === tier.id)}
              currencyCode={currencyCode}
              isFirst={i === 0}
              isLast={i === sorted.length - 1}
              onMove={onMove}
            />
          ))}

          {orphanLines.length > 0 ? (
            <section className="border border-accent">
              <header className="bg-bg-2 px-4 py-3">
                <h3 className="font-display tracking-wider text-accent">UNASSIGNED</h3>
                <p className="text-ink-dim text-xs">
                  These lines belong to no tier, so they count toward no total. Move
                  each into a tier.
                </p>
              </header>
              <table className="w-full">
                <tbody>
                  {orphanLines.map((l) => (
                    <TierLineRow
                      key={l.id}
                      quoteId={quoteId}
                      line={l}
                      tiers={sorted}
                      currencyCode={currencyCode}
                    />
                  ))}
                </tbody>
              </table>
            </section>
          ) : null}
        </div>
      )}
    </section>
  );
}
