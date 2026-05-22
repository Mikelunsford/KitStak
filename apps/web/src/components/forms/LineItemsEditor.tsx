import { useState, type FormEvent } from 'react';

import { EntityLabel } from '@/components/data/EntityLabel';
import { Button } from '@/components/ui/Button';
import { TextInput } from '@/components/ui/TextInput';
import { DollarInput } from '@/components/forms/DollarInput';
import { ItemPicker } from '@/components/ui/pickers';
import { formatCents } from '@/lib/money';

import { nextDraftId, type LineDraft } from './lineDraft';

// Re-export pure types and helpers so callers continue to import from
// `@/components/forms/LineItemsEditor` rather than the split helper file.
export {
  draftToPostBody,
  draftsToPostBodies,
  makeEmptyDraft,
  nextDraftId,
} from './lineDraft';
export type { LineDraft, LinePostBody } from './lineDraft';

/**
 * LineItemsEditor. Closes G-RECV-LINES-01 / G-SHIP-LINES-01 (the Phase 7
 * follow-up to replace the raw-JSON `<textarea>` on the receiving and
 * shipment NEW forms — bug B3 from the 2026-05-21 E2E smoke walk).
 *
 * Source of truth: the working line editor at
 * `ReceivingOrderDetailPage.tsx` (item picker · qty · unit cost · UOM ·
 * reference). The detail page commits each add via a mutation to the
 * line-item POST endpoint; this component runs the same UI shape but
 * holds drafts in memory so the create form can submit them in a
 * two-stage flow (POST header → POST each line) once the parent exists.
 *
 * Brand posture:
 *   - Hand-rolled primitives only (`Button`, `TextInput`, `ItemPicker`).
 *   - Tailwind classes mirrored verbatim from the detail-page editor.
 *   - No new top-level deps; no banned imports (constitution: anti-template).
 *
 * Pure helpers used by the create-form submit flow (and unit-tested) live
 * in `./lineDraft.ts` so tests can import them without React or the
 * Supabase client in the module graph.
 */

export interface LineItemsEditorProps {
  lines: LineDraft[];
  onChange: (lines: LineDraft[]) => void;
  /**
   * Receiving shows unit cost (vendor invoice cents). Shipment hides it —
   * the shipment line table has the column but the operator usually does
   * not enter cost at ship time.
   */
  mode: 'receiving' | 'shipment';
  disabled?: boolean;
}

export function LineItemsEditor({
  lines,
  onChange,
  mode,
  disabled = false,
}: LineItemsEditorProps) {
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [qty, setQty] = useState('1');
  // PR A2: DollarInput owns integer cents; the LineDraft contract still
  // carries a string so the existing draftToPostBody helper is unchanged.
  const [unitCostCents, setUnitCostCents] = useState<number | null>(null);
  const [uom, setUom] = useState('');
  const [reference, setReference] = useState('');

  const onAdd = (e: FormEvent) => {
    e.preventDefault();
    if (!selectedItemId) return;
    const next: LineDraft = {
      draftId: nextDraftId(),
      item_id: selectedItemId,
      quantity: qty,
      unit_cost_cents: unitCostCents === null ? '' : String(unitCostCents),
      uom,
      reference,
    };
    onChange([...lines, next]);
    setSelectedItemId(null);
    setQty('1');
    setUnitCostCents(null);
    setUom('');
    setReference('');
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
            <th className="px-4 py-2">Item</th>
            <th className="px-4 py-2">Qty</th>
            {mode === 'receiving' && <th className="px-4 py-2">Unit cost</th>}
            <th className="px-4 py-2">UOM</th>
            <th className="px-4 py-2">Reference</th>
            <th className="px-4 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {lines.length === 0 ? (
            <tr>
              <td
                colSpan={mode === 'receiving' ? 6 : 5}
                className="px-4 py-3 text-ink-dim text-sm"
              >
                No lines yet.
              </td>
            </tr>
          ) : (
            lines.map((l) => (
              <tr key={l.draftId} className="border-t border-line">
                <td className="px-4 py-2">
                  <EntityLabel kind="item" id={l.item_id} />
                </td>
                <td className="px-4 py-2 font-mono text-sm">
                  {Number(l.quantity || 0).toFixed(2)}
                </td>
                {mode === 'receiving' && (
                  <td className="px-4 py-2 font-mono text-sm">
                    {l.unit_cost_cents === ''
                      ? ''
                      : formatCents(Number(l.unit_cost_cents), 'USD')}
                  </td>
                )}
                <td className="px-4 py-2 font-mono text-sm">{l.uom}</td>
                <td className="px-4 py-2 font-mono text-sm">{l.reference}</td>
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
          onChange={(itemId) => setSelectedItemId(itemId)}
          label="Item"
          filter={{ active: true }}
          disabled={disabled}
        />
        <div className="flex gap-3 flex-wrap items-end">
          <TextInput
            label="Quantity"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            inputMode="decimal"
          />
          {mode === 'receiving' && (
            <DollarInput
              label="Unit cost"
              value={unitCostCents}
              onChange={setUnitCostCents}
            />
          )}
          <TextInput
            label="UOM"
            value={uom}
            onChange={(e) => setUom(e.target.value)}
          />
          <TextInput
            label="Reference"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
          />
          <Button
            type="button"
            onClick={onAdd}
            disabled={!selectedItemId || disabled}
          >
            Add line
          </Button>
        </div>
      </div>
    </section>
  );
}
