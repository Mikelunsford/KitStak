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
// Lines are added and field-edited through the page's existing ADD LINE / EDIT
// LINE forms (which carry a Tier selector); this panel owns tier CRUD, the
// grouped per-tier display, per-line remove, quick reassign, and reorder.

import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { TextInput } from '@/components/ui/TextInput';
import { QuantityInput } from '@/components/forms/QuantityInput';
import { formatCents } from '@/lib/money';
import { formatQuantity } from '@/lib/formatQuantity';
import {
  useCreateTier, useUpdateTier, useDeleteTier, useReorderTiers,
  useUpdateLineItem, useRemoveLineItem,
} from '@/lib/hooks/useQuotes';
import type { QuoteLineItem, QuoteTier } from '@/lib/types/sales';

import { moveTierOrder } from './quoteTierOrder';

export interface QuoteTiersPanelProps {
  quoteId: string;
  tiers: QuoteTier[];
  lineItems: QuoteLineItem[];
  currencyCode: string;
  onEditLine: (line: QuoteLineItem) => void;
}

// A compact row for one line inside a tier (or the unassigned group): name, qty,
// line total, plus reassign / edit / remove. Field edits go through the page's
// EDIT LINE form (onEditLine); this only moves or removes the line.
function TierLineRow({
  quoteId, line, tiers, currencyCode, onEditLine,
}: {
  quoteId: string;
  line: QuoteLineItem;
  tiers: QuoteTier[];
  currencyCode: string;
  onEditLine: (line: QuoteLineItem) => void;
}) {
  const reassign = useUpdateLineItem(quoteId);
  const remove = useRemoveLineItem(quoteId);
  return (
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
        <Button type="button" variant="ghost" onClick={() => onEditLine(line)}>
          Edit
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
  );
}

// One tier section: header (label + break-quantity edit, per-tier total, reorder,
// remove) over the tier's lines. Owns its own label / break draft state so each
// tier instance edits independently.
function TierRow({
  quoteId, tier, tiers, lines, currencyCode, isFirst, isLast, onMove, onEditLine,
}: {
  quoteId: string;
  tier: QuoteTier;
  tiers: QuoteTier[];
  lines: QuoteLineItem[];
  currencyCode: string;
  isFirst: boolean;
  isLast: boolean;
  onMove: (tierId: string, dir: -1 | 1) => void;
  onEditLine: (line: QuoteLineItem) => void;
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
                onEditLine={onEditLine}
              />
            ))
          )}
        </tbody>
      </table>
    </section>
  );
}

export function QuoteTiersPanel({
  quoteId, tiers, lineItems, currencyCode, onEditLine,
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
              onEditLine={onEditLine}
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
                      onEditLine={onEditLine}
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
