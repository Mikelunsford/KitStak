import { useMemo, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';

import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { Select } from '@/components/ui/Select';
import { TextInput } from '@/components/ui/TextInput';
import { useBomItemsList } from '@/lib/hooks/useInventory';
import { useItemsList } from '@/lib/hooks/useItems';
import { useWarehousesList } from '@/lib/hooks/useInventory';
import { useVioCapabilities } from '@/lib/hooks/useVioCapabilities';
import { manufacturingRunsKeys } from '@/lib/queryKeys/manufacturing';
import {
  createManufacturingRun,
  createConsumedLineItem,
  createProducedLineItem,
} from '@/lib/services/manufacturingService';
import type { BomItem } from '@/lib/services/bomItemsService';

/**
 * ManufacturingRunFromBomPage. M2 of the Manufacturing deepening plan.
 *
 * Picks a finished item that already has a bill of materials, multiplies
 * each BOM line by the build quantity, and opens a draft manufacturing run
 * pre-loaded with one consumed line per component plus a single produced
 * line for the finished item. The operator lands on the run detail page to
 * review, adjust, and start.
 *
 * The run and its line items are created through sequential service calls
 * because the consumed and produced endpoints need the run id, which is not
 * known until the parent run POST returns. apiClient injects a fresh
 * Idempotency-Key per request, so each call is independently idempotent.
 *
 * Quantities are numeric(18,4) on the wire. Scaling is rounded to four
 * decimal places to match the column scale and avoid float drift. This is
 * quantity math, not money math, so banker's rounding does not apply.
 */
function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function bomUom(line: BomItem): string | undefined {
  const uom = line.unit_of_measure;
  if (!uom) return undefined;
  if (uom.length < 1 || uom.length > 16) return undefined;
  return uom;
}

export function ManufacturingRunFromBomPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [searchParams] = useSearchParams();
  const caps = useVioCapabilities();

  const { data: bomLines, isLoading: bomLoading } = useBomItemsList();
  const { data: items } = useItemsList();
  const warehouses = useWarehousesList();

  const [finishedItemId, setFinishedItemId] = useState<string>(
    () => searchParams.get('parent_item_id') ?? '',
  );
  const [buildQuantity, setBuildQuantity] = useState('1');
  const [warehouseId, setWarehouseId] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [draftRunId, setDraftRunId] = useState<string | null>(null);

  const canCreate =
    caps.can('manufacturing.run.create') &&
    caps.can('manufacturing.run.line_item.create');

  const itemLabel = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of items ?? []) {
      map.set(item.id, `${item.sku} · ${item.name}`);
    }
    return map;
  }, [items]);

  const parentOptions = useMemo(() => {
    const parents = new Set<string>();
    for (const line of bomLines ?? []) parents.add(line.parent_item_id);
    return Array.from(parents)
      .map((id) => ({ id, label: itemLabel.get(id) ?? id }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [bomLines, itemLabel]);

  const selectedLines = useMemo(
    () =>
      (bomLines ?? [])
        .filter((line) => line.parent_item_id === finishedItemId)
        .slice()
        .sort((a, b) => a.sort_order - b.sort_order),
    [bomLines, finishedItemId],
  );

  const quantityNumber = Number(buildQuantity);
  const quantityValid = Number.isFinite(quantityNumber) && quantityNumber > 0;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canCreate) return;
    if (!finishedItemId) {
      setError('Select a finished item.');
      return;
    }
    if (!quantityValid) {
      setError('Build quantity must be greater than zero.');
      return;
    }
    if (selectedLines.length === 0) {
      setError('That item has no bill of materials.');
      return;
    }

    setError('');
    setSubmitting(true);
    try {
      const run = await createManufacturingRun({
        ...(warehouseId ? { warehouse_id: warehouseId } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      });
      setDraftRunId(run.id);

      let position = 0;
      for (const line of selectedLines) {
        const uom = bomUom(line);
        await createConsumedLineItem(run.id, {
          item_id: line.component_item_id,
          quantity: round4(Number(line.quantity_per) * quantityNumber),
          ...(uom ? { uom } : {}),
          position,
        });
        position += 1;
      }

      await createProducedLineItem(run.id, {
        item_id: finishedItemId,
        quantity: round4(quantityNumber),
        position: 0,
      });

      void qc.invalidateQueries({ queryKey: manufacturingRunsKeys.all });
      navigate(`/manufacturing/runs/${run.id}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to build run from BOM.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="px-8 py-12 max-w-2xl mx-auto flex flex-col gap-6">
      <PageHeader eyebrow="Make / Manufacturing runs" title="Build from BOM" />
      {!canCreate ? (
        <p className="text-accent font-sans text-sm">
          You do not have permission to create manufacturing runs.
        </p>
      ) : null}
      <p className="font-sans text-sm text-ink-dim">
        Pick a finished item with a bill of materials and a build quantity. The draft run opens
        with one consumed line per component, scaled to the build quantity, plus a produced line
        for the finished item.
      </p>

      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-2">
          <span className="font-sans text-sm text-ink-dim tracking-wide uppercase">Finished item</span>
          <Select
            value={finishedItemId}
            onChange={(e) => setFinishedItemId(e.target.value)}
            disabled={bomLoading}
          >
            <option value="">{bomLoading ? 'Loading.' : 'Select an item'}</option>
            {parentOptions.map((opt) => (
              <option key={opt.id} value={opt.id}>{opt.label}</option>
            ))}
          </Select>
        </label>

        <TextInput
          label="Build quantity"
          type="number"
          step="0.0001"
          min="0"
          value={buildQuantity}
          onChange={(e) => setBuildQuantity(e.target.value)}
          required
        />

        <label className="flex flex-col gap-2">
          <span className="font-sans text-sm text-ink-dim tracking-wide uppercase">Warehouse (optional)</span>
          <Select
            value={warehouseId}
            onChange={(e) => setWarehouseId(e.target.value)}
            disabled={warehouses.isLoading}
          >
            <option value="">
              {warehouses.isLoading ? 'Loading.' : 'No warehouse (admin-only run)'}
            </option>
            {(warehouses.data ?? []).map((w) => (
              <option key={w.id} value={w.id}>{w.code} · {w.display_name}</option>
            ))}
          </Select>
        </label>

        <label className="flex flex-col gap-2">
          <span className="font-sans text-sm text-ink-dim tracking-wide uppercase">Notes (optional)</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="bg-bg-2 border border-line text-ink px-4 py-3 font-sans focus:outline-none focus:border-accent"
          />
        </label>

        {finishedItemId && selectedLines.length > 0 ? (
          <div className="flex flex-col gap-2">
            <span className="font-sans text-sm text-ink-dim tracking-wide uppercase">Components consumed</span>
            <table className="w-full border border-line text-sm font-sans">
              <thead className="bg-bg-2 text-left text-ink-dim">
                <tr>
                  <th className="px-4 py-2">Component</th>
                  <th className="px-4 py-2">Per unit</th>
                  <th className="px-4 py-2">Total</th>
                  <th className="px-4 py-2">Unit</th>
                </tr>
              </thead>
              <tbody>
                {selectedLines.map((line) => (
                  <tr key={line.id} className="border-t border-line">
                    <td className="px-4 py-2 text-ink">{itemLabel.get(line.component_item_id) ?? line.component_item_id}</td>
                    <td className="px-4 py-2 text-ink-dim">{line.quantity_per}</td>
                    <td className="px-4 py-2 text-ink">
                      {quantityValid ? round4(Number(line.quantity_per) * quantityNumber) : '.'}
                    </td>
                    <td className="px-4 py-2 text-ink-dim">{line.unit_of_measure ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {finishedItemId && !bomLoading && selectedLines.length === 0 ? (
          <p className="text-ink-dim font-sans text-sm">That item has no bill of materials.</p>
        ) : null}

        {error ? (
          <p className="text-accent font-sans text-sm">{error}</p>
        ) : null}
        {error && draftRunId ? (
          <p className="font-sans text-sm text-ink-dim">
            A draft run was created.{' '}
            <button
              type="button"
              onClick={() => navigate(`/manufacturing/runs/${draftRunId}`)}
              className="text-ink underline"
            >
              Open it to finish manually.
            </button>
          </p>
        ) : null}

        <div className="flex gap-2">
          <Button type="submit" disabled={!canCreate || submitting}>
            {submitting ? 'Building.' : 'Build draft run'}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => navigate('/manufacturing/runs')}
          >
            Cancel
          </Button>
        </div>
      </form>
    </section>
  );
}
