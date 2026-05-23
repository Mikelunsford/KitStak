// F-Wave9-AUDIT-V3-WAVE-F-01: unified line-items editor for detail-page
// inline editing.
//
// Background:
//
//   The audit-v3 findings flagged that the inline line editors on the
//   InvoiceDetailPage, QuoteDetailPage, and (for billable lines) the
//   ShipmentDetailPage all roll their own table + add-line form. Each
//   one carries:
//
//     - a header table of existing lines with per-row remove,
//     - a collapsible "Add line" form with an ItemPicker + per-entity
//       fields,
//     - per-entity wiring to a mutation hook.
//
//   The receiving / shipment CREATE pages already share
//   `@/components/forms/LineItemsEditor` (which holds in-memory drafts
//   for a two-stage POST). That existing editor is a different shape —
//   it carries staged drafts before a parent exists. This component is
//   the DETAIL-page analogue: a parent already exists, and each line
//   add / remove is a mutation against the parent's id.
//
// Shape:
//
//   Slot props let the caller plug in entity-specific columns and
//   fields. The component owns:
//     - the header row and table chrome,
//     - the "Add line" button + collapse / expand state,
//     - empty + loading state copy,
//     - the ItemPicker (since every billable-line caller uses one to
//       pre-fill name and price).
//
//   The caller owns:
//     - rendering each existing line's cells (slot: `renderLine`),
//     - rendering the add-line form fields (slot: `renderAddFields`),
//     - the submit handler (slot: `onSubmit`),
//     - the item-pick prefill side effect (slot: `onItemPicked`).
//
// Migration status (this PR):
//
//   - InvoiceDetailPage migrates. The existing line editor is moved
//     verbatim into the slot, so the SPA bundle and the visual output
//     are unchanged.
//   - QuoteDetailPage and ShipmentDetailPage are filed under
//     F-Wave9-AUDIT-V3-WAVE-F-LINE-EDITOR-MIGRATIONS-01 for follow-up.
//
// Brand posture:
//   - Hand-rolled Tailwind. No new top-level deps.
//   - Tokens mirror the existing detail-page editors (`border-line`,
//     `bg-bg-2`, `font-display tracking-wider`).

import { useState, type FormEvent, type ReactNode } from 'react';

import { Button } from '@/components/ui/Button';
import { ItemPicker } from '@/components/ui/pickers';
import type { Item } from '@/lib/types/sales';

/**
 * Column descriptor for the header row. The cell content for each line
 * is supplied by the caller via `renderLine`, so this is purely for the
 * `<thead>` shape.
 */
export interface BillableLineColumn {
  /** Header label rendered in <th>. */
  label: string;
  /** Tailwind utility to align the column (e.g. 'text-right'). */
  align?: 'left' | 'right';
}

export interface BillableLineItemsEditorProps<TLine> {
  /**
   * Header copy above the section. Defaults to 'LINE ITEMS'.
   */
  heading?: string;
  /**
   * Whether the operator can add / remove lines. When false the
   * "Add line" button is hidden and `renderLine` should hide the
   * remove control via its own check.
   */
  canEdit: boolean;
  /**
   * Lines to render. The component does not assume a shape — the
   * caller's `renderLine` slot owns every cell.
   */
  lines: TLine[];
  /** True while the lines query is in flight. */
  loading?: boolean;
  /** Column headers (label + optional alignment). */
  columns: BillableLineColumn[];
  /**
   * Slot: render one row's <td> cells for the given line. Must return
   * a single ReactNode (typically a `<>...</>` fragment of `<td>`s).
   * The caller is responsible for the per-row Remove button if any —
   * the editor only owns the table chrome.
   */
  renderLine: (line: TLine) => ReactNode;
  /**
   * Slot: render the add-line form's fields (description, qty, price,
   * etc). The caller controls field state; the editor just provides
   * the <form>, ItemPicker, and submit buttons.
   */
  renderAddFields: () => ReactNode;
  /**
   * Slot: submit handler for the add-line form. The editor calls
   * `preventDefault` for you.
   */
  onSubmit: (e: FormEvent) => void;
  /**
   * Slot: called when the operator selects an item from the picker.
   * The caller uses this to pre-fill the description + price fields
   * (see `applyItemSelectionToInvoiceLine` for an example).
   */
  onItemPicked: (itemId: string | null, item: Item | null) => void;
  /**
   * Optional error message to render under the add-line form.
   */
  addLineError?: string | null;
  /** True while the add-line mutation is in flight. */
  addLinePending?: boolean;
  /**
   * Optional empty-state copy. Defaults to 'No lines yet.'.
   */
  emptyLabel?: string;
}

