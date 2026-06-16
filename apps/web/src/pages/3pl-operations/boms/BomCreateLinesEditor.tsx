// R-W13-UX-02: inline staged-components editor for the BOM CREATE screen.
// Mirrors the BomDetailPage add-component UI (component item Select,
// quantity per, unit of measure, notes) but holds drafts in memory. The
// create page picks the finished item once, the operator stages several
// components, and submit replays each draft through createBomItem under
// one user action (Create). Previously the create page captured exactly
// one component and sent the operator to the detail page for the rest.
//
// Modeled on `@/components/forms/LineItemsEditor`: a table of staged rows
// plus an add-row form, drafts owned by the parent via `lines` /
// `onChange`.

import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { TextInput } from '@/components/ui/TextInput';

import {
  nextBomDraftId,
  type BomLineDraft,
} from './bomLineDraft';

export interface BomComponentOption {
  id: string;
  label: string;
}

export interface BomCreateLinesEditorProps {
  lines: BomLineDraft[];
  onChange: (lines: BomLineDraft[]) => void;
  /** Item options for the component picker (already excludes the parent). */
  options: BomComponentOption[];
  disabled?: boolean;
}

export function BomCreateLinesEditor({
  lines,
  onChange,
  options,
  disabled = false,
}: BomCreateLinesEditorProps) {
  const [componentItemId, setComponentItemId] = useState('');
  const [quantityPer, setQuantityPer] = useState('1');
  const [unitOfMeasure, setUnitOfMeasure] = useState('');
  const [notes, setNotes] = useState('');

  const labelFor = (id: string) =>
    options.find((o) => o.id === id)?.label ?? id;

  const reset = () => {
    setComponentItemId('');
    setQuantityPer('1');
    setUnitOfMeasure('');
    setNotes('');
  };

  const onAdd = () => {
    if (!componentItemId) return;
    const next: BomLineDraft = {
      draftId: nextBomDraftId(),
      component_item_id: componentItemId,
      quantity_per: quantityPer,
      unit_of_measure: unitOfMeasure,
      notes,
    };
    onChange([...lines, next]);
    reset();
  };

  const onRemove = (draftId: string) => {
    onChange(lines.filter((l) => l.draftId !== draftId));
  };

  return (
    <section>
      <h2 className="text-2xl font-display tracking-wider text-ink mb-3">
        COMPONENTS
      </h2>
      <table className="w-full border border-line">
        <thead className="bg-bg-2 text-left text-sm font-display tracking-wider text-ink">
          <tr>
            <th className="px-4 py-2">Component</th>
            <th className="px-4 py-2">Quantity per</th>
            <th className="px-4 py-2">Unit</th>
            <th className="px-4 py-2">Notes</th>
            <th className="px-4 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {lines.length === 0 ? (
            <tr>
              <td colSpan={5} className="px-4 py-3 text-ink-dim text-sm">
                No components yet.
              </td>
            </tr>
          ) : (
            lines.map((l) => (
              <tr key={l.draftId} className="border-t border-line">
                <td className="px-4 py-2">{labelFor(l.component_item_id)}</td>
                <td className="px-4 py-2 font-mono text-sm">{l.quantity_per}</td>
                <td className="px-4 py-2 text-ink-dim text-sm">
                  {l.unit_of_measure}
                </td>
                <td className="px-4 py-2 text-ink-dim text-sm">{l.notes}</td>
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
        <h3 className="font-display tracking-wider text-ink">ADD COMPONENT</h3>
        <label className="flex flex-col gap-2">
          <span className="font-sans text-sm text-ink-dim tracking-wide uppercase">
            Component item
          </span>
          <Select
            value={componentItemId}
            onChange={(e) => setComponentItemId(e.target.value)}
            disabled={disabled}
          >
            <option value="">Select an item</option>
            {options.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.label}
              </option>
            ))}
          </Select>
        </label>
        <div className="flex gap-3 flex-wrap items-end">
          <TextInput
            label="Quantity per"
            type="number"
            step="0.0001"
            min="0"
            value={quantityPer}
            onChange={(e) => setQuantityPer(e.target.value)}
          />
          <TextInput
            label="Unit of measure"
            value={unitOfMeasure}
            onChange={(e) => setUnitOfMeasure(e.target.value)}
            placeholder="ea"
          />
          <TextInput
            label="Notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
          <Button
            type="button"
            onClick={onAdd}
            disabled={!componentItemId || disabled}
          >
            Add component
          </Button>
        </div>
      </div>
    </section>
  );
}