/**
 * BillableLineItemsEditor. Detail-page line-items editor with slot
 * props for the entity-specific columns and add-line fields.
 *
 * @example
 *   <BillableLineItemsEditor
 *     canEdit={inv.status === 'draft'}
 *     lines={lines.data ?? []}
 *     columns={[
 *       { label: 'Description' },
 *       { label: 'Qty', align: 'right' },
 *       { label: 'Unit', align: 'right' },
 *       { label: 'Line total', align: 'right' },
 *       { label: '' },
 *     ]}
 *     renderLine={(l) => (
 *       <>
 *         <td>{l.description}</td>
 *         <td className="text-right">{String(l.quantity)}</td>
 *         ...
 *       </>
 *     )}
 *     renderAddFields={() => <TextInput ... />}
 *     onSubmit={onAddLine}
 *     onItemPicked={(_id, item) => { ... }}
 *   />
 */
export function BillableLineItemsEditor<TLine>({
  heading = 'LINE ITEMS',
  canEdit,
  lines,
  loading = false,
  columns,
  renderLine,
  renderAddFields,
  onSubmit,
  onItemPicked,
  addLineError = null,
  addLinePending = false,
  emptyLabel = 'No lines yet.',
}: BillableLineItemsEditorProps<TLine>): JSX.Element {
  const [showAddLine, setShowAddLine] = useState(false);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit(e);
    // Reset transient picker state on submit. The caller's onSubmit
    // already clears its own field state in its mutation callback.
    setSelectedItemId(null);
    setShowAddLine(false);
  };

  return (
    <section>
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-2xl font-display tracking-wide text-ink">{heading}</h2>
        {canEdit && !showAddLine && (
          <Button variant="secondary" onClick={() => setShowAddLine(true)}>
            Add line
          </Button>
        )}
      </div>
      {loading ? (
        <p className="text-ink-dim">Loading lines.</p>
      ) : lines.length === 0 ? (
        <p className="text-ink-dim text-sm">{emptyLabel}</p>
      ) : (
        <table className="w-full text-sm font-sans border-collapse">
          <thead>
            <tr className="text-left text-ink-dim border-b border-line">
              {columns.map((col, i) => (
                <th
                  key={i}
                  className={`py-2 ${col.align === 'right' ? 'text-right' : ''}`}
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lines.map((line, idx) => (
              <tr key={idx} className="border-b border-line">
                {renderLine(line)}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {canEdit && showAddLine && (
        <form
          onSubmit={handleSubmit}
          className="flex flex-col gap-3 border border-line p-4 mt-4"
        >
          <h3 className="font-display tracking-wider text-ink">ADD LINE</h3>
          <ItemPicker
            value={selectedItemId}
            onChange={(itemId, item) => {
              setSelectedItemId(itemId);
              onItemPicked(itemId, item ?? null);
            }}
            label="Item (optional, pre-fills description and price)"
            filter={{ active: true }}
          />
          <div className="flex gap-3 flex-wrap items-end">
            {renderAddFields()}
            <Button type="submit" disabled={addLinePending}>
              {addLinePending ? 'Adding.' : 'Add'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setShowAddLine(false);
                setSelectedItemId(null);
              }}
            >
              Cancel
            </Button>
          </div>
          {addLineError && (
            <p className="font-sans text-sm text-accent">{addLineError}</p>
          )}
        </form>
      )}
    </section>
  );
}
